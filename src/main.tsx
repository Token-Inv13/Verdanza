import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import { ConsentProvider } from "./context/ConsentContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConsentProvider>
        <AuthProvider>
          <FavoritesProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </FavoritesProvider>
        </AuthProvider>
      </ConsentProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
