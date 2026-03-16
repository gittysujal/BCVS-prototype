// IssuerDashboard.tsx
import React, { useState, useEffect } from "react";
import { ethers, keccak256, toUtf8Bytes, isAddress } from "ethers";
import { flattenFieldsForMerkle, buildMerkleFromFields } from "../credentialMerkle";
import { CREDENTIAL_REGISTRY_ADDRESS, CREDENTIAL_REGISTRY_ABI } from "../lib/constants";
import { uploadJSONToIPFS } from "../lib/ipfsClient"; // ✅ ENCRYPTED uploader

// allow window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

// ---------------- Storacha config (display only) ----------------
const STORACHA_SPACE_DID =
  "did:key:z6MkgYQ4xviwisJHA1WDVr1Gv9dVezQmJspR6yj5qNucymbz";

// ---------------- Helpers ----------------
const generateCredentialId = (studentId: string, courseName: string) => {
  return keccak256(toUtf8Bytes(`${studentId}-${courseName}`));
};

const isBytes32 = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v.trim());

const CopyableInfo: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center text-sm">
    <span className="text-gray-400">{label}:</span>
    <div className="flex items-center gap-2 font-mono">
      <span className="truncate max-w-[220px]">{value}</span>
      <button
        onClick={() => navigator.clipboard.writeText(value)}
        className="text-green-400 hover:text-green-300 text-xs"
      >
        Copy
      </button>
    </div>
  </div>
);

// Better error extraction for ethers v6 + metamask
const getTransactionErrorMessage = (err: any): string => {
  const msg =
    err?.shortMessage ||
    err?.reason ||
    err?.info?.error?.message ||
    err?.message ||
    "An unknown transaction error occurred.";

  const lower = typeof msg === "string" ? msg.toLowerCase() : "";

  // Solidity require() strings in your contract
  if (lower.includes("credential not found")) return "Credential not found (wrong ID / wrong network / wrong contract address).";
  if (lower.includes("not authorized")) return "Not authorized (must be the original issuer OR admin).";
  if (lower.includes("already revoked")) return "Already revoked.";
  if (lower.includes("not revoked")) return "Not revoked (must be REVOKED before activating).";

  // Custom error selectors (only valid if selectors match your compiled build)
  const data =
    err?.data ||
    err?.info?.error?.data ||
    err?.error?.data;

  if (typeof data === "string") {
    if (data.startsWith("0x504c5662")) return "Caller is not an issuer (missing ISSUER_ROLE).";
    if (data.startsWith("0x3c2755ad")) return "Credential already exists.";
    if (data.startsWith("0x1738c823")) return "Invalid subject address.";
    if (data.startsWith("0x03b36178")) return "Merkle root cannot be empty.";
    if (data.startsWith("0x6295b364")) return "CID cannot be empty.";
  }

  return typeof msg === "string" ? msg : "Transaction failed (unknown error).";
};

// ---------------- Status mapping ----------------
const Status = {
  None: 0,
  Active: 1,
  Revoked: 2,
} as const;

type Status = (typeof Status)[keyof typeof Status];

const statusLabel = (s: number) =>
  s === Status.Active ? "ACTIVE" : s === Status.Revoked ? "REVOKED" : "NONE";

