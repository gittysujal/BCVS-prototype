import React, { useState } from "react";
import { ethers } from "ethers";
import { verifyDisclosedProof } from "../credentialMerkle";
import {
  CREDENTIAL_REGISTRY_ADDRESS,
  CREDENTIAL_REGISTRY_ABI,
} from "../lib/constants";

// allow window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

const friendlyFieldNames: Record<string, string> = {
  "holder.name": "Name",
  "holder.studentId": "Student ID",
  "credential.courseName": "Course Name",
  "credential.degreeClassification": "Degree Classification",
  "credential.gpa": "GPA",
  "credential.universityName": "University",
};

const Status = {
  None: 0,
  Active: 1,
  Revoked: 2,
} as const;

type Status = (typeof Status)[keyof typeof Status];

const statusLabel = (s: number) =>
  s === Status.Active ? "ACTIVE" : s === Status.Revoked ? "REVOKED" : "NONE";

type VerificationUiResult = {
  isValid: boolean;
  verifiedClaims: Record<string, string>;
  onChain: {
    credentialId: string;
    status: Status;
    issuer: string;
    subject: string;
    merkleRootOnChain: string;
    cid: string;
  } | null;
  notes: string[];
};

const Verifier: React.FC = () => {
  const [proofText, setProofText] = useState("");
  const [result, setResult] = useState<VerificationUiResult | null>(null);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    setError("");
    setResult(null);
    setVerifying(true);

    try {
      // 1) Parse proof JSON
      const proofObject = JSON.parse(proofText);

      // Basic schema checks (fail fast)
      if (
        !proofObject ||
        typeof proofObject !== "object" ||
        typeof proofObject.credentialId !== "string" ||
        typeof proofObject.merkleRoot !== "string" ||
        typeof proofObject.revealedFields !== "object" ||
        typeof proofObject.proofs !== "object"
      ) {
        throw new Error(
          "Malformed share package. Expected { credentialId, merkleRoot, revealedFields, proofs, ... }"
        );
      }

      const credentialId = proofObject.credentialId.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(credentialId)) {
        throw new Error("Invalid credentialId. Must be bytes32 hex (0x + 64 hex chars).");
      }

      // 2) Local cryptographic verification (Merkle proof)
      const local = verifyDisclosedProof(proofObject);
      const notes: string[] = [];

      if (!local?.isValid) {
        // If Merkle proof fails, do NOT bother querying chain.
        setResult({
          isValid: false,
          verifiedClaims: local?.verifiedClaims || {},
          onChain: null,
          notes: ["Merkle proof verification failed locally."],
        });
        return;
      }

      // 3) On-chain verification (status + root binding)
      if (!window.ethereum) {
        throw new Error("MetaMask not found. Verifier requires blockchain read access.");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      // read-only is enough; but request accounts helps ensure correct network selection in MetaMask UI
      await provider.send("eth_requestAccounts", []);

      const contract = new ethers.Contract(
        CREDENTIAL_REGISTRY_ADDRESS,
        CREDENTIAL_REGISTRY_ABI,
        provider
      );

      const [statusRaw, cred] = await Promise.all([
        contract.statusOf(credentialId),
        contract.getCredential(credentialId),
      ]);

      const status = Number(statusRaw) as Status;

      const issuer = String(cred?.[0] || "");
      const subject = String(cred?.[1] || "");
      const merkleRootOnChain = String(cred?.[2] || "");
      const cid = String(cred?.[3] || "");

      // Check 1: credential must exist + be active
      if (status === Status.None || issuer === ethers.ZeroAddress) {
        notes.push("Credential does not exist on-chain (Status: NONE).");
        setResult({
          isValid: false,
          verifiedClaims: local.verifiedClaims,
          onChain: {
            credentialId,
            status,
            issuer,
            subject,
            merkleRootOnChain,
            cid,
          },
          notes,
        });
        return;
      }

      if (status !== Status.Active) {
        notes.push("Credential is not active (revoked/inactive). Verification rejected.");
        setResult({
          isValid: false,
          verifiedClaims: local.verifiedClaims,
          onChain: {
            credentialId,
            status,
            issuer,
            subject,
            merkleRootOnChain,
            cid,
          },
          notes,
        });
        return;
      }

      // Check 2: bind proof root to on-chain root
      // proofObject.merkleRoot is the computed root used for disclosed claims.
      const proofRoot = String(proofObject.merkleRoot || "");

      if (
        !proofRoot ||
        !/^0x[0-9a-fA-F]{64}$/.test(proofRoot) ||
        merkleRootOnChain.toLowerCase() !== proofRoot.toLowerCase()
      ) {
        notes.push("Merkle root mismatch: share package root does not match on-chain root.");
        setResult({
          isValid: false,
          verifiedClaims: local.verifiedClaims,
          onChain: {
            credentialId,
            status,
            issuer,
            subject,
            merkleRootOnChain,
            cid,
          },
          notes,
        });
        return;
      }

      // If we reached here: cryptographically valid + active + root matches chain
      notes.push("Merkle proofs validated locally.");
      notes.push("On-chain status is ACTIVE.");
      notes.push("On-chain merkleRoot matches share package root.");

      setResult({
        isValid: true,
        verifiedClaims: local.verifiedClaims,
        onChain: {
          credentialId,
          status,
          issuer,
          subject,
          merkleRootOnChain,
          cid,
        },
        notes,
      });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Invalid JSON or verification failure.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-black text-gray-200 p-8 w-full max-w-4xl mx-auto font-sans">
      <h1 className="text-2xl font-bold text-white mb-2">Credential Verifier</h1>
      <p className="text-sm text-gray-400 mb-6">
        Paste a selective disclosure share package to verify its authenticity (Merkle proofs + on-chain status).
      </p>

      <div className="space-y-4">
        <textarea
          rows={10}
          className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 font-mono text-sm"
          placeholder='Paste the JSON share package here (from "Generate Share Package" in Holder dashboard)...'
          value={proofText}
          onChange={(e) => setProofText(e.target.value)}
        />
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md"
        >
          {verifying ? "Verifying..." : "Verify Proof"}
        </button>
      </div>

      {error && <p className="text-red-500 mt-4">{error}</p>}

      {result && (
        <div className="mt-6">
          <h2 className="text-xl font-bold text-white">Verification Result</h2>

          <div
            className={`mt-2 p-4 rounded-lg border ${
              result.isValid
                ? "bg-green-900/50 border-green-700"
                : "bg-red-900/50 border-red-700"
            }`}
          >
            <p className={`font-bold ${result.isValid ? "text-green-400" : "text-red-400"}`}>
              {result.isValid ? "✅ VERIFIED (VALID + ACTIVE ON-CHAIN)" : "❌ REJECTED"}
            </p>

            {result.onChain && (
              <div className="mt-3 text-xs text-gray-200 space-y-1">
                <p>
                  Credential ID: <span className="font-mono break-all">{result.onChain.credentialId}</span>
                </p>
                <p>
                  Status:{" "}
                  <span className="font-bold">
                    {statusLabel(result.onChain.status)}
                  </span>
                </p>
                <p>
                  Issuer: <span className="font-mono break-all">{result.onChain.issuer}</span>
                </p>
                <p>
                  Subject: <span className="font-mono break-all">{result.onChain.subject}</span>
                </p>
                <p>
                  Merkle Root (on-chain):{" "}
                  <span className="font-mono break-all">{result.onChain.merkleRootOnChain}</span>
                </p>
                <p>
                  CID (on-chain):{" "}
                  <span className="font-mono break-all">{result.onChain.cid}</span>
                </p>
              </div>
            )}

            {result.isValid && (
              <>
                <h3 className="font-bold text-white mt-4">Verified Claims:</h3>
                <ul className="list-disc list-inside mt-2 text-sm">
                  {Object.entries(result.verifiedClaims).map(([key, value]) => (
                    <li key={key}>
                      <span className="font-semibold">{friendlyFieldNames[key] ?? key}:</span>{" "}
                      {value}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {result.notes.length > 0 && (
              <div className="mt-4">
                <h4 className="font-bold text-white text-sm mb-2">Checks performed</h4>
                <ul className="list-disc list-inside text-xs text-gray-200 space-y-1">
                  {result.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Verifier;
