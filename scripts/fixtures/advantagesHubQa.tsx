// Isolated local QA entry, never imported by the application or normal build.
// It exercises the existing resolver with fixtures, without modifying real flags.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { AdvantagesHub } from "../../src/components/AdvantagesHub";
import { AdvantagesNavigation } from "../../src/components/AdvantagesNavigation";
import { AccountAuthGate } from "../../src/components/AccountAuthGate";
import { AuthProvider } from "../../src/context/AuthContext";
import { resolveCagnotteDisplayConfiguration } from "../../src/config/cagnotteFeatures";
import "../../src/styles/index.css";

const loyaltyEnabled = resolveCagnotteDisplayConfiguration({
  VITE_CAGNOTTE_READ_DISPLAY_ENABLED: new URLSearchParams(location.search).get("flag"),
}).readDisplayEnabled;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter><AuthProvider><Routes>
    <Route path="/__qa/advantages" element={<>
      <header className="container-page py-4"><nav aria-label="Navigation QA">
        <AdvantagesNavigation loyaltyEnabled={loyaltyEnabled} onNavigate={() => {}} />
      </nav></header>
      <main className="advantages-hub container-page"><h1>Avantages QA</h1>
        <AdvantagesHub loyaltyEnabled={loyaltyEnabled} />
      </main>
    </>} />
    <Route element={<AccountAuthGate />}>
      <Route path="/compte/avantages" element={<h1 data-qa-protected>Protected QA destination</h1>} />
    </Route>
    <Route path="/connexion" element={<main className="container-page"><h1>Connexion QA</h1></main>} />
    <Route path="/avantages" element={<main><h1>Vue d’ensemble QA</h1></main>} />
    <Route path="/concours" element={<main><h1>Concours QA</h1><Link to="/__qa/advantages">Retour QA</Link></main>} />
  </Routes></AuthProvider></BrowserRouter>,
);
