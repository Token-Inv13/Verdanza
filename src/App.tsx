import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { AnalyticsRouteTracker } from "./components/AnalyticsRouteTracker";
import { ScrollToTop } from "./components/ScrollToTop";
import { HomePage } from "./pages/HomePage";
import { ShopPage } from "./pages/ShopPage";
import { CategoryPage } from "./pages/CategoryPage";
import { ProductPage } from "./pages/ProductPage";
import { BlogPage } from "./pages/BlogPage";
import { BlogArticlePage } from "./pages/BlogArticlePage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { ContentPage } from "./pages/ContentPage";
import { FlyerLandingPage } from "./pages/FlyerLandingPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const AdminLayout = lazy(() =>
  import("./layouts/AdminLayout").then((module) => ({ default: module.AdminLayout })),
);
const AdminPage = lazy(() =>
  import("./pages/admin/AdminPage").then((module) => ({ default: module.AdminPage })),
);
const AdminAuthGate = lazy(() =>
  import("./components/AdminAuthGate").then((module) => ({ default: module.AdminAuthGate })),
);
const AccountAuthGate = lazy(() =>
  import("./components/AccountAuthGate").then((module) => ({ default: module.AccountAuthGate })),
);
const AccountLayout = lazy(() =>
  import("./pages/account/AccountLayout").then((module) => ({ default: module.AccountLayout })),
);
const AccountOverviewPage = lazy(() =>
  import("./pages/account/AccountOverviewPage").then((module) => ({
    default: module.AccountOverviewPage,
  })),
);
const AccountOrdersPage = lazy(() =>
  import("./pages/account/AccountOrdersPage").then((module) => ({
    default: module.AccountOrdersPage,
  })),
);
const AccountProfilePage = lazy(() =>
  import("./pages/account/AccountProfilePage").then((module) => ({
    default: module.AccountProfilePage,
  })),
);
const AccountFavoritesPage = lazy(() =>
  import("./pages/account/AccountFavoritesPage").then((module) => ({
    default: module.AccountFavoritesPage,
  })),
);
const AuthPage = lazy(() =>
  import("./pages/AuthPage").then((module) => ({ default: module.AuthPage })),
);
const CartPage = lazy(() =>
  import("./pages/CartPage").then((module) => ({ default: module.CartPage })),
);
const CheckoutPage = lazy(() =>
  import("./pages/CheckoutPage").then((module) => ({ default: module.CheckoutPage })),
);
const CheckoutCancelPage = lazy(() =>
  import("./pages/CheckoutCancelPage").then((module) => ({
    default: module.CheckoutCancelPage,
  })),
);
const CheckoutSuccessPage = lazy(() =>
  import("./pages/CheckoutSuccessPage").then((module) => ({
    default: module.CheckoutSuccessPage,
  })),
);
const LegalPage = lazy(() =>
  import("./pages/LegalPage").then((module) => ({ default: module.LegalPage })),
);

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <AnalyticsRouteTracker />
      <ScrollToTop />
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="boutique" element={<ShopPage />} />
          <Route path="decouvrir-verdanza" element={<FlyerLandingPage />} />
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogArticlePage />} />
          <Route
            path="fleurs-cbd"
            element={<CategoryPage category="flowers" title="Fleurs CBD" />}
          />
          <Route
            path="resines-cbd"
            element={<CategoryPage category="resins" title="Résines CBD" />}
          />
          <Route path="produits/:slug" element={<ProductPage />} />
          <Route path="livraison" element={<DeliveryPage mode="overview" />} />
          <Route
            path="livraison-express-aix"
            element={<DeliveryPage mode="local" />}
          />
          <Route path="livraison-locale" element={<DeliveryPage mode="local" />} />
          <Route path="livraison-postale" element={<DeliveryPage mode="postal" />} />
          <Route
            path="qualite-conformite"
            element={<ContentPage variant="quality" />}
          />
          <Route path="a-propos" element={<ContentPage variant="about" />} />
          <Route path="faq" element={<ContentPage variant="faq" />} />
          <Route path="contact" element={<ContentPage variant="contact" />} />
          <Route path="panier" element={<CartPage />} />
          <Route path="connexion" element={<AuthPage mode="login" />} />
          <Route path="inscription" element={<AuthPage mode="register" />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="checkout/success" element={<CheckoutSuccessPage />} />
          <Route path="checkout/cancel" element={<CheckoutCancelPage />} />
          <Route element={<AccountAuthGate />}>
            <Route path="compte" element={<AccountLayout />}>
              <Route index element={<AccountOverviewPage />} />
              <Route path="commandes" element={<AccountOrdersPage />} />
              <Route path="favoris" element={<AccountFavoritesPage />} />
              <Route path="profil" element={<AccountProfilePage />} />
            </Route>
          </Route>
          <Route
            path="mentions-legales"
            element={<LegalPage title="Mentions légales" />}
          />
          <Route path="cgv" element={<LegalPage title="Conditions générales de vente" />} />
          <Route
            path="confidentialite"
            element={<LegalPage title="Politique de confidentialité" />}
          />
          <Route path="retours" element={<LegalPage title="Politique de retour" />} />
        </Route>
        <Route element={<AdminAuthGate />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminPage section="Dashboard" />} />
            <Route path="produits" element={<AdminPage section="Produits" />} />
            <Route path="stocks" element={<AdminPage section="Stocks" />} />
            <Route path="commandes" element={<AdminPage section="Commandes" />} />
            <Route
              path="livraisons"
              element={<AdminPage section="Livraisons locales" />}
            />
            <Route path="clients" element={<AdminPage section="Clients" />} />
            <Route path="favoris" element={<AdminPage section="Favoris produits" />} />
            <Route path="avis" element={<AdminPage section="Avis clients" />} />
            <Route path="coupons" element={<AdminPage section="Coupons" />} />
            <Route path="bannieres" element={<AdminPage section="Bannieres" />} />
            <Route path="factures" element={<Navigate to="/admin/comptabilite?tab=factures" replace />} />
            <Route path="comptabilite" element={<AdminPage section="Comptabilité" />} />
            <Route
              path="facturation"
              element={<Navigate to="/admin/comptabilite?tab=facturation" replace />}
            />
            <Route path="parametres" element={<AdminPage section="Paramètres" />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

function RouteFallback() {
  return (
    <div className="container-page min-h-[45vh] py-16" role="status" aria-live="polite">
      <p className="text-sm font-medium text-forest/70">Chargement...</p>
    </div>
  );
}
