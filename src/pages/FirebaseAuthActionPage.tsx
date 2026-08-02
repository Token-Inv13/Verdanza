import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Seo } from "../components/Seo";
import { BRAND_LOGO, BRAND_LOGO_ALT } from "../lib/brandAssets";
import {
  classifyFirebaseAuthActionError,
  confirmFirebasePasswordReset,
  parseFirebaseAuthAction,
  prepareFirebaseAuthAction,
  type FirebaseAuthActionErrorKind,
  type FirebaseAuthActionRequest,
} from "../lib/firebaseAuthActions";
import { loadFirebaseAuthApi } from "../lib/firebaseAuth";

type PageState =
  | { kind: "loading" }
  | { kind: "password-form" }
  | { kind: "success"; mode: FirebaseAuthActionRequest["mode"] }
  | { kind: "error"; error: FirebaseAuthActionErrorKind | "unsupported" };

const initialRequest = () =>
  parseFirebaseAuthAction(typeof window === "undefined" ? "" : window.location.search);

export function FirebaseAuthActionPage() {
  const [parsedRequest] = useState(initialRequest);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [formError, setFormError] = useState("");
  const hasStarted = useRef(false);

  const executeAction = useCallback(async () => {
    if (!parsedRequest.ok) {
      setState({ kind: "error", error: "unsupported" });
      return;
    }

    setState({ kind: "loading" });
    try {
      const { auth, firebaseAuth } = await loadFirebaseAuthApi();
      if (!auth) throw new Error("Firebase is not configured.");
      auth.languageCode = "fr";
      const result = await prepareFirebaseAuthAction(auth, parsedRequest.request, firebaseAuth);
      setState(
        result === "password-form"
          ? { kind: "password-form" }
          : { kind: "success", mode: parsedRequest.request.mode },
      );
    } catch (error) {
      setState({ kind: "error", error: classifyFirebaseAuthActionError(error) });
    }
  }, [parsedRequest]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", "/auth/action");
    }
    if (hasStarted.current) return;
    hasStarted.current = true;
    void executeAction();
  }, [executeAction]);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!parsedRequest.ok || parsedRequest.request.mode !== "resetPassword") {
      setState({ kind: "error", error: "unsupported" });
      return;
    }
    if (password.length < 8) {
      setFormError("Choisissez un mot de passe d’au moins 8 caractères.");
      return;
    }
    if (password !== passwordConfirmation) {
      setFormError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setState({ kind: "loading" });
    try {
      const { auth, firebaseAuth } = await loadFirebaseAuthApi();
      if (!auth) throw new Error("Firebase is not configured.");
      await confirmFirebasePasswordReset(auth, parsedRequest.request, password, firebaseAuth);
      setPassword("");
      setPasswordConfirmation("");
      setState({ kind: "success", mode: "resetPassword" });
    } catch (error) {
      setState({ kind: "error", error: classifyFirebaseAuthActionError(error) });
    }
  };

  const returnPath = parsedRequest.ok ? parsedRequest.request.continuePath || "/connexion" : "/connexion";

  return (
    <main className="min-h-screen bg-[#f7f3e8] px-4 py-8 text-[#123f32] sm:px-6 sm:py-14">
      <Seo
        title="Sécurité du compte | Verdanza"
        description="Confirmez en toute sécurité une action liée à votre compte Verdanza."
        path="/auth/action"
        noindex
      />
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-[#d9c490]/60 bg-white p-6 shadow-xl shadow-[#123f32]/10 sm:p-10">
        <a href="/" className="mx-auto block w-fit rounded-lg focus:outline-none focus:ring-2 focus:ring-[#b88a2b] focus:ring-offset-4">
          <img src={BRAND_LOGO} alt={BRAND_LOGO_ALT} className="h-20 w-auto" />
        </a>
        <div className="mt-7 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#b88a2b]">Espace sécurisé</p>
          <h1 className="mt-3 font-serif text-3xl text-[#123f32]">Sécurité du compte Verdanza</h1>
        </div>

        <div className="mt-8" aria-live="polite">
          {state.kind === "loading" && (
            <div role="status" className="rounded-2xl bg-[#f7f3e8] p-5 text-center">
              <p className="font-medium">Vérification du lien en cours…</p>
            </div>
          )}

          {state.kind === "password-form" && (
            <form onSubmit={submitPassword} className="space-y-5">
              <p className="text-sm leading-6 text-[#315f51]">Définissez un nouveau mot de passe pour sécuriser votre compte.</p>
              <label className="block text-sm font-semibold">
                Nouveau mot de passe
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[#b7c7be] px-4 py-3 text-base outline-none focus:border-[#b88a2b] focus:ring-2 focus:ring-[#b88a2b]/30"
                />
              </label>
              <label className="block text-sm font-semibold">
                Confirmer le mot de passe
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[#b7c7be] px-4 py-3 text-base outline-none focus:border-[#b88a2b] focus:ring-2 focus:ring-[#b88a2b]/30"
                />
              </label>
              {formError && <p role="alert" className="text-sm font-medium text-red-700">{formError}</p>}
              <button type="submit" className="w-full rounded-xl bg-[#123f32] px-5 py-3 font-semibold text-white transition hover:bg-[#1b5745] focus:outline-none focus:ring-2 focus:ring-[#b88a2b] focus:ring-offset-2">
                Enregistrer le nouveau mot de passe
              </button>
            </form>
          )}

          {state.kind === "success" && <SuccessMessage mode={state.mode} returnPath={returnPath} />}

          {state.kind === "error" && (
            <ErrorMessage error={state.error} onRetry={state.error === "network" ? executeAction : undefined} />
          )}
        </div>

        {state.kind !== "success" && (
          <a href="/connexion" className="mt-7 block text-center text-sm font-semibold underline decoration-[#b88a2b] underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[#b88a2b]">
            Retour à la connexion
          </a>
        )}
      </section>
    </main>
  );
}

function SuccessMessage({ mode, returnPath }: { mode: FirebaseAuthActionRequest["mode"]; returnPath: string }) {
  const message =
    mode === "resetPassword"
      ? "Votre mot de passe a été modifié."
      : mode === "verifyEmail"
        ? "Votre adresse e-mail a été validée."
        : "Votre demande de sécurité a été traitée.";

  return (
    <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
      <h2 className="font-serif text-2xl text-[#123f32]">Action confirmée</h2>
      <p className="mt-3 text-sm leading-6 text-[#315f51]">{message}</p>
      <a href={returnPath} className="mt-6 inline-flex rounded-xl bg-[#123f32] px-5 py-3 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#b88a2b] focus:ring-offset-2">
        Continuer sur Verdanza
      </a>
    </div>
  );
}

function ErrorMessage({ error, onRetry }: { error: FirebaseAuthActionErrorKind | "unsupported"; onRetry?: () => Promise<void> }) {
  const content =
    error === "expired"
      ? ["Lien expiré", "Ce lien n’est plus valable. Demandez un nouvel e-mail depuis la page de connexion."]
      : error === "network"
        ? ["Connexion interrompue", "La vérification n’a pas pu aboutir. Vérifiez votre connexion puis réessayez."]
        : error === "unsupported"
          ? ["Lien non pris en charge", "Ce lien est incomplet ou ne correspond pas à une action Verdanza reconnue."]
          : ["Lien invalide", "Ce lien n’est pas valide ou a déjà été utilisé. Demandez un nouvel e-mail si nécessaire."];

  return (
    <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
      <h2 className="font-serif text-2xl text-[#123f32]">{content[0]}</h2>
      <p className="mt-3 text-sm leading-6 text-[#315f51]">{content[1]}</p>
      {onRetry && (
        <button type="button" onClick={() => void onRetry()} className="mt-5 rounded-xl border border-[#123f32] px-5 py-2.5 font-semibold text-[#123f32] focus:outline-none focus:ring-2 focus:ring-[#b88a2b] focus:ring-offset-2">
          Réessayer
        </button>
      )}
    </div>
  );
}
