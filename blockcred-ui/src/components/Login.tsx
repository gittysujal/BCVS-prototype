import { useState, type FC } from "react";

type Role = "issuer" | "holder" | "verifier";

interface LoginProps {
  onLogin: (role: Role, walletAddress: string) => void;
}

const Login: FC<LoginProps> = ({ onLogin }) => {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRoleSelection = (role: Role) => {
    setSelectedRole(role);
  };

  const handleLogin = async () => {
    if (!selectedRole) {
      setErrorMessage("Please select a role.");
      return;
    }

    if (!window.ethereum) {
      setErrorMessage(
        <>
          No wallet found. Please{" "}
          <a
            href="https://metamask.io/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            install MetaMask
          </a>
          .
        </>
      );
      return;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const walletAddress = accounts[0];
      onLogin(selectedRole, walletAddress);
    } catch (err: unknown) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong during login.";
      setErrorMessage(message);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-black/40 rounded-xl text-green-100">
      <h1 className="text-2xl font-semibold mb-6 text-center">
        Welcome to Blockchain Credential Verification System
      </h1>
      <p className="text-center text-green-300 mb-8">
        The safest way to issue, hold, and verify a credential.
      </p>
      <p className="text-center text-green-300 mb-8">
        Please select your role to continue.
      </p>

      <div className="flex justify-center space-x-4 mb-8">
        <button
          onClick={() => handleRoleSelection("issuer")}
          className={`px-6 py-2 rounded-full text-sm font-medium transition ${
            selectedRole === "issuer"
              ? "bg-green-500 text-black"
              : "bg-black/40 hover:bg-green-500/20"
          }`}
        >
          Issuer
        </button>
        <button
          onClick={() => handleRoleSelection("holder")}
          className={`px-6 py-2 rounded-full text-sm font-medium transition ${
            selectedRole === "holder"
              ? "bg-green-500 text-black"
              : "bg-black/40 hover:bg-green-500/20"
          }`}
        >
          Holder
        </button>
        <button
          onClick={() => handleRoleSelection("verifier")}
          className={`px-6 py-2 rounded-full text-sm font-medium transition ${
            selectedRole === "verifier"
              ? "bg-green-500 text-black"
              : "bg-black/40 hover:bg-green-500/20"
          }`}
        >
          Verifier
        </button>
      </div>

      {errorMessage && (
        <div className="text-red-400 text-sm text-center mb-4">
          {errorMessage}
        </div>
      )}

      <div className="text-center">
        <button
          onClick={handleLogin}
          disabled={!selectedRole}
          className={`w-full px-6 py-3 rounded-full text-lg font-semibold transition ${
            selectedRole
              ? "bg-green-500 text-black hover:bg-green-400"
              : "bg-gray-500/40 text-gray-400 cursor-not-allowed"
          }`}
        >
          Login with MetaMask
        </button>
      </div>
    </div>
  );
};

export default Login;
