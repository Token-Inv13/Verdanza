import { useParams } from "react-router-dom";
import { Seo } from "../components/Seo";
import { ReferralInvitation } from "../components/referral/ReferralInvitation";
import { REFERRAL_DISPLAY_CONFIGURATION } from "../config/referralFeatures";
import { useAuth } from "../context/AuthContext";

export function ReferralLinkPage() {
  const { code = "" } = useParams();
  const { user } = useAuth();
  return <main className="container-page py-12">
    <Seo title="Invitation Verdanza" description="Votre invitation Verdanza." path={`/parrainage/${code}`} noindex />
    {REFERRAL_DISPLAY_CONFIGURATION.displayEnabled && user ? <ReferralInvitation key={`${user.uid}:${code}`} code={code} /> :
      <p>Le parrainage n’est pas disponible pour le moment.</p>}
  </main>;
}
