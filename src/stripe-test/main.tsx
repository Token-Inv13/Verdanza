import React from "react";
import ReactDOM from "react-dom/client";
import { StripeTestApp } from "./StripeTestApp";
import "../styles/index.css";
import { BrowserRouter } from "react-router-dom";

// A separate entrypoint avoids initializing production Firebase/Auth, GTM, GA4 or messaging.
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><BrowserRouter><StripeTestApp /></BrowserRouter></React.StrictMode>);
