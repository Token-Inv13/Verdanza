import { FormEvent, useState } from "react";
import { Seo } from "../components/Seo";

const content = {
  quality: {
    title: "Qualite & conformite",
    text: "Verdanza privilegie une selection courte, tracable et conforme, reservee aux adultes.",
    points: [
      "THC conforme selon analyse fournisseur",
      "Produits reserves aux personnes majeures",
      "Produits naturels selectionnes avec exigence",
      "Aucune promesse medicale",
    ],
  },
  about: {
    title: "A propos",
    text: "Verdanza est une marque inspiree par la Provence, construite autour d'une experience vegetale sobre, premium et transparente.",
    points: [
      "Selection CBD premium",
      "Boutique en ligne avec livraison en France",
      "Livraison locale selon zone disponible",
      "Design naturel et haut de gamme",
    ],
  },
  faq: {
    title: "FAQ",
    text: "Reponses pratiques sur les produits, la conformite, la livraison et le reglement.",
    points: [
      "Les produits sont-ils reserves aux majeurs ? Oui.",
      "Le THC est-il conforme ? Les fiches indiquent un taux inferieur a 0,3 %.",
      "Quels modes de livraison sont proposes ? Livraison postale en France et livraison locale selon zone disponible.",
      "Comment se passe le reglement ? Verdanza vous contacte apres validation pour confirmer les disponibilites, la livraison et le reglement.",
    ],
  },
  contact: {
    title: "Contact",
    text: "Contactez Verdanza pour toute question produit, commande ou livraison locale.",
    points: [
      "Reponse par email apres reception du message",
      "Indiquez votre numero si la demande concerne une livraison",
      "Aucune donnee bancaire ne doit etre transmise via ce formulaire",
      "Horaires livraison locale : 7j/7 de 11h a 01h",
    ],
  },
} as const;

export function ContentPage({ variant }: { variant: keyof typeof content }) {
  const page = content[variant];
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL as string | undefined;
  return (
    <main className="container-page py-12">
      <Seo title={`${page.title} - Verdanza CBD`} description={page.text} />
      <div className="page-intro">
        <h1>{page.title}</h1>
        <p>{page.text}</p>
      </div>
      {variant === "contact" && contactEmail && (
        <p className="mt-6 text-sm text-forest/80">
          Email direct :{" "}
          <a className="underline decoration-champagne" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        </p>
      )}
      {variant === "contact" && <ContactForm />}
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {page.points.map((point) => (
          <article key={point} className="feature-panel">
            <h2>{point}</h2>
          </article>
        ))}
      </div>
    </main>
  );
}

function ContactForm() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
    company: "",
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("submitting");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Message non envoye.");
      setStatus("sent");
      setForm({
        name: "",
        email: "",
        phone: "",
        subject: "",
        message: "",
        company: "",
      });
    } catch (contactError) {
      setStatus("idle");
      setError(
        contactError instanceof Error
          ? contactError.message
          : "Message non envoye.",
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-10 grid gap-4 rounded-lg border border-forest/10 bg-cream p-6"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <ContactInput
          label="Nom"
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
        />
        <ContactInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(email) => setForm({ ...form, email })}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ContactInput
          label="Téléphone"
          required={false}
          value={form.phone}
          onChange={(phone) => setForm({ ...form, phone })}
        />
        <ContactInput
          label="Sujet"
          value={form.subject}
          onChange={(subject) => setForm({ ...form, subject })}
        />
      </div>
      <label className="text-sm font-medium text-forest">
        Message
        <textarea
          className="input-field mt-2 min-h-40 resize-y"
          value={form.message}
          onChange={(event) => setForm({ ...form, message: event.target.value })}
          minLength={10}
          maxLength={3000}
          required
        />
      </label>
      <label className="hidden">
        Societe
        <input
          value={form.company}
          onChange={(event) => setForm({ ...form, company: event.target.value })}
          tabIndex={-1}
          autoComplete="off"
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {status === "sent" && (
        <p className="text-sm text-forest">
          Message transmis. Verdanza vous recontactera par email.
        </p>
      )}
      <button
        className="btn-primary w-full justify-center md:w-fit"
        type="submit"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Envoi..." : "Envoyer le message"}
      </button>
    </form>
  );
}

function ContactInput({
  label,
  value,
  onChange,
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <input
        className="input-field mt-2"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}
