import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useConsent } from "../context/ConsentContext";
import { trackPageView } from "../lib/analytics";

export function AnalyticsRouteTracker() {
  const location = useLocation();
  const { analyticsAllowed } = useConsent();
  const lastTrackedRoute = useRef("");
  const skippedFirstAfterConsent = useRef(false);
  const route = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!analyticsAllowed) {
      skippedFirstAfterConsent.current = false;
      return;
    }
    if (!skippedFirstAfterConsent.current) {
      skippedFirstAfterConsent.current = true;
      lastTrackedRoute.current = route;
      return;
    }
    if (lastTrackedRoute.current === route) return;
    lastTrackedRoute.current = route;
    window.setTimeout(() => trackPageView(route, document.title), 0);
  }, [analyticsAllowed, route]);

  return null;
}