// ---------------- Component ----------------
const IssuerDashboard: React.FC = () => {
  const [formData, setFormData] = useState({
    holderWallet: "",
    studentName: "",
    studentId: "",
    courseName: "",
    degreeClassification: "First Class Honours",
    universityName: "",
    gpa: "",
  });

  // kept for UI continuity (not used by encrypted uploader in ipfsClient.ts)
  const [storachaEmail, setStorachaEmail] = useState("bmcsujalbmc@gmail.com");

  const [ipfsCid, setIpfsCid] = useState("");
  const [merkleRoot, setMerkleRoot] = useState("");
  const [lastIssuedTx, setLastIssuedTx] = useState("");
  const [lastIssuedId, setLastIssuedId] = useState("");

  const [isUploading, setIsUploading] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [credentialIssued, setCredentialIssued] = useState(false);

  const [credentialIdToManage, setCredentialIdToManage] = useState("");
  const [isRevoking, setIsRevoking] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const [manageStatus, setManageStatus] = useState<Status | null>(null);
  const [manageStatusLoading, setManageStatusLoading] = useState(false);

  const [error, setError] = useState("");
  const [connectedAddress, setConnectedAddress] = useState("");
  const [isIssuer, setIsIssuer] = useState(false);
  const [isContractInvalid, setIsContractInvalid] = useState(false);

  useEffect(() => {
    const preflightCheck = async () => {
      setError("");

      if (!window.ethereum) {
        setError("MetaMask not found. Please install it to use this application.");
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);

        const code = await provider.getCode(CREDENTIAL_REGISTRY_ADDRESS);
        if (code === "0x") {
          setIsContractInvalid(true);
          return;
        }
        setIsContractInvalid(false);

        const accounts = await provider.send("eth_requestAccounts", []);
        if (!accounts.length) {
          setError("No accounts found. Please connect to MetaMask.");
          return;
        }

        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setConnectedAddress(address);

        const contract = new ethers.Contract(
          CREDENTIAL_REGISTRY_ADDRESS,
          CREDENTIAL_REGISTRY_ABI,
          provider
        );

        const issuerRole = await contract.ISSUER_ROLE();
        const hasRole = await contract.hasRole(issuerRole, address);
        setIsIssuer(hasRole);

        if (!hasRole) {
          setError("Current wallet does not have ISSUER_ROLE. Switch to issuer wallet.");
        }
      } catch (err) {
        console.error(err);
        setError("An error occurred during pre-flight checks. See console for details.");
      }
    };

    preflightCheck();
  }, []);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleUploadToStoracha = async () => {
    setIsUploading(true);
    setError("");
    setCredentialIssued(false);

    try {
      // (kept) basic validation
      if (!isAddress(formData.holderWallet)) {
        throw new Error("Invalid 'Student wallet address (holder)'. Enter a valid Ethereum address.");
      }
      if (!/^\d{8}$/.test(formData.studentId)) {
        throw new Error("Student ID must be an 8-digit number.");
      }
      const gpaValue = parseFloat(formData.gpa);
      if (isNaN(gpaValue) || gpaValue < 0 || gpaValue > 4) {
        throw new Error("GPA must be a number between 0 and 4.");
      }

      const credentialJson = {
        holder: {
          wallet: formData.holderWallet,
          name: formData.studentName,
          studentId: formData.studentId,
        },
        credential: {
          courseName: formData.courseName,
          degreeClassification: formData.degreeClassification,
          gpa: formData.gpa || null,
          universityName: formData.universityName,
        },
        metadata: { createdAt: new Date().toISOString() },
        merkleFields: [
          "holder.name",
          "holder.studentId",
          "credential.courseName",
          "credential.degreeClassification",
          "credential.gpa",
          "credential.universityName",
        ],
      };

      const flattened = flattenFieldsForMerkle(
        credentialJson,
        credentialJson.merkleFields
      );
      const { root } = buildMerkleFromFields(flattened, credentialJson.merkleFields);
      setMerkleRoot(root);

      // ✅ ENCRYPTED upload (via src/lib/ipfsClient.ts)
      const cid = await uploadJSONToIPFS(credentialJson);

      if (cid.includes("-")) {
        throw new Error("Unexpected CID format. Upload likely failed.");
      }

      setIpfsCid(cid);
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || "Failed to upload credential JSON. Check console logs.";
      setError(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleIssueOnChain = async () => {
    setError("");

    if (isContractInvalid || !isIssuer) {
      setError("Cannot issue credential. Either the contract address is invalid or you lack the ISSUER_ROLE.");
      return;
    }
    if (!/^\d{8}$/.test(formData.studentId)) {
      setError("Student ID must be an 8-digit number.");
      return;
    }
    if (!isAddress(formData.holderWallet)) {
      setError("Invalid 'Student wallet address (holder)'. Enter a valid Ethereum address.");
      return;
    }
    const gpaValue = parseFloat(formData.gpa);
    if (isNaN(gpaValue) || gpaValue < 0 || gpaValue > 4) {
      setError("GPA must be a number between 0 and 4.");
      return;
    }
    if (!ipfsCid || !merkleRoot) {
      setError("Must upload first to get a CID and Merkle Root.");
      return;
    }

    setIsIssuing(true);

    try {
      if (!window.ethereum) throw new Error("MetaMask not found.");

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new ethers.Contract(
        CREDENTIAL_REGISTRY_ADDRESS,
        CREDENTIAL_REGISTRY_ABI,
        signer
      );

      const credentialId = generateCredentialId(formData.studentId, formData.courseName);

      const tx = await contract.issueCredential(
        credentialId,
        formData.holderWallet,
        merkleRoot,
        ipfsCid
      );

      await tx.wait();

      setLastIssuedTx(tx.hash);
      setLastIssuedId(credentialId);
      setCredentialIssued(true);

      setIpfsCid("");
      setMerkleRoot("");
      setFormData({
        holderWallet: "",
        studentName: "",
        studentId: "",
        courseName: "",
        degreeClassification: formData.degreeClassification,
        universityName: "",
        gpa: "",
      });
    } catch (err: any) {
      console.error(err);
      const reason = getTransactionErrorMessage(err);
      setError(`Transaction failed: ${reason}`);
    } finally {
      setIsIssuing(false);
    }
  };

  const handleCheckStatus = async () => {
    setError("");
    setManageStatus(null);

    const id = credentialIdToManage.trim();
    if (!id) {
      setError("Enter a Credential ID first.");
      return;
    }
    if (!isBytes32(id)) {
      setError("Credential ID must be a bytes32 hex string (0x + 64 hex chars).");
      return;
    }

    setManageStatusLoading(true);
    try {
      if (!window.ethereum) throw new Error("MetaMask not found.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(
        CREDENTIAL_REGISTRY_ADDRESS,
        CREDENTIAL_REGISTRY_ABI,
        provider
      );
      const s = await contract.statusOf(id);
      setManageStatus(Number(s) as Status);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to read status from chain.");
    } finally {
      setManageStatusLoading(false);
    }
  };

  const handleRevoke = async () => {
    const id = credentialIdToManage.trim();
    setError("");

    if (!id) {
      setError("Please enter a Credential ID to revoke.");
      return;
    }
    if (!isBytes32(id)) {
      setError("Credential ID must be a bytes32 hex string (0x + 64 hex chars).");
      return;
    }

    setIsRevoking(true);
    try {
      if (!window.ethereum) throw new Error("MetaMask not found.");

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new ethers.Contract(
        CREDENTIAL_REGISTRY_ADDRESS,
        CREDENTIAL_REGISTRY_ABI,
        signer
      );

      const tx = await contract.revokeCredential(id);
      await tx.wait();

      await handleCheckStatus();
      alert("Credential successfully revoked!");
    } catch (err: any) {
      console.error(err);
      const reason = getTransactionErrorMessage(err);
      setError(`Transaction failed: ${reason}`);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleActivate = async () => {
    const id = credentialIdToManage.trim();
    setError("");

    if (!id) {
      setError("Please enter a Credential ID to activate.");
      return;
    }
    if (!isBytes32(id)) {
      setError("Credential ID must be a bytes32 hex string (0x + 64 hex chars).");
      return;
    }

    setIsActivating(true);
    try {
      if (!window.ethereum) throw new Error("MetaMask not found.");

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new ethers.Contract(
        CREDENTIAL_REGISTRY_ADDRESS,
        CREDENTIAL_REGISTRY_ABI,
        signer
      );

      // Pre-check status
      try {
        const s = await contract.statusOf(id);
        const n = Number(s);
        if (n !== Status.Revoked) {
          setError(`Activate requires status REVOKED. Current status: ${statusLabel(n)}`);
          return;
        }
      } catch (e) {
        console.warn("statusOf failed", e);
      }

      const tx = await contract.activateCredential(id);
      await tx.wait();

      await handleCheckStatus();
      alert("Credential successfully activated!");
    } catch (err: any) {
      console.error(err);
      const reason = getTransactionErrorMessage(err);
      setError(`Transaction failed: ${reason}`);
    } finally {
      setIsActivating(false);
    }
  };

  const renderStatusBanner = () => {
    if (isContractInvalid) {
      return (
        <div className="bg-red-800 border border-red-600 text-white text-center p-3 rounded-lg mb-6">
          <h2 className="font-bold">Invalid Registry Contract</h2>
          <p className="text-sm">
            No contract found at the configured address on this network. Please update the
            CREDENTIAL_REGISTRY_ADDRESS.
          </p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-800 border border-red-600 text-white p-3 rounded-lg mb-6">
          <p className="text-sm font-bold whitespace-pre-line">{error}</p>
        </div>
      );
    }

    return null;
  };

  const canRevoke = manageStatus === Status.Active && !manageStatusLoading;
  const canActivate = manageStatus === Status.Revoked && !manageStatusLoading;

  return (
    <div className="bg-black text-gray-200 p-8 w-full max-w-4xl mx-auto font-sans">
      {renderStatusBanner()}

      <h1 className="text-2xl font-bold text-white mb-2">Issuer Dashboard</h1>

      <p className="text-sm text-gray-400 mb-2">
        Registry: <span className="font-mono">{CREDENTIAL_REGISTRY_ADDRESS}</span>
      </p>

      <p className="text-sm text-gray-400 mb-6">
        Storacha Space: <span className="font-mono break-all">{STORACHA_SPACE_DID}</span>
      </p>

      <div className="mb-4 p-3 border border-gray-700 rounded-lg">
        <h2 className="font-bold text-lg">Wallet Status</h2>
        {connectedAddress ? (
          <div className="text-sm mt-2 space-y-1">
            <p>
              Connected Account: <span className="font-mono">{connectedAddress}</span>
            </p>
            <p>
              Issuer Status:
              {isIssuer ? (
                <span className="text-green-500 font-bold"> Authorized</span>
              ) : (
                <span className="text-red-500 font-bold"> Not Authorized</span>
              )}
            </p>
          </div>
        ) : (
          <p className="text-sm mt-2 text-yellow-500">Connecting to wallet...</p>
        )}
      </div>

      <div className="space-y-4 mb-8">
        {/* Kept only for UI continuity */}
        <InputField
          label="Storacha login email (issuer operator)"
          name="storachaEmail"
          value={storachaEmail}
          onChange={(e: any) => setStorachaEmail(e.target.value)}
        />

        <InputField
          label="Student wallet address (holder)"
          name="holderWallet"
          value={formData.holderWallet}
          onChange={handleInputChange}
        />
        <InputField
          label="Student name"
          name="studentName"
          value={formData.studentName}
          onChange={handleInputChange}
        />
        <InputField
          label="Student ID"
          name="studentId"
          value={formData.studentId}
          onChange={handleInputChange}
          maxLength={8}
          pattern="\d{8}"
          type="text"
        />
        <InputField
          label="Course name"
          name="courseName"
          value={formData.courseName}
          onChange={handleInputChange}
        />
        <InputField
          label="University Name"
          name="universityName"
          value={formData.universityName}
          onChange={handleInputChange}
        />
        <InputField
          label="GPA (out of 4)"
          name="gpa"
          value={formData.gpa}
          onChange={handleInputChange}
          type="number"
          step="0.01"
          min="0"
          max="4"
        />

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">
            Degree / classification
          </label>
          <select
            name="degreeClassification"
            value={formData.degreeClassification}
            onChange={handleInputChange}
            className="w-full bg-black border border-gray-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option>First Class Honours</option>
            <option>Upper Second (2:1)</option>
            <option>Lower Second (2:2)</option>
            <option>Third Class</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">
            CID (auto-filled after upload)
          </label>
          <input
            type="text"
            readOnly
            value={ipfsCid}
            placeholder="Click 'Upload credential JSON to Storacha' to generate a CID"
            className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 font-mono text-sm text-gray-400"
          />
          {ipfsCid && (
            <p className="text-xs text-gray-500 mt-2">
              Gateway check:{" "}
              <span className="font-mono break-all">
                {`https://w3s.link/ipfs/${ipfsCid}`}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-lg mb-4">
        <h2 className="font-bold text-white">Storacha Upload (Encrypted)</h2>
        <p className="text-sm text-gray-400 mt-1 mb-3">
          Encrypts credential JSON locally, uploads ciphertext to Storacha (Filecoin/IPFS),
          and calculates the Merkle Root.
        </p>

        <button
          onClick={handleUploadToStoracha}
          disabled={isUploading}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors"
        >
          {isUploading ? "Uploading..." : "Upload Credential JSON to Storacha"}
        </button>

        {merkleRoot && (
          <div className="mt-3 text-sm">
            <p>
              Merkle Root:{" "}
              <span className="text-green-400 font-mono break-all">{merkleRoot}</span>
            </p>
          </div>
        )}

        {ipfsCid && (
          <div className="mt-3 text-sm">
            <p>
              Latest CID:{" "}
              <span className="text-green-400 font-mono break-all">{ipfsCid}</span>
            </p>
          </div>
        )}
      </div>

      <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-lg mb-6">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-white">On-Chain Issuance</h2>
          {credentialIssued && (
            <span className="text-green-400 text-xs font-bold">✓ CREDENTIAL ISSUED</span>
          )}
        </div>

        <p className="text-sm text-gray-400 mt-1 mb-3">
          Sends the Merkle Root and CID to the smart contract.
        </p>

        <button
          onClick={handleIssueOnChain}
          disabled={!ipfsCid || isIssuing || !isIssuer || isContractInvalid}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors"
        >
          {isIssuing ? "Issuing..." : "Issue Credential On-Chain"}
        </button>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-lg mb-6">
        <h2 className="font-bold text-white">Credential Status Management</h2>
        <p className="text-sm text-gray-400 mt-1 mb-3">
          Enter the Credential ID (bytes32) to revoke or activate it.
          Use "Check Status" first — buttons unlock only when valid.
        </p>

        <InputField
          label="Credential ID"
          name="credentialIdToManage"
          value={credentialIdToManage}
          onChange={(e: any) => setCredentialIdToManage(e.target.value)}
        />

        <div className="flex gap-3 mt-3">
          <button
            onClick={handleCheckStatus}
            disabled={manageStatusLoading}
            className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors"
          >
            {manageStatusLoading ? "Checking..." : "Check Status"}
          </button>

          {manageStatus !== null && (
            <div className="flex items-center text-sm text-gray-200">
              Status:{" "}
              <span
                className={`ml-2 font-bold ${
                  manageStatus === Status.Active
                    ? "text-green-400"
                    : manageStatus === Status.Revoked
                    ? "text-red-400"
                    : "text-gray-400"
                }`}
              >
                {statusLabel(manageStatus)}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-4 mt-4">
          <button
            onClick={handleRevoke}
            disabled={isRevoking || isActivating || !canRevoke}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors"
          >
            {isRevoking ? "Revoking..." : "Revoke Credential"}
          </button>
          <button
            onClick={handleActivate}
            disabled={isRevoking || isActivating || !canActivate}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 text-white font-bold py-2 px-4 rounded-md transition-colors"
          >
            {isActivating ? "Activating..." : "Activate Credential"}
          </button>
        </div>
      </div>

      {lastIssuedTx && (
        <div className="bg-gray-900/50 border border-gray-800 p-4 rounded-lg">
          <h2 className="font-bold text-white mb-3">Last Issued Credential</h2>
          <div className="space-y-2">
            <CopyableInfo label="Transaction hash" value={lastIssuedTx} />
            <CopyableInfo label="Credential ID (bytes32)" value={lastIssuedId} />
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------- Input component ----------------
const InputField: React.FC<{
  label: string;
  name: string;
  value: string;
  onChange:
    | ((e: React.ChangeEvent<HTMLInputElement>) => void)
    | ((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void);
  type?: string;
  maxLength?: number;
  pattern?: string;
  step?: string;
  min?: string;
  max?: string;
}> = ({
  label,
  name,
  value,
  onChange,
  type = "text",
  maxLength,
  pattern,
  step,
  min,
  max,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
    <input
      type={type}
      name={name}
      value={value}
      onChange={onChange as any}
      maxLength={maxLength}
      pattern={pattern}
      step={step}
      min={min}
      max={max}
      className="w-full bg-black border border-gray-700 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
    />
  </div>
);

export default IssuerDashboard;
