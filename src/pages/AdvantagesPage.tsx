import { useEffect, useRef } from "react";
import { AdvantagesHub } from "../components/AdvantagesHub";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { CAGNOTTE_READ_DISPLAY_ENABLED } from "../config/cagnotteFeatures";
import { useConsent } from "../context/ConsentContext";
import { trackCtaClick, trackEvent } from "../lib/analytics";

export function AdvantagesPage() {
  const { analyticsAllowed } = useConsent();
  const trackedView = useRef(false);
  useEffect(() => {
    if (!analyticsAllowed) { trackedView.current = false; return; }
    if (trackedView.current) return;
    trackedView.current = true;
    trackEvent("advantages_view", { page_path: "/avantages" });
  }, [analyticsAllowed]);

  return (
    <main className="advantages-hub container-page" data-advantages-hub>
      <Seo title="Avantages Verdanza – Concours et fidélité"
        description="Découvrez les concours et avantages clients proposés par Verdanza." path="/avantages" />
      <Breadcrumbs items={[{ name: "Accueil", path: "/" }, { name: "Avantages", path: "/avantages", current: true }]} />
      <header className="advantages-hub__intro">
        <p className="advantages-hub__eyebrow">Avantages Verdanza</p>
        <h1>Plus de raisons de revenir.</h1>
        <p className="advantages-hub__description">Retrouvez nos concours, vos avantages fidélité et les prochains programmes clients Verdanza.</p>
      </header>
      <AdvantagesHub loyaltyEnabled={CAGNOTTE_READ_DISPLAY_ENABLED} onEntryClick={(entry) => {
        trackCtaClick({ ctaId: `advantages_${entry.id}`, ctaLocation: "advantages_hub",
          destinationPath: entry.to, ctaCategory: entry.id === "contest" ? "contest" : "loyalty" });
        trackEvent(entry.event, { destination_path: entry.to });
      }} />
    </main>
  );
}
