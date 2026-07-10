import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { Seo } from "../components/Seo";
import { useAuth } from "../context/AuthContext";
import { trackEvent } from "../lib/analytics";

type AuthMode = "login" | "register";

export function AuthPage({ mode }: { mode: AuthMode }) {
  const {
    user,
    isFirebaseConfigured,
    signIn,
    register,
    signInWithGoogle,
    resetPassword,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const redirectTo =
    typeof location.state === "object" &&
    location.state &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/compte";

  if (user) return <Navigate to={redirectTo} replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      if (mode === "register") await register(email, password, displayName);
      else await signIn(email, password);
      trackEvent(mode === "register" ? "signup" : "login", { method: "password" });
      navigate(redirectTo, { replace: true });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentification impossible.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      trackEvent(mode === "register" ? "signup" : "login", { method: "google" });
      navigate(redirectTo, { replace: true });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Connexion Google impossible.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    setError("");
    setMessage("");
    if (!email) {
      setError("Renseigner votre email avant de demander un nouveau mot de passe.");
      return;
    }
    try {
      await resetPassword(email);
      setMessage("Email de reinitialisation envoye si le compte existe.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Reset impossible.");
    }
  }

  return (
    <main className="container-page py-12">
      <Seo
        title={mode === "register" ? "Inscription - Verdanza CBD" : "Connexion - Verdanza CBD"}
        description="Connexion client Verdanza CBD."
        path={mode === "register" ? "/inscription" : "/connexion"}
        noindex
      />
      <section className="mx-auto max-w-lg rounded-lg border border-forest/10 bg-ivory p-8 shadow-soft">
        <h1 className="font-display text-5xl text-forest">
          {mode === "register" ? "Créer un compte" : "Connexion"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink/65">
          Retrouvez vos commandes et facilitez vos prochaines commandes.
        </p>

        {!isFirebaseConfigured && (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Le service de connexion est temporairement indisponible.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          {mode === "register" && (
            <AuthInput label="Nom affiché" value={displayName} onChange={setDisplayName} />
          )}
          <AuthInput label="Email" type="email" value={email} onChange={setEmail} />
          <AuthInput
            label="Mot de passe"
            type="password"
            value={password}
            onChange={setPassword}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          {message && <p className="text-sm text-forest">{message}</p>}
          <button className="btn-primary w-full" disabled={isSubmitting || !isFirebaseConfigured}>
            {isSubmitting
              ? "Traitement..."
              : mode === "register"
                ? "Créer le compte"
                : "Se connecter"}
          </button>
        </form>

        <button
          className="btn-secondary mt-4 w-full"
          onClick={() => void handleGoogle()}
          disabled={isSubmitting || !isFirebaseConfigured}
        >
          Continuer avec Google
        </button>

        {mode === "login" && (
          <button
            className="mt-4 text-sm font-medium text-forest underline decoration-champagne"
            onClick={() => void handleResetPassword()}
          >
            Mot de passe oublie
          </button>
        )}

        <p className="mt-6 text-sm text-ink/65">
          {mode === "register" ? "Deja un compte ?" : "Pas encore de compte ?"}{" "}
          <Link
            className="font-medium text-forest underline decoration-champagne"
            to={mode === "register" ? "/connexion" : "/inscription"}
            state={{ from: redirectTo }}
          >
            {mode === "register" ? "Se connecter" : "Créer un compte"}
          </Link>
        </p>
      </section>
    </main>
  );
}

function AuthInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPassword = type === "password";

  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <span className="relative mt-2 block">
        <input
          className={`input-field ${isPassword ? "pr-12" : ""}`}
          type={isPassword && isPasswordVisible ? "text" : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={isPassword ? "current-password" : undefined}
          required
        />
        {isPassword && (
          <button
            type="button"
            className="absolute inset-y-0 right-0 grid w-12 place-items-center text-forest/65 transition hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-champagne"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            aria-pressed={isPasswordVisible}
          >
            {isPasswordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        )}
      </span>
    </label>
  );
}
