import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminArchiveCategories,
  filterArchiveItems,
  sortArchiveItems,
  type AdminArchiveCategory,
  type AdminArchiveItem,
  type ArchiveSortDirection,
} from "../../lib/adminArchives";
import {
  loadAdminArchiveCategory,
  restoreAdminArchiveItem,
} from "../../services/adminArchivesService";

type ArchiveState = {
  items: AdminArchiveItem[];
  source: "firestore" | "local" | "empty";
  loading: boolean;
  error: string;
};

const emptyState: ArchiveState = {
  items: [],
  source: "empty",
  loading: false,
  error: "",
};

export default function AdminArchivesPage() {
  const [activeCategory, setActiveCategory] = useState<AdminArchiveCategory>("orders");
  const [states, setStates] = useState<Partial<Record<AdminArchiveCategory, ArchiveState>>>({});
  const [search, setSearch] = useState("");
  const [sortDirection, setSortDirection] = useState<ArchiveSortDirection>("newest");
  const [message, setMessage] = useState("");

  const activeState = states[activeCategory] || { ...emptyState, loading: true };
  const isActiveCategoryLoaded = Boolean(states[activeCategory]);

  const visibleItems = useMemo(
    () => sortArchiveItems(filterArchiveItems(activeState.items, search), sortDirection),
    [activeState.items, search, sortDirection],
  );

  const loadCategory = useCallback(async (category: AdminArchiveCategory) => {
    setStates((current) => ({
      ...current,
      [category]: {
        ...(current[category] || emptyState),
        loading: true,
        error: "",
      },
    }));
    try {
      const result = await loadAdminArchiveCategory(category);
      setStates((current) => ({
        ...current,
        [category]: {
          items: result.items,
          source: result.source,
          loading: false,
          error: "",
        },
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [category]: {
          ...(current[category] || emptyState),
          loading: false,
          error: error instanceof Error ? error.message : "Chargement des archives impossible.",
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (states[activeCategory]?.items || states[activeCategory]?.loading) return;
    void loadCategory(activeCategory);
  }, [activeCategory, loadCategory, states]);

  async function handleRestore(item: AdminArchiveItem) {
    if (!item.canRestore) return;
    const confirmed = window.confirm(
      `Restaurer "${item.title}" dans sa section d'origine ? Seuls les champs d'archivage seront retires.`,
    );
    if (!confirmed) return;
    setMessage("");
    try {
      await restoreAdminArchiveItem(item);
      setMessage(`${item.title} restaure dans sa section d'origine.`);
      await loadCategory(item.category);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restauration impossible.");
    }
  }

  return (
    <section className="grid min-w-0 gap-6">
      <header className="admin-card flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">Verdanza</p>
          <h1 className="font-display text-4xl text-forest md:text-5xl">Archives</h1>
          <p className="mt-2 max-w-3xl text-sm text-ink/60">
            Consultez les documents archives sans les deplacer de leur collection.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary min-h-10 px-4 py-2"
          onClick={() => void loadCategory(activeCategory)}
        >
          Rafraichir
        </button>
      </header>

      <section className="min-w-0 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
        <div className="border-b border-forest/10 bg-cream/70 p-4">
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max gap-2">
              {adminArchiveCategories.map((category) => {
                const state = states[category.key];
                const count = state ? state.items.length : "...";
                const isActive = activeCategory === category.key;
                return (
                  <button
                    key={category.key}
                    type="button"
                    className={
                      isActive
                        ? "btn-primary min-h-9 px-3 py-1.5 text-xs"
                        : "btn-secondary min-h-9 px-3 py-1.5 text-xs"
                    }
                    onClick={() => setActiveCategory(category.key)}
                  >
                    {category.label} - {count}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="grid gap-1 text-sm font-semibold text-forest">
              Recherche
              <input
                className="min-h-10 rounded-md border border-forest/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/30"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nom, reference, statut..."
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-forest">
              Tri
              <select
                className="min-h-10 rounded-md border border-forest/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/30"
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as ArchiveSortDirection)}
              >
                <option value="newest">Plus recentes</option>
                <option value="oldest">Plus anciennes</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-ink/50">
            Source : {activeState.source}. Les donnees sont chargees uniquement pour l'onglet consulte.
          </p>
        </div>

        {message && (
          <div className="border-b border-forest/10 bg-cream px-4 py-3 text-sm text-forest">
            {message}
          </div>
        )}

        {activeState.loading && (
          <ArchiveEmptyState
            title="Chargement des archives..."
            description="Lecture de la collection selectionnee."
          />
        )}

        {activeState.error && !activeState.loading && (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {activeState.error}
          </div>
        )}

        {isActiveCategoryLoaded && !activeState.loading && !activeState.error && !activeState.items.length && (
          <ArchiveEmptyState
            title="Aucune archive dans cet onglet."
            description="Les elements archives apparaitront ici apres leur archivage depuis leur section d'origine."
          />
        )}

        {!activeState.loading && !activeState.error && !!activeState.items.length && !visibleItems.length && (
          <ArchiveEmptyState
            title="Aucun resultat."
            description="Modifiez la recherche ou changez d'onglet."
          />
        )}

        {!!visibleItems.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
                <tr>
                  {[
                    "Element",
                    "Type",
                    "Archive le",
                    "Statut precedent",
                    "Information",
                    "Actions",
                  ].map((header) => (
                    <th key={header} className="px-4 py-3 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={`${item.category}-${item.id}`} className="border-t border-forest/10">
                    <td className="px-4 py-4">
                      <strong className="block text-forest">{item.title}</strong>
                      <span className="text-xs text-ink/50">{item.subtitle || item.id}</span>
                    </td>
                    <td className="px-4 py-4">{item.typeLabel || "-"}</td>
                    <td className="px-4 py-4">{formatArchiveDate(item.archivedAt)}</td>
                    <td className="px-4 py-4">{item.previousStatus || "-"}</td>
                    <td className="px-4 py-4 text-ink/70">{item.detail || "-"}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Link className="btn-secondary min-h-9 px-3 py-2" to={item.href}>
                          Consulter
                        </Link>
                        {item.canRestore ? (
                          <button
                            type="button"
                            className="btn-primary min-h-9 px-3 py-2"
                            onClick={() => void handleRestore(item)}
                          >
                            Restaurer
                          </button>
                        ) : (
                          <span className="rounded-full border border-forest/10 px-3 py-2 text-xs text-ink/50">
                            {item.restoreBlockedReason || "Restauration indisponible"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function ArchiveEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <h2 className="font-display text-3xl text-forest">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-ink/60">{description}</p>
    </div>
  );
}

function formatArchiveDate(value: unknown) {
  const timestamp = archiveDateValue(value);
  if (!timestamp) return "Non communiquee";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function archiveDateValue(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    const candidate = value as { seconds?: number; toDate?: () => Date; toMillis?: () => number };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.toDate === "function") return candidate.toDate().getTime();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return 0;
}
