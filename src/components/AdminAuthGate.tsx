import { FormEvent, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function AdminAuthGate() {
  const { isLoading, isAdmin, user, isFirebaseConfigured, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) {
    return <AdminGateShell message="Verification admin..." />;
  }

  if (isAdmin) return <Outlet />;

  if (user && !isAdmin) {
    return (
      <AdminGateShell message="Compte connecte, mais non autorise dans adminUsers." />
    );
  }

  if (!isFirebaseConfigured) {
    return (
      <AdminGateShell message="Firebase n'est pas configure. Renseigner .env.local pour activer l'auth admin." />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await signIn(email, password);
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Connexion impossible.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cream px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-forest/10 bg-ivory p-8 shadow-soft"
      >
        <LockKeyhole className="text-champagne" />
        <h1 className="mt-4 font-display text-4xl text-forest">Admin Verdanza</h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">
          Connectez-vous avec un compte Firebase Auth autorise dans la collection
          adminUsers.
        </p>
        <label className="mt-6 block text-sm font-medium text-forest">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input-field mt-2"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-forest">
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field mt-2"
            required
          />
        </label>
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        <button className="btn-primary mt-6 w-full" disabled={isSubmitting}>
          {isSubmitting ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

function AdminGateShell({ message }: { message: string }) {
  if (message === "Compte connecte, mais non autorise dans adminUsers.") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cream px-4">
      <div className="max-w-md rounded-lg border border-forest/10 bg-ivory p-8 text-center shadow-soft">
        <LockKeyhole className="mx-auto text-champagne" />
        <h1 className="mt-4 font-display text-4xl text-forest">Acces admin</h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">{message}</p>
      </div>
    </div>
  );
}
