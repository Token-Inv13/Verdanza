import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export function AccountOverviewPage() {
  const { customerProfile } = useAuth();

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <AccountStat label="Commandes" value={customerProfile?.orderCount ?? 0} />
      <AccountStat
        label="Total depense"
        value={`${Number(customerProfile?.totalSpent ?? 0).toFixed(2).replace(".", ",")} EUR`}
      />
      <AccountStat label="Points prepares" value={customerProfile?.loyaltyPoints ?? 0} />
      <div className="rounded-lg border border-forest/10 bg-ivory p-6 md:col-span-3">
        <h2 className="font-display text-3xl text-forest">Suivi client</h2>
        <p className="mt-3 text-sm leading-6 text-ink/65">
          Votre espace regroupe les commandes rattachees a votre compte lorsque
          vous commandez en etant connecte.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/compte/commandes" className="btn-primary">
            Voir mes commandes
          </Link>
          <Link to="/compte/profil" className="btn-secondary">
            Modifier mon profil
          </Link>
        </div>
      </div>
    </section>
  );
}

function AccountStat({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-lg border border-forest/10 bg-ivory p-6">
      <p className="text-sm text-ink/55">{label}</p>
      <strong className="mt-2 block font-display text-4xl text-forest">
        {value}
      </strong>
    </article>
  );
}
