import { useState, useMemo } from "react";
import type { FC } from "react";
import type { FormEvent } from "react";


interface ShareToVerifierSectionProps {
  credentialId: string;
  cid: string;
  subjectAddress: string;
  issuerAddress: string;
  merkleRoot: string;
  resolvedData: Record<string, any>; // raw JSON from IPFS
}

interface SharePayload {
  credentialId: string;
  cid: string;
  subjectAddress: string;
  issuerAddress: string;
  merkleRoot: string;
  revealedFields: Record<string, string>;
  verifier: {
    type: "wallet" | "email" | "other";
    value: string;
  };
  createdAt: string; // ISO timestamp
}

const ShareToVerifierSection: FC<ShareToVerifierSectionProps> = ({
  credentialId,
  cid,
  subjectAddress,
  issuerAddress,
  merkleRoot,
  resolvedData,
}) => {
  const [verifierType, setVerifierType] = useState<"wallet" | "email" | "other">(
    "wallet",
  );
  const [verifierValue, setVerifierValue] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [shareJson, setShareJson] = useState<string>("");
  const [shareCode, setShareCode] = useState<string>(""); // base64 version
  const [error, setError] = useState<string | null>(null);

  // Only simple string-like fields are shown as options
  const shareableFields = useMemo(
    () =>
      Object.entries(resolvedData || {})
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key]) => key),
    [resolvedData],
  );

  const toggleField = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleGenerateShare = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!cid || !credentialId) {
      setError("No credential loaded. Please load a credential first.");
      return;
    }

    if (selectedKeys.length === 0) {
      setError("Select at least one field to share.");
      return;
    }

    const revealedFields: Record<string, string> = {};
    for (const key of selectedKeys) {
      const val = resolvedData[key];
      if (val !== undefined && val !== null) {
        revealedFields[key] = String(val);
      }
    }

    const payload: SharePayload = {
      credentialId,
      cid,
      subjectAddress,
      issuerAddress,
      merkleRoot,
      revealedFields,
      verifier: {
        type: verifierType,
        value: verifierValue.trim(),
      },
      createdAt: new Date().toISOString(),
    };

    const json = JSON.stringify(payload, null, 2);
    setShareJson(json);

    // Optional: base64 code for shorter string
    try {
      const encoded = btoa(json);
      setShareCode(encoded);
    } catch {
      // ignore if running in older env, json display will still work
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Share package copied to clipboard.");
    } catch {
      alert("Could not copy to clipboard. Please copy manually.");
    }
  };

  if (!resolvedData || Object.keys(resolvedData).length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 text-lg font-semibold">Share to Verifier</h2>
        <p className="text-sm text-gray-600">
          Load a credential first to enable selective sharing.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Share to Verifier</h2>
      <p className="mb-4 text-sm text-gray-600">
        Choose which fields you want to disclose and generate a share package that
        you can send to a verifier.
      </p>

      <form className="space-y-4" onSubmit={handleGenerateShare}>
        {/* 1. Verifier info */}
        <div>
          <label className="mb-1 block text-sm font-medium">Verifier identifier</label>
          <div className="flex gap-2">
            <select
              className="rounded-lg border px-2 py-1 text-sm"
              value={verifierType}
              onChange={(e) =>
                setVerifierType(e.target.value as "wallet" | "email" | "other")
              }
            >
              <option value="wallet">Wallet address</option>
              <option value="email">Email</option>
              <option value="other">Other</option>
            </select>
            <input
              className="flex-1 rounded-lg border px-2 py-1 text-sm"
              placeholder={
                verifierType === "wallet"
                  ? "0x... verifier wallet (optional)"
                  : verifierType === "email"
                    ? "verifier@example.com"
                    : "Verifier identifier (optional)"
              }
              value={verifierValue}
              onChange={(e) => setVerifierValue(e.target.value)}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            This is purely informational for now so you know who you generated this
            package for.
          </p>
        </div>

        {/* 2. Fields to share */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Fields you want to disclose
          </label>
          {shareableFields.length === 0 ? (
            <p className="text-xs text-gray-500">
              No simple text/number fields found in this credential.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {shareableFields.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedKeys.includes(key)}
                    onChange={() => toggleField(key)}
                  />
                  <span className="capitalize">{key}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Example: select only <strong>name</strong> and{" "}
            <strong>studentId</strong> if you just want to prove identity.
          </p>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* 3. Generate button */}
        <button
          type="submit"
          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Generate share package
        </button>
      </form>

      {/* 4. Output */}
      {shareJson && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Share JSON</span>
              <button
                onClick={() => handleCopy(shareJson)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Copy JSON
              </button>
            </div>
            <textarea
              className="h-40 w-full rounded-lg border bg-gray-50 p-2 text-xs font-mono"
              readOnly
              value={shareJson}
            />
          </div>

          {shareCode && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">Compact share code (base64)</span>
                <button
                  onClick={() => handleCopy(shareCode)}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Copy code
                </button>
              </div>
              <textarea
                className="h-24 w-full rounded-lg border bg-gray-50 p-2 text-xs font-mono"
                readOnly
                value={shareCode}
              />
              <p className="mt-1 text-xs text-gray-500">
                The verifier can paste this code into their dashboard. It decodes back
                to the JSON above.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShareToVerifierSection;
