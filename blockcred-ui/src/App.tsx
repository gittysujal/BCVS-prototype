import { useState, type FC } from "react";
import IssuerDashboard from "./components/IssuerDashboard";
import HolderDashboard from "./components/HolderDashboard";
import Login from "./components/Login";
import VerifierDashboard from "./components/Verifier"; // Renamed import

type Role = "issuer" | "holder" | "verifier";

const App: FC = () => {
  const [user, setUser] = useState<{ role: Role; walletAddress: string } | null>(
    null
  );

  const handleLogin = (role: Role, walletAddress: string) => {
    setUser({ role, walletAddress });
  };

  const handleLogout = () => {
    setUser(null);
  };

  const renderDashboard = () => {
    if (window.location.pathname === "/verifier") { // Changed path to /verifier
      return <VerifierDashboard />;
    }

    if (!user) {
      return <Login onLogin={handleLogin} />;
    }

    switch (user.role) {
      case "issuer":
        return <IssuerDashboard />;
      case "holder":
        return <HolderDashboard />;
      case "verifier":
        return <VerifierDashboard />; // Use VerifierDashboard here
      default:
        return <Login onLogin={handleLogin} />;
    }
  };

  return (
    <div className="min-h-screen bg-black text-green-100">
      <header className="border-b border-green-700/40 bg-black/80">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={handleLogout} className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-green-300">
              BCVS
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-green-500/60 text-green-200">
              MVP
            </span>
          </button>

          {user && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-green-300">
                {user.role.charAt(0).toUpperCase() + user.role.slice(1)} view
              </span>
              <button
                onClick={handleLogout}
                className="text-xs text-red-400 hover:underline"
              >
                Logout
              </button>
            </div>
          )}

          <div className="text-xs text-green-400">
            Local demo • chain 1337
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">{renderDashboard()}</main>
    </div>
  );
};

export default App;
