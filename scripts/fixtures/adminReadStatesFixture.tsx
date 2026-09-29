import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminContestsPage from "../../src/pages/admin/AdminContestsPage";
import AdminBlogCommentsPage from "../../src/pages/admin/AdminBlogCommentsPage";
import { adminReadStates } from "./adminReadStatesMocks";
import "../../src/styles/index.css";

declare global { interface Window { adminReadStates: typeof adminReadStates; renderAdminReadState: (mode: "contests" | "comments") => void } }
window.adminReadStates = adminReadStates;
const root = createRoot(document.getElementById("root")!);
window.renderAdminReadState = (mode) => root.render(<StrictMode key={mode}>{mode === "contests" ? <AdminContestsPage onPrepare={() => {}} /> : <AdminBlogCommentsPage />}</StrictMode>);
window.renderAdminReadState("contests");
