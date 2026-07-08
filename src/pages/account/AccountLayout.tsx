import { NavLink, Outlet } from "react-router-dom";
import { Seo } from "../../components/Seo";
import { useAuth } from "../../context/AuthContext";

const accountLinks = [
  { to: "/compte", label: "Tableau de bord", end: true },
  { to: "/compte/commandes", label: "Commandes" },
  { to: "/compte/favoris", label: "Mes favoris" },
  { to: "/compte/profil", label: "Profil" },
];

export function AccountLayout() {
  const { user, signOut } = useAuth();

  return (
    <main className="container-page py-12">
      <Seo
        title="Mon compte - Verdanza CBD"
        description="Espace client Verdanza CBD."
      />
      <div className="page-intro">
        <h1>Mon compte</h1>
        <p>{user?.email}</p>
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit rounded-lg border border-forest/10 bg-cream p-4">
          <nav className="grid gap-2 text-sm">
            {accountLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 ${
                    isActive ? "bg-forest text-ivory" : "text-forest hover:bg-ivory"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <button
            className="btn-secondary mt-5 w-full"
            onClick={() => void signOut()}
          >
            Deconnexion
          </button>
        </aside>
        <Outlet />
      </div>
    </main>
  );
}
