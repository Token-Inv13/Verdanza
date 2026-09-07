import { CagnottePanel } from "../../components/cagnotte/CagnottePanel";
import { CAGNOTTE_READ_DISPLAY_ENABLED } from "../../config/cagnotteFeatures";
import { Seo } from "../../components/Seo";
import { useAuth } from "../../context/AuthContext";

export function AccountAdvantagesPage() {
  const { user } = useAuth();
  return (
    <div>
      <Seo title="Mes avantages - Verdanza CBD" description="Consultation des avantages Verdanza." path="/compte/avantages" noindex />
      <CagnottePanel enabled={CAGNOTTE_READ_DISPLAY_ENABLED} identityKey={user?.uid ?? null} scope="self" />
    </div>
  );
}
