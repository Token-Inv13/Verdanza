// Actual account/layout components with a test-only authenticated context.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MainLayout } from "../../src/layouts/MainLayout";
import { AccountAuthGate } from "../../src/components/AccountAuthGate";
import { AccountLayout } from "../../src/pages/account/AccountLayout";
import { AccountOverviewPage } from "../../src/pages/account/AccountOverviewPage";
import { CartProvider } from "../../src/context/CartContext";
import { ConsentProvider } from "../../src/context/ConsentContext";
import "../../src/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter><ConsentProvider><CartProvider><Routes>
    <Route element={<MainLayout />}><Route element={<AccountAuthGate />}>
      <Route path="/compte" element={<AccountLayout />}><Route index element={<AccountOverviewPage />} /></Route>
    </Route></Route>
  </Routes></CartProvider></ConsentProvider></BrowserRouter>,
);
