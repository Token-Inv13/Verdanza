import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AdminLayout } from "../../src/layouts/AdminLayout";
import "../../src/styles/index.css";

export function CurrentRoute() {
  const location = useLocation();
  return <p data-testid="current-route">{location.pathname}{location.search}</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><MemoryRouter initialEntries={["/admin/marketing"]}>
    <Routes><Route path="/admin" element={<AdminLayout />}>
      <Route path="*" element={<CurrentRoute />} />
    </Route></Routes>
  </MemoryRouter></StrictMode>,
);
