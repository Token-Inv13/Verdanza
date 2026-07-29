import { FormEvent, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Seo } from "./Seo";

export function AdminAuthGate() {
  const {
    isLoading,
    isAdmin,
    user,
    isFirebaseConfigured,
    signIn,
    signInWithGoogle,
    resetPassword,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
      <AdminGateShell message="Connexion administrateur indisponible pour le moment." />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
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

  async function handleResetPassword() {
    setError("");
    setMessage("");
    if (!email) {
      setError("Renseigner l'email admin avant de demander un nouveau mot de passe.");
      return;
    }
    try {
      await resetPassword(email);
      setMessage("Email de reinitialisation envoye si le compte existe.");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Reinitialisation impossible.",
      );
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Connexion Google impossible.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cream px-4">
      <Seo
        title="Acces administrateur - Verdanza CBD"
        description="Accès réservé Verdanza."
        path="/admin"
        noindex
      />
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-forest/10 bg-ivory p-8 shadow-soft"
      >
        <LockKeyhole className="text-champagne" />
        <h1 className="mt-4 font-display text-4xl text-forest">Admin Verdanza</h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">
          Connectez-vous avec un compte administrateur autorise.
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
          <span className="relative mt-2 block">
            <input
              type={isPasswordVisible ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input-field pr-12"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 grid w-12 place-items-center text-forest/65 transition hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-champagne"
              onClick={() => setIsPasswordVisible((visible) => !visible)}
              aria-label={isPasswordVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              aria-pressed={isPasswordVisible}
            >
              {isPasswordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </span>
        </label>
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-4 text-sm text-forest">{message}</p>}
        <button className="btn-primary mt-6 w-full" disabled={isSubmitting}>
          {isSubmitting ? "Connexion..." : "Se connecter"}
        </button>
        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-ink/40">
          <span className="h-px flex-1 bg-forest/10" />
          ou
          <span className="h-px flex-1 bg-forest/10" />
        </div>
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => void handleGoogleSignIn()}
          disabled={isSubmitting}
        >
          Continuer avec Google
        </button>
        <button
          type="button"
          className="mt-4 text-sm font-medium text-forest underline decoration-champagne"
          onClick={() => void handleResetPassword()}
        >
          Mot de passe oublie
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
      <Seo
        title="Acces administrateur - Verdanza CBD"
        description="Accès réservé Verdanza."
        path="/admin"
        noindex
      />
      <div className="max-w-md rounded-lg border border-forest/10 bg-ivory p-8 text-center shadow-soft">
        <LockKeyhole className="mx-auto text-champagne" />
        <h1 className="mt-4 font-display text-4xl text-forest">Acces admin</h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">{message}</p>
      </div>
    </div>
  );
}
