import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminSettingsPage from "../../src/pages/admin/AdminSettingsPage";
import { settingsFixture } from "./adminSettingsMocks";
import "../../src/styles/index.css";

declare global { interface Window { adminSettingsFixture: typeof settingsFixture } }
window.adminSettingsFixture = settingsFixture;
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter initialEntries={["/admin/parametres"]}><Routes><Route path="/admin/parametres" element={<AdminSettingsPage />} /></Routes></MemoryRouter></StrictMode>);
