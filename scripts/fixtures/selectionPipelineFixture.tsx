import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AdminSelectionPage } from "../../src/pages/admin/AdminSelectionPage";
import { selectionFixtureReads } from "./selectionPipelineMocks";
import "../../src/styles/index.css";
declare global { interface Window { selectionFixtureReads: typeof selectionFixtureReads; reloadSelectionFixture: () => void } }
window.selectionFixtureReads = selectionFixtureReads;
const root = createRoot(document.getElementById("root")!);
let revision = 0;
window.reloadSelectionFixture = () => {
  revision++;
  root.render(<StrictMode key={revision}><MemoryRouter initialEntries={["/admin/selection"]}><AdminSelectionPage /></MemoryRouter></StrictMode>);
};
window.reloadSelectionFixture();
