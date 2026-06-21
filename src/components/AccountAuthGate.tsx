import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function AccountAuthGate() {
  const { isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="container-page py-16">
        <p className="text-forest/70">Verification du compte...</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
