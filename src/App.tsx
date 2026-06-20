import { Navigate, Route, Routes } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { HomePage } from "./pages/HomePage";
import { ShopPage } from "./pages/ShopPage";
import { CategoryPage } from "./pages/CategoryPage";
import { ProductPage } from "./pages/ProductPage";
import { DeliveryPage } from "./pages/DeliveryPage";
import { ContentPage } from "./pages/ContentPage";
import { CartPage } from "./pages/CartPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { CheckoutCancelPage } from "./pages/CheckoutCancelPage";
import { CheckoutSuccessPage } from "./pages/CheckoutSuccessPage";
import { LegalPage } from "./pages/LegalPage";
import { AdminPage } from "./pages/admin/AdminPage";
import { AdminAuthGate } from "./components/AdminAuthGate";

export function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<HomePage />} />
        <Route path="boutique" element={<ShopPage />} />
        <Route
          path="fleurs-cbd"
          element={<CategoryPage category="flowers" title="Fleurs CBD" />}
        />
        <Route
          path="resines-cbd"
          element={<CategoryPage category="resins" title="Resines CBD" />}
        />
        <Route path="produits/:slug" element={<ProductPage />} />
        <Route
          path="livraison-express-aix"
          element={<DeliveryPage mode="local" />}
        />
        <Route path="livraison-postale" element={<DeliveryPage mode="postal" />} />
        <Route
          path="qualite-conformite"
          element={<ContentPage variant="quality" />}
        />
        <Route path="a-propos" element={<ContentPage variant="about" />} />
        <Route path="faq" element={<ContentPage variant="faq" />} />
        <Route path="contact" element={<ContentPage variant="contact" />} />
        <Route path="panier" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="checkout/success" element={<CheckoutSuccessPage />} />
        <Route path="checkout/cancel" element={<CheckoutCancelPage />} />
        <Route
          path="mentions-legales"
          element={<LegalPage title="Mentions legales" />}
        />
        <Route path="cgv" element={<LegalPage title="Conditions generales de vente" />} />
        <Route
          path="confidentialite"
          element={<LegalPage title="Politique de confidentialite" />}
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
          <Route path="coupons" element={<AdminPage section="Coupons" />} />
          <Route path="parametres" element={<AdminPage section="Parametres" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
