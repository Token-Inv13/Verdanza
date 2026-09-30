import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import AdminMarketingPage from "../../src/pages/admin/AdminMarketingPage";
import "../../src/styles/index.css";
export function Fixture() { const [view, setView] = useState<"overview" | "banners" | "contests">("overview"); const [load, setLoad] = useState(0); return <><button onClick={() => setView((current) => current === "overview" ? "banners" : current === "banners" ? "contests" : "overview")}>Changer de vue fixture</button><button onClick={() => setLoad((current) => current + 1)}>Nouveau chargement fixture</button><AdminMarketingPage key={`${view}-${load}`} view={view} /></>; }
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter initialEntries={["/admin/marketing"]}><Fixture /></MemoryRouter></StrictMode>);
