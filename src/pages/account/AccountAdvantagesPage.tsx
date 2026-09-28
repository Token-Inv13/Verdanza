import { lazy, Suspense } from "react";
import { REFERRAL_DISPLAY_CONFIGURATION } from "../../config/referralFeatures";
import { CagnottePanel } from "../../components/cagnotte/CagnottePanel";
import { CAGNOTTE_READ_DISPLAY_ENABLED } from "../../config/cagnotteFeatures";
import { Seo } from "../../components/Seo";
import { useAuth } from "../../context/AuthContext";

const ReferralPanel = lazy(() => import("../../components/referral/ReferralPanel").then((module) => ({ default: module.ReferralPanel })));

export function AccountAdvantagesPage() {
  const { user } = useAuth();
  return (
    <div>
      <Seo title="Mes avantages - Verdanza CBD" description="Consultation des avantages Verdanza." path="/compte/avantages" noindex />
      <CagnottePanel enabled={CAGNOTTE_READ_DISPLAY_ENABLED} identityKey={user?.uid ?? null} scope="self" />
      {REFERRAL_DISPLAY_CONFIGURATION.displayEnabled && user ? <Suspense fallback={<p role="status">Chargement du parrainage…</p>}>
        <ReferralPanel enabled identityKey={user.uid} />
      </Suspense> : null}
    </div>
  );
}
