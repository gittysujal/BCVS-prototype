// HolderDashboard.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { flattenFieldsForMerkle, buildMerkleFromFields } from "../credentialMerkle";
import { CREDENTIAL_REGISTRY_ADDRESS, CREDENTIAL_REGISTRY_ABI } from "../lib/constants";
import { decryptJSON, keyBase64ToBytes, type EncryptedPayloadV1 } from "../lib/crypto";

// allow window.ethereum (MetaMask)
declare global {
  interface Window {
    ethereum?: any;
  }
}

// ---------------- Status ----------------
const Status = {
  None: 0,
  Active: 1,
  Revoked: 2,
} as const;

type Status = (typeof Status)[keyof typeof Status];

// ---------------- Types ----------------
interface Credential {
  id: string;
  issuer: string;
  subject: string;
  merkleRoot: string;
  cid: string;
  issuedAt: bigint;
  revokedAt: bigint;
  status: Status;
}

interface SharePayload {
  credentialId: string;
  cid: string;
  subjectAddress: string;
  issuerAddress: string;
  merkleRoot: string;
  revealedFields: Record<string, string>;
  proofs: Record<string, any>;
  verifier: {
    type: "wallet" | "email" | "other";
    value: string;
  };
  createdAt: string;
}

// Friendly labels for known field paths
const friendlyFieldNames: Record<string, string> = {
  "holder.name": "Name",
  "holder.studentId": "Student ID",
  "credential.courseName": "Course Name",
  "credential.degreeClassification": "Degree Classification",
  "credential.gpa": "GPA",
  "credential.universityName": "University",
};

// ---------------- Helpers ----------------
const isHexCredentialId = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v.trim());

// CIDv0 (Qm...) OR CIDv1 base32 (bafy..., bafkrei..., etc.)
const looksLikeCid = (v: string) => {
  const x = v.trim();
  if (!x) return false;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(x)) return true;
  if (/^b[a-z2-7]{20,}$/.test(x)) return true;
  return false;
};

const shortStatus = (s: Status) =>
  s === Status.Active ? "ACTIVE" : s === Status.Revoked ? "REVOKED" : "NONE";

// localStorage namespace used by ipfsClient.ts
const KEY_PREFIX = "bcvs:dek:";

function getKeyForCid(cid: string): Uint8Array {
  const keyB64 = localStorage.getItem(`${KEY_PREFIX}${cid}`);
  if (!keyB64) {
    throw new Error(
      "Missing decryption key for this CID in this browser.\n\n" +
        "This happens if:\n" +
        "- you opened the holder dashboard on a different browser/device, or\n" +
        "- localStorage was cleared.\n\n" +
        "For the demo: issue + view using the same browser profile."
    );
  }
  return keyBase64ToBytes(keyB64);
}

function isEncryptedPayload(x: any): x is EncryptedPayloadV1 {
  return !!x && x.v === 1 && x.alg === "AES-256-GCM" && typeof x.iv === "string" && typeof x.ciphertext === "string";
}

