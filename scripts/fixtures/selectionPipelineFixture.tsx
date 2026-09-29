import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AdminSelectionPage } from "../../src/pages/admin/AdminSelectionPage";
import "../../src/styles/index.css";
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter initialEntries={["/admin/selection"]}><AdminSelectionPage /></MemoryRouter></StrictMode>);
