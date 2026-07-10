import { Link } from "react-router-dom";
import { JsonLd } from "./JsonLd";
import { buildBreadcrumbJsonLd, type BreadcrumbItem } from "../lib/structuredData";

export type BreadcrumbLink = BreadcrumbItem & {
  current?: boolean;
};

export function Breadcrumbs({
  items,
  structuredData = true,
}: {
  items: BreadcrumbLink[];
  structuredData?: boolean;
}) {
  const pagePath = items[items.length - 1]?.path || "/";
  const schemaItems = items.map(({ name, path }) => ({ name, path }));

  return (
    <>
      <nav
        aria-label="Fil d'Ariane"
        className="mb-6 text-xs font-medium uppercase tracking-[0.14em] text-forest/60"
      >
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {items.map((item, index) => {
            const isLast = index === items.length - 1 || item.current;
            return (
              <li key={`${item.path}-${item.name}`} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true" className="text-champagne">/</span>}
                {isLast ? (
                  <span aria-current="page" className="text-forest">
                    {item.name}
                  </span>
                ) : (
                  <Link className="transition hover:text-forest" to={item.path}>
                    {item.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {structuredData && schemaItems.length >= 2 && (
        <JsonLd id="breadcrumb" data={buildBreadcrumbJsonLd(schemaItems, pagePath)} />
      )}
    </>
  );
}