// ---------------- Storacha/IPFS Fetch + Decrypt ----------------
async function fetchEncryptedThenDecrypt(cid: string): Promise<any> {
  const trimmed = cid.trim();
  if (!trimmed) throw new Error("CID cannot be empty.");

  // Prefer w3s.link for Storacha-backed content; keep others as fallback.
  const urlCandidates = [
    `https://w3s.link/ipfs/${trimmed}`,
    `https://${trimmed}.ipfs.w3s.link/`,
    `https://dweb.link/ipfs/${trimmed}`,
    `https://${trimmed}.ipfs.dweb.link/`,
    `https://cloudflare-ipfs.com/ipfs/${trimmed}`,
  ];

  let lastErr: any = null;

  for (const url of urlCandidates) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from gateway: ${url}`);
        continue;
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        lastErr = new Error(`Gateway returned HTML (not JSON): ${url}`);
        continue;
      }

      const maybeEncrypted = await res.json();

      // If it's already plaintext (old uploads), allow it but warn.
      if (!isEncryptedPayload(maybeEncrypted)) {
        // This means credential was issued using the old (plaintext) path.
        return maybeEncrypted;
      }

      const keyBytes = getKeyForCid(trimmed);
      const decrypted = await decryptJSON(maybeEncrypted, keyBytes);
      return decrypted;
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw new Error(lastErr?.message || "Failed to fetch encrypted data from Storacha/IPFS gateways.");
}

function requireEthereum() {
  if (!window.ethereum) {
    throw new Error("MetaMask not found. Install MetaMask to use this app.");
  }
}

async function getProvider() {
  requireEthereum();
  return new ethers.BrowserProvider(window.ethereum);
}

async function getConnectedAddress(provider: ethers.BrowserProvider) {
  const accounts = await provider.send("eth_requestAccounts", []);
  if (!accounts?.length) throw new Error("No accounts connected in MetaMask.");
  const signer = await provider.getSigner();
  return await signer.getAddress();
}

function getReadContract(provider: ethers.BrowserProvider) {
  return new ethers.Contract(CREDENTIAL_REGISTRY_ADDRESS, CREDENTIAL_REGISTRY_ABI, provider);
}

// Resolve credentialId by CID for the CURRENT connected subject (subject-only enforcement).
async function resolveCredentialIdByCidForConnectedSubject(
  provider: ethers.BrowserProvider,
  cid: string
): Promise<string> {
  const address = await getConnectedAddress(provider);
  const contract = getReadContract(provider);

  const ids: string[] = await contract.getCredentialIdsBySubject(address);
  if (!ids?.length) throw new Error("No on-chain credentials for this wallet.");

  for (const id of ids) {
    const cred = await contract.getCredential(id);
    const storedCid = String(cred?.[3] || "");
    if (storedCid.trim() === cid.trim()) return id;
  }

  throw new Error(
    "CID not found under this wallet. This dashboard is subject-only (you can’t view other students’ credentials)."
  );
}

// Fetch on-chain credential (and status) by credentialId
async function fetchOnChainCredential(
  provider: ethers.BrowserProvider,
  credentialId: string
): Promise<Credential> {
  const contract = getReadContract(provider);

  const [cred, statusRaw] = await Promise.all([
    contract.getCredential(credentialId),
    contract.statusOf(credentialId),
  ]);

  const status = Number(statusRaw) as Status;

  return {
    id: credentialId,
    issuer: String(cred?.[0] || ""),
    subject: String(cred?.[1] || ""),
    merkleRoot: String(cred?.[2] || ""),
    cid: String(cred?.[3] || ""),
    issuedAt: cred?.[4] ?? 0n,
    revokedAt: cred?.[5] ?? 0n,
    status,
  };
}

function ensureSubjectOnly(connected: string, cred: Credential) {
  if (!connected || !cred?.subject) return;
  if (connected.toLowerCase() !== cred.subject.toLowerCase()) {
    throw new Error("Access denied: this credential does not belong to the connected wallet (subject-only enforcement).");
  }
}

// ---------------- Main Component ----------------
const HolderDashboard: React.FC = () => {
  const [latestCredential, setLatestCredential] = useState<Credential | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // lookup
  const [lookupInput, setLookupInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupResult, setLookupResult] = useState<any | null>(null);
  const [lookupResolvedCid, setLookupResolvedCid] = useState<string>("");
  const [lookupResolvedCredential, setLookupResolvedCredential] = useState<Credential | null>(null);

  // modals
  const [rawCredential, setRawCredential] = useState<any | null>(null);
  const [disclosureCredential, setDisclosureCredential] = useState<any | null>(null);
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [generatedProof, setGeneratedProof] = useState<string>("");
  const [activeCredential, setActiveCredential] = useState<Credential | null>(null);

  // verifier info
  const [verifierType, setVerifierType] = useState<"wallet" | "email" | "other">("wallet");
  const [verifierValue, setVerifierValue] = useState("");

  // email sending
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");

  useEffect(() => {
    const fetchLatestCredential = async () => {
      setLoading(true);
      setError("");
      setLatestCredential(null);

      try {
        const provider = await getProvider();
        const address = await getConnectedAddress(provider);
        const contract = getReadContract(provider);

        let ids: string[] = [];
        ids = await contract.getCredentialIdsBySubject(address);

        if (!ids || ids.length === 0) {
          setLatestCredential(null);
          return;
        }

        const fetched: Credential[] = await Promise.all(
          ids.map(async (id: string) => fetchOnChainCredential(provider, id))
        );

        const existing = fetched.filter((c) => c.status !== Status.None);
        if (existing.length === 0) {
          setLatestCredential(null);
          return;
        }

        existing.sort((a, b) => (a.issuedAt > b.issuedAt ? -1 : 1));
        setLatestCredential(existing[0]);
      } catch (err: any) {
        console.error("Failed to fetch credentials:", err);
        setError(err?.message || "Failed to load credentials. Check contract address/network/MetaMask.");
      } finally {
        setLoading(false);
      }
    };

    fetchLatestCredential();
  }, []);

  // ---------------- Handlers ----------------
  const handleViewRaw = async (cid: string) => {
    try {
      setError("");
      const data = await fetchEncryptedThenDecrypt(cid);
      setRawCredential(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load credential (decrypt/fetch).");
    }
  };

  const handleLookup = async () => {
    setLookupError("");
    setLookupResult(null);
    setLookupResolvedCid("");
    setLookupResolvedCredential(null);

    const input = lookupInput.replace(/\s+/g, "").trim();
    if (!input) {
      setLookupError("Paste a CID (bafy.../bafkrei...) or a Credential ID (0x...).");
      return;
    }

    try {
      setLookupLoading(true);

      const provider = await getProvider();
      const connected = await getConnectedAddress(provider);

      let credentialId: string | null = null;

      if (isHexCredentialId(input)) {
        credentialId = input;
      } else {
        if (!looksLikeCid(input)) {
          throw new Error("Invalid input. Paste a CID like bafy.../bafkrei... or a Credential ID like 0x...");
        }
        credentialId = await resolveCredentialIdByCidForConnectedSubject(provider, input);
      }

      const onChain = await fetchOnChainCredential(provider, credentialId);
      ensureSubjectOnly(connected, onChain);

      // HARD POLICY: do not disclose JSON if revoked
      if (onChain.status !== Status.Active) {
        setLookupResolvedCredential(onChain);
        setLookupResolvedCid(onChain.cid);
        throw new Error(`Credential is ${shortStatus(onChain.status)}. Disclosure is blocked.`);
      }

      if (!onChain.cid) throw new Error("On-chain CID is empty.");

      const json = await fetchEncryptedThenDecrypt(onChain.cid);

      setLookupResolvedCredential(onChain);
      setLookupResolvedCid(onChain.cid);
      setLookupResult(json);
    } catch (err: any) {
      console.error("Lookup failed:", err);
      setLookupError(err?.message || "Lookup failed.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleShare = async (cred: Credential) => {
    try {
      setError("");
      setEmailStatus("");

      const provider = await getProvider();
      const connected = await getConnectedAddress(provider);
      ensureSubjectOnly(connected, cred);

      if (cred.status !== Status.Active) {
        throw new Error(`Cannot share: credential is ${shortStatus(cred.status)}.`);
      }

      const data = await fetchEncryptedThenDecrypt(cred.cid);
      const merkleFields: string[] = data.merkleFields || [];

      if (!Array.isArray(merkleFields) || merkleFields.length === 0) {
        throw new Error("Credential JSON has no merkleFields array.");
      }

      setDisclosureCredential(data);
      setActiveCredential(cred);

      const initialSelections = merkleFields.reduce((acc: Record<string, boolean>, field: string) => {
        acc[field] = false;
        return acc;
      }, {});

      setSelectedFields(initialSelections);
      setGeneratedProof("");
      setVerifierType("wallet");
      setVerifierValue("");
      setEmailTo("");
    } catch (err: any) {
      setError(err?.message || "Failed to load credential for sharing.");
    }
  };

  const handleFieldSelection = (field: string) => {
    setSelectedFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleGenerateProof = () => {
    if (!disclosureCredential || !activeCredential) {
      setError("No active credential selected for sharing.");
      return;
    }

    const merkleFields: string[] = disclosureCredential.merkleFields || [];
    if (!Array.isArray(merkleFields) || merkleFields.length === 0) {
      setError("This credential has no merkleFields.");
      return;
    }

    const allFlattenedFields = flattenFieldsForMerkle(disclosureCredential, merkleFields);
    const { root, proofs } = buildMerkleFromFields(allFlattenedFields, merkleFields);

    const selectedPaths = Object.keys(selectedFields).filter((field) => selectedFields[field]);
    if (selectedPaths.length === 0) {
      setError("Select at least one field to share.");
      return;
    }

    const disclosedClaims = selectedPaths.reduce((acc: Record<string, string>, path: string) => {
      acc[path] = allFlattenedFields[path];
      return acc;
    }, {});

    const disclosedProofs = selectedPaths.reduce((acc: Record<string, any>, path: string) => {
      acc[path] = proofs[path];
      return acc;
    }, {});

    const payload: SharePayload = {
      credentialId: activeCredential.id,
      cid: activeCredential.cid,
      subjectAddress: activeCredential.subject,
      issuerAddress: activeCredential.issuer,
      merkleRoot: root,
      revealedFields: disclosedClaims,
      proofs: disclosedProofs,
      verifier: { type: verifierType, value: verifierValue.trim() },
      createdAt: new Date().toISOString(),
    };

    setGeneratedProof(JSON.stringify(payload, null, 2));
    setEmailStatus("");
    setError("");
  };

  // Send email via your Node/Express backend (NOT from browser directly)
  const handleSendEmail = async () => {
    setEmailStatus("");

    if (!generatedProof) {
      setEmailStatus("Generate the share package first.");
      return;
    }

    const to = emailTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setEmailStatus("Enter a valid recipient email address.");
      return;
    }

    try {
      setEmailSending(true);

      const res = await fetch("http://localhost:5050/api/mail/send-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: "BCVS Credential Share Package",
          shareJson: generatedProof,
          filename: "bcvs-share-package.json",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Email failed (HTTP ${res.status})`);
      }

      setEmailStatus(
        `✅ Email sent. messageId=${data?.messageId || "ok"}\nCheck Spam/Promotions if not visible.`
      );
    } catch (e: any) {
      setEmailStatus(`❌ ${e?.message || "Email send failed"}`);
    } finally {
      setEmailSending(false);
    }
  };

  // ---------------- Render helpers ----------------
  const renderLookupResult = () => {
    if (lookupLoading) {
      return (
        <p className="text-sm text-gray-400 mt-3">
          Resolving on-chain → status check → (if active) fetching + decrypting…
        </p>
      );
    }
    if (lookupError) {
      return <p className="text-sm text-red-400 mt-3 whitespace-pre-line">{lookupError}</p>;
    }
    if (!lookupResult) return null;

    const rows: { label: string; value: string }[] = [];
    Object.entries(friendlyFieldNames).forEach(([path, label]) => {
      const parts = path.split(".");
      let current: any = lookupResult;
      for (const p of parts) {
        if (current && typeof current === "object") current = current[p];
        else {
          current = undefined;
          break;
        }
      }
      if (current !== undefined && current !== null && current !== "") {
        rows.push({ label, value: String(current) });
      }
    });

    return (
      <div className="mt-4 bg-gray-900/60 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">Credential details</h3>

        {lookupResolvedCid && (
          <p className="text-xs text-gray-500 mb-3 break-all">
            Resolved CID: <span className="font-mono">{lookupResolvedCid}</span>
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">Credential loaded, but no mapped fields were found.</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-200">
            {rows.map((row) => (
              <li key={row.label}>
                <span className="font-semibold">{row.label}:</span>{" "}
                <span>{row.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderLookupCredentialCard = () => {
    if (!lookupResolvedCredential) return null;

    return (
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-white mb-3">Viewed credential</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <CredentialCard cred={lookupResolvedCredential} onViewRaw={handleViewRaw} onShare={handleShare} />
        </div>
      </div>
    );
  };

  const renderLatest = () => {
    if (loading) return <LoadingSpinner />;
    if (error) return <p className="text-red-500 text-center whitespace-pre-line">{error}</p>;
    if (!latestCredential) return <EmptyState />;

    return (
      <div className="grid gap-6 md:grid-cols-2">
        <CredentialCard cred={latestCredential} onViewRaw={handleViewRaw} onShare={handleShare} />
      </div>
    );
  };

  // ---------------- JSX ----------------
  return (
    <>
      <div className="bg-black text-gray-200 p-8 w-full max-w-5xl mx-auto font-sans">
        <h1 className="text-3xl font-bold text-white mb-2">Holder Dashboard</h1>
        <p className="text-md text-gray-400 mb-6">View and manage your digital credentials.</p>

        {/* View by CID or Credential ID */}
        <div className="mb-8 bg-gray-900/60 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-2">View credential by CID or Credential ID</h2>
          <p className="text-sm text-gray-400 mb-3">
            CID lookups are enforced: CID → resolve to your on-chain credential ID → status check → only then disclose
            decrypted JSON. This dashboard is <span className="font-semibold">subject-only</span>.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              placeholder="bafy... (CID) OR 0x... (credential id)"
              className="flex-1 bg-black border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500/60"
            />
            <button
              onClick={handleLookup}
              className="sm:w-44 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md text-sm transition-colors"
            >
              View
            </button>
          </div>

          {renderLookupResult()}
          {renderLookupCredentialCard()}
        </div>

        {/* Latest on-chain credential only */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white mb-3">Latest issued credential</h2>
          {renderLatest()}
        </div>
      </div>

      {rawCredential && <RawCredentialModal credential={rawCredential} onClose={() => setRawCredential(null)} />}

      {disclosureCredential && activeCredential && (
        <SelectiveDisclosureModal
          credential={disclosureCredential}
          selectedFields={selectedFields}
          generatedProof={generatedProof}
          verifierType={verifierType}
          verifierValue={verifierValue}
          onVerifierTypeChange={setVerifierType}
          onVerifierValueChange={setVerifierValue}
          onClose={() => {
            setDisclosureCredential(null);
            setGeneratedProof("");
            setSelectedFields({});
            setActiveCredential(null);
            setEmailTo("");
            setEmailStatus("");
          }}
          onFieldSelect={handleFieldSelection}
          onGenerateProof={handleGenerateProof}
          emailTo={emailTo}
          setEmailTo={setEmailTo}
          emailSending={emailSending}
          emailStatus={emailStatus}
          sendEmail={handleSendEmail}
        />
      )}
    </>
  );
};

// ---------------- Sub-components ----------------
const CredentialCard: React.FC<{
  cred: Credential;
  onViewRaw: (cid: string) => void;
  onShare: (cred: Credential) => void;
}> = ({ cred, onViewRaw, onShare }) => {
  const isRevoked = cred.status === Status.Revoked;

  return (
    <div
      className={`bg-gray-900/50 border border-gray-800 rounded-lg p-5 flex flex-col justify-between hover:border-green-500/50 transition-all ${
        isRevoked ? "opacity-50" : ""
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 11c0 3.517-1.009 6.79-2.93 9.563l-2.522-2.522M12 11V3m0 8c0 3.517 1.009 6.79 2.93 9.563l2.522-2.522M12 11H3m9 0h9"
              />
            </svg>
            <h2 className="font-bold text-lg text-white truncate">Credential</h2>
          </div>

          {isRevoked && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">REVOKED</span>
          )}
        </div>

        <p className="text-xs text-gray-500 mb-1">CREDENTIAL ID</p>
        <p className="font-mono text-xs text-gray-300 break-all mb-4">{cred.id}</p>

        <p className="text-xs text-gray-500 mb-1">ISSUER</p>
        <p className="font-mono text-xs text-gray-300 break-all">{cred.issuer}</p>
      </div>

      <div className="mt-5 flex gap-3">
        <button
          onClick={() => onViewRaw(cred.cid)}
          className="flex-1 bg-blue-600/80 hover:bg-blue-700/80 text-white font-bold py-2 px-4 rounded-md text-xs transition-colors"
          disabled={isRevoked}
          title={isRevoked ? "Revoked credentials cannot be disclosed" : ""}
        >
          View Raw
        </button>
        <button
          onClick={() => onShare(cred)}
          className="flex-1 bg-purple-600/80 hover:bg-purple-700/80 text-white font-bold py-2 px-4 rounded-md text-xs transition-colors"
          disabled={isRevoked}
          title={isRevoked ? "Revoked credentials cannot be shared" : ""}
        >
          Share to Verifier
        </button>
      </div>
    </div>
  );
};

const RawCredentialModal: React.FC<{ credential: any; onClose: () => void }> = ({ credential, onClose }) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Credential Data (Decrypted)</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
          &times;
        </button>
      </div>
      <div className="bg-black p-4 rounded-md overflow-y-auto">
        <pre className="text-sm text-green-400 whitespace-pre-wrap break-all">{JSON.stringify(credential, null, 2)}</pre>
      </div>
    </div>
  </div>
);

const SelectiveDisclosureModal: React.FC<{
  credential: any;
  selectedFields: Record<string, boolean>;
  generatedProof: string;
  verifierType: "wallet" | "email" | "other";
  verifierValue: string;
  onVerifierTypeChange: (t: "wallet" | "email" | "other") => void;
  onVerifierValueChange: (v: string) => void;
  onClose: () => void;
  onFieldSelect: (field: string) => void;
  onGenerateProof: () => void;

  emailTo: string;
  setEmailTo: (v: string) => void;
  emailSending: boolean;
  emailStatus: string;
  sendEmail: () => void;
}> = ({
  credential,
  selectedFields,
  generatedProof,
  verifierType,
  verifierValue,
  onVerifierTypeChange,
  onVerifierValueChange,
  onClose,
  onFieldSelect,
  onGenerateProof,
  emailTo,
  setEmailTo,
  emailSending,
  emailStatus,
  sendEmail,
}) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white">Share to Verifier</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
          &times;
        </button>
      </div>

      <div className="flex-grow overflow-y-auto pr-2">
        <div className="space-y-4 mb-5">
          <div>
            <p className="text-sm text-gray-400 mb-2">Who do you want to share with?</p>
            <div className="flex gap-2 mb-1">
              <select
                className="rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-100"
                value={verifierType}
                onChange={(e) => onVerifierTypeChange(e.target.value as any)}
              >
                <option value="wallet">Wallet address</option>
                <option value="email">Email</option>
                <option value="other">Other</option>
              </select>
              <input
                className="flex-1 rounded-md bg-black border border-gray-700 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-green-500/60"
                placeholder={
                  verifierType === "wallet"
                    ? "0x... verifier wallet (optional)"
                    : verifierType === "email"
                    ? "verifier@example.com"
                    : "Verifier identifier (optional)"
                }
                value={verifierValue}
                onChange={(e) => onVerifierValueChange(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-500">
              Stored inside the share package for auditing (who it was generated for).
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-400 mb-2">Select the fields you want to share:</p>
            {(credential.merkleFields || []).map((field: string) => (
              <label
                key={field}
                className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-md cursor-pointer hover:bg-gray-800 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedFields[field] || false}
                  onChange={() => onFieldSelect(field)}
                  className="h-4 w-4 rounded bg-gray-700 border-gray-600 text-green-500 focus:ring-green-500/50"
                />
                <span className="text-sm font-mono">
                  {field} {friendlyFieldNames[field] ? `(${friendlyFieldNames[field]})` : ""}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={onGenerateProof}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md transition-colors mb-4"
        >
          Generate Share Package
        </button>

        {generatedProof && (
          <div className="space-y-3">
            <div>
              <h3 className="font-bold text-white text-sm mb-2">Share Package (JSON)</h3>
              <div className="bg-black p-4 rounded-md relative">
                <pre className="text-xs text-green-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {generatedProof}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(generatedProof)}
                  className="absolute top-2 right-2 bg-gray-700/50 hover:bg-gray-600 text-white p-1 rounded-md text-xs"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-400">
              Send this JSON to a verifier. They paste it into the Verifier dashboard to check authenticity against
              on-chain status + Merkle root while only seeing the fields you selected.
            </div>
          </div>
        )}

        {/* Email section */}
        <div className="mt-6 border-t border-gray-700 pt-4">
          <h3 className="text-sm font-bold text-white mb-2">Send to Verifier via Email</h3>
          <input
            type="email"
            placeholder="verifier@example.com"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            className="w-full bg-black border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500/60"
          />

          {!generatedProof && (
            <p className="text-xs text-yellow-400 mt-2">
              Generate the share package first (select fields → Generate).
            </p>
          )}

          <button
            onClick={sendEmail}
            disabled={!generatedProof || emailSending}
            className="mt-3 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md transition-colors"
          >
            {emailSending ? "Sending..." : "Send Email (JSON + attachment)"}
          </button>

          {emailStatus && (
            <p className="text-xs mt-2 text-gray-300 whitespace-pre-line">
              {emailStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  </div>
);

const LoadingSpinner: React.FC = () => (
  <div className="flex justify-center items-center p-10">
    <div className="w-10 h-10 border-4 border-gray-700 border-t-green-500 rounded-full animate-spin" />
  </div>
);

const EmptyState: React.FC = () => (
  <div className="text-center py-16 px-6 border-2 border-dashed border-gray-800 rounded-lg">
    <svg className="w-12 h-12 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
    <h2 className="text-xl font-bold text-gray-400">No On-Chain Credentials</h2>
    <p className="text-sm text-gray-500 mt-2">
      No credentials were found for this wallet. Issue at least one credential to this address from the Issuer dashboard.
    </p>
  </div>
);

export default HolderDashboard;
