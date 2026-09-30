import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AdminDialog } from "../../src/components/admin/AdminDialog";
import { AdminConfirmDialog } from "../../src/components/admin/AdminConfirmDialog";
import { AdminPage } from "../../src/pages/admin/AdminPage";
import { AdminLayout } from "../../src/layouts/AdminLayout";
import { confirmFixture, fixture, fixtureProduct } from "./adminV3Mocks";
import "../../src/styles/index.css";

export function DialogFixture() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const field = useRef<HTMLInputElement>(null);
  return <>
    <button onClick={() => setOpen(true)}>Ouvrir dialogue</button>
    <label><input type="checkbox" checked={overlay} onChange={(event) => setOverlay(event.target.checked)} />Fermer par overlay</label>
    <AdminDialog open={open} title="Dialogue témoin" description="Description accessible" initialFocusRef={field}
      onClose={() => setOpen(false)} pending={pending} closeOnOverlay={overlay}
      footer={<button type="button" onClick={() => setOpen(false)}>Fin</button>}>
      <label>Premier champ<input ref={field} /></label>
      <button onClick={() => setPending((value) => !value)}>Opération critique</button>
      <div style={{ height: 1200 }}>Contenu long</div>
    </AdminDialog>
  </>;
}

export function ConfirmFixture() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Ouvrir confirmation</button>
    <AdminConfirmDialog open={open} title="Confirmation témoin" description="Vérifiez les données"
      summary="Récapitulatif témoin" warning="Avertissement témoin" onCancel={() => setOpen(false)}
      onConfirm={async () => { await confirmFixture(); setOpen(false); }}>
      <label>Champ métier<input /></label>
    </AdminConfirmDialog>
  </>;
}

export function NavigationFixture() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="location">{location.pathname}{location.search}</output>
    <button onClick={() => navigate("/admin/avis")}>Simuler lien avis</button>
    <button onClick={() => navigate("/admin/coupons")}>Simuler lien promotions</button>
    <Outlet />
  </>;
}

export function SidebarFixture() {
  return <MemoryRouter initialEntries={["/admin/coupons"]}>
    <Routes><Route element={<NavigationFixture />}><Route path="admin" element={<AdminLayout />}>
      <Route index element={<p>Dashboard fixture</p>} />
      <Route path="factures" element={<Navigate to="/admin/comptabilite?tab=factures" replace />} />
      <Route path="facturation" element={<Navigate to="/admin/comptabilite?tab=facturation" replace />} />
      <Route path="*" element={<p>Page fixture</p>} />
    </Route></Route></Routes>
  </MemoryRouter>;
}

type ResponsiveMode = "analytics" | "achats" | "couts";
export function ResponsiveFixture({ mode }: { mode: ResponsiveMode }) {
  const location = mode === "analytics" ? "/admin/analytics" : `/admin/comptabilite?tab=${mode}`;
  return <MemoryRouter initialEntries={[location]}><Routes><Route path="/admin" element={<AdminLayout />}>
    <Route path="analytics" element={<AdminPage section="Analytics" />} />
    <Route path="comptabilite" element={<AdminPage section="Comptabilité" />} />
  </Route></Routes></MemoryRouter>;
}

const root = createRoot(document.getElementById("root")!);
declare global {
  interface Window {
    adminV3: typeof fixture;
    adminV3Product: typeof fixtureProduct;
    renderAdminV3: (mode: "dialog" | "confirm" | "dashboard" | "products" | "stocks" | "comptabilite" | "parametres" | "sidebar" | ResponsiveMode) => void;
  }
}
window.adminV3 = fixture;
window.adminV3Product = fixtureProduct;
window.renderAdminV3 = (mode) => {
  flushSync(() => root.render(<StrictMode key={mode}>
    {mode === "dialog" ? <DialogFixture /> : mode === "confirm" ? <ConfirmFixture /> : mode === "sidebar" ? <SidebarFixture /> : mode === "analytics" || mode === "achats" || mode === "couts" ? <ResponsiveFixture mode={mode} /> :
      <MemoryRouter><AdminPage section={mode === "dashboard" ? "Dashboard" : mode === "stocks" ? "Stocks" : mode === "comptabilite" ? "Comptabilité" : mode === "parametres" ? "Paramètres" : "Produits"} /></MemoryRouter>}
  </StrictMode>));
};
