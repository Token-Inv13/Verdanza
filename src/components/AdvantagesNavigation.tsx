import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getAdvantagesEntries, isAdvantagesPath } from "../lib/advantages";

// A disclosure containing normal links, not an ARIA menu requiring arrow-key navigation.
export function AdvantagesNavigation({ loyaltyEnabled, onNavigate }: {
  loyaltyEnabled: boolean;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  const navigate = (path: string) => { setOpen(false); onNavigate(path); };
  return (
    <div ref={rootRef} className="advantages-navigation" data-advantages-navigation
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        toggleRef.current?.focus();
      }}>
      <NavLink to="/avantages" onClick={() => navigate("/avantages")}
        className={`advantages-navigation__link${isAdvantagesPath(pathname) ? " is-active" : ""}`}>
        Avantages
      </NavLink>
      <button ref={toggleRef} type="button" className="advantages-navigation__toggle"
        aria-label={open ? "Fermer le menu Avantages" : "Ouvrir le menu Avantages"}
        aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className="advantages-navigation__panel">
        <ul>
          <li><NavLink to="/avantages" onClick={() => navigate("/avantages")}>Vue d’ensemble</NavLink></li>
          {getAdvantagesEntries(loyaltyEnabled).filter((entry) => entry.id !== "loyalty" || entry.status === "active")
            .map((entry) => (
              <li key={entry.id}>
                {entry.status === "active" ? (
                  <NavLink to={entry.to} onClick={() => navigate(entry.to)}>{entry.navigationLabel}</NavLink>
                ) : <span className="advantages-navigation__soon">{entry.navigationLabel}<small>Bientôt</small></span>}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
