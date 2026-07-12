import { FormEvent, useState } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { trackContactClick } from "../lib/analytics";

const content = {
  quality: {
    title: "Qualité & conformité",
    text: "Verdanza sélectionne une gamme courte de produits CBD, avec une attention particulière portée à la conformité, à la traçabilité et à la clarté des informations transmises aux clients.",
    points: [
      "Sélection contrôlée",
      "THC conforme selon analyses producteur",
      "Produits réservés aux adultes",
      "Aucune promesse médicale",
      "Traçabilité et transparence",
      "Besoin d'une information avant commande ?",
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
    text: "Réponses pratiques sur les produits, la conformité, la livraison et le règlement.",
    points: [
      "Les produits sont-ils réservés aux majeurs ? Oui.",
      "Le THC est-il conforme ? Les fiches indiquent un taux inférieur à 0,3 %.",
      "Quels modes de livraison sont proposés ? Livraison postale en France et livraison locale selon zone disponible.",
      "Comment se passe le règlement ? Verdanza vous contacte après validation pour confirmer les disponibilités, la livraison et le règlement.",
    ],
  },
  contact: {
    title: "Contact",
    text: "Contactez Verdanza pour toute question produit, commande ou livraison locale.",
    points: [
      "Réponse par email après réception du message",
      "Indiquez votre numéro si la demande concerne une livraison",
      "Aucune donnée bancaire ne doit être transmise via ce formulaire",
      "Horaires livraison locale : 7j/7 de 11h a 01h",
    ],
  },
} as const;

const contentPaths: Record<keyof typeof content, string> = {
  quality: "/qualite-conformite",
  about: "/a-propos",
  faq: "/faq",
  contact: "/contact",
};

export function ContentPage({ variant }: { variant: keyof typeof content }) {
  const page = content[variant];
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
    "contact@verdanza.fr";
  return (
    <main className="container-page py-12">
      <Seo
        title={`${page.title} - Verdanza CBD`}
        description={page.text}
        path={contentPaths[variant]}
      />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: page.title, path: contentPaths[variant], current: true },
        ]}
      />
      <div className="page-intro">
        <h1>{page.title}</h1>
        <p>{page.text}</p>
      </div>
      {variant === "contact" && contactEmail && (
        <p className="mt-6 text-sm text-forest/80">
          Email direct :{" "}
          <a
            className="underline decoration-champagne"
            href={`mailto:${contactEmail}`}
            onClick={() => trackContactClick("email", "contact_page")}
          >
            {contactEmail}
          </a>
        </p>
      )}
      {variant === "contact" && <ContactForm />}
      {variant === "quality" && <QualityTrustSection />}
      {variant !== "quality" && (
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {page.points.map((point) => (
            <article key={point} className="feature-panel">
              <h2>{point}</h2>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function QualityTrustSection() {
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
    "contact@verdanza.fr";

  const sections = [
    {
      title: "Sélection contrôlée",
      text: "La sélection Verdanza reste volontairement courte afin de mieux suivre les références proposées, leur présentation, leur fraîcheur et leur cohérence avec les attentes clients.",
    },
    {
      title: "THC conforme selon analyses producteur",
      text: "Les fleurs et résines CBD sont proposées sur la base des informations et analyses transmises par les producteurs. Les taux de THC annoncés doivent rester conformes au cadre applicable.",
    },
    {
      title: "Produits réservés aux adultes",
      text: "Les produits Verdanza sont réservés aux personnes majeures. Ils doivent être tenus hors de portée des enfants et ne sont pas destinés aux mineurs.",
    },
    {
      title: "Aucune promesse médicale",
      text: "Les produits CBD proposés ne sont pas des médicaments, ne remplacent pas un traitement médical et ne font l'objet d'aucune promesse thérapeutique.",
    },
    {
      title: "Traçabilité et transparence",
      text: "Verdanza conserve les informations producteur disponibles et peut répondre aux questions avant commande : origine, culture, taux annoncés, profil aromatique ou disponibilité.",
    },
    {
      title: "Contrôle visuel avant mise en vente",
      text: "Chaque référence est vérifiée visuellement avant mise en avant : aspect, texture, cohérence de la fiche produit et disponibilité réelle du stock.",
    },
  ];

  return (
    <section className="mt-10 grid gap-6">
      <div className="rounded-lg border border-champagne/30 bg-cream p-6">
        <h2 className="font-display text-3xl text-forest">
          Une démarche simple : clarté, conformité, disponibilité
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-ink/70">
          Verdanza privilégie une information sobre et vérifiable. Les fiches
          produits distinguent fleurs et résines CBD, précisent les données
          disponibles, et évitent toute allégation excessive.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <article key={section.title} className="feature-panel">
            <h2>{section.title}</h2>
            <p className="mt-3 text-sm leading-6 text-ink/70">{section.text}</p>
          </article>
        ))}
      </div>
      <div className="rounded-lg border border-forest/10 bg-ivory p-6">
        <h2 className="font-display text-3xl text-forest">
          Besoin d'une information avant commande ?
        </h2>
        <p className="mt-4 leading-7 text-ink/70">
          Pour toute question sur un produit ou une commande, vous pouvez
          contacter Verdanza par email à{" "}
          <a
            className="underline decoration-champagne"
            href={`mailto:${contactEmail}`}
            onClick={() => trackContactClick("email", "contact_page")}
          >
            {contactEmail}
          </a>
          .
        </p>
      </div>
    </section>
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
      trackContactClick("formulaire", "contact_page");
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
        Société
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
