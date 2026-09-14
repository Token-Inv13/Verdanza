import { RECIPE_ALLOWED_PORTS, RECIPE_HOST, RECIPE_ORIGIN } from "./runtimeConstants";

declare global {
  interface Window {
    __VERDANZA_RECETTE_NETWORK__?: Array<Record<string, unknown>>;
    __VERDANZA_RECETTE__?: {
      mode: string;
      origin: string;
      readWalletDocument: (uid: string) => Promise<{ exists: boolean }>;
      startFirestoreListenProbe: (documentId: string, probeId: string) => Promise<void>;
      readFirestoreListenProbe: () => Array<{
        probeId: string;
        generation: string;
        fromCache: boolean;
        hasPendingWrites: boolean;
        receivedAtEpochMs: number;
        terminalErrorCode?: string;
      }>;
      stopFirestoreListenProbe: () => void;
    };
  }
}

const allowedPorts = new Set<number>(RECIPE_ALLOWED_PORTS);
const networkEvidence: Array<Record<string, unknown>> = [];
let stopFirestoreListenProbe: (() => void) | undefined;
let firestoreListenProbeEvents: Array<{
  probeId: string;
  generation: string;
  fromCache: boolean;
  hasPendingWrites: boolean;
  receivedAtEpochMs: number;
  terminalErrorCode?: string;
}> = [];
window.__VERDANZA_RECETTE_NETWORK__ = networkEvidence;
window.__VERDANZA_RECETTE__ = {
  mode: "local-interactive",
  origin: RECIPE_ORIGIN,
  async readWalletDocument(uid: string) {
    const [{ doc, getDoc }, { db }] = await Promise.all([
      import("firebase/firestore"),
      import("./firebase"),
    ]);
    const snapshot = await getDoc(doc(db, "cagnotteWallets", uid));
    return { exists: snapshot.exists() };
  },
  async startFirestoreListenProbe(documentId: string, probeId: string) {
    stopFirestoreListenProbe?.();
    firestoreListenProbeEvents = [];
    const [{ doc, onSnapshot }, { db }] = await Promise.all([
      import("firebase/firestore"),
      import("./firebase"),
    ]);
    await new Promise<void>((resolve, reject) => {
      let initialFreshSnapshotObserved = false;
      stopFirestoreListenProbe = onSnapshot(
        doc(db, "products", documentId),
        { includeMetadataChanges: true },
        (snapshot) => {
          const generation = snapshot.data()?.__recetteListenGeneration;
          firestoreListenProbeEvents.push({
            probeId,
            generation: typeof generation === "string" ? generation : "",
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
            receivedAtEpochMs: Date.now(),
          });
          if (!snapshot.metadata.fromCache && !initialFreshSnapshotObserved) {
            initialFreshSnapshotObserved = true;
            resolve();
          }
        },
        (error) => {
          firestoreListenProbeEvents.push({
            probeId,
            generation: "",
            fromCache: false,
            hasPendingWrites: false,
            receivedAtEpochMs: Date.now(),
            terminalErrorCode: error.code || "unknown",
          });
          reject(error);
        },
      );
    });
  },
  readFirestoreListenProbe() {
    return firestoreListenProbeEvents.map((entry) => ({ ...entry }));
  },
  stopFirestoreListenProbe() {
    stopFirestoreListenProbe?.();
    stopFirestoreListenProbe = undefined;
  },
};

function assertLocalNetwork(value: string | URL, kind: string) {
  const url = new URL(String(value), window.location.href);
  if (["data:", "blob:"].includes(url.protocol)) return;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const allowed = url.protocol === "http:" && url.hostname === RECIPE_HOST && allowedPorts.has(port);
  if (!allowed) {
    networkEvidence.push({ kind, origin: url.origin, pathname: url.pathname, blocked: true });
    throw new Error(`RECETTE LOCALE: destination réseau bloquée (${url.origin}).`);
  }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const target = input instanceof Request ? input.url : input;
  assertLocalNetwork(target, "fetch");
  return nativeFetch(input, init);
}) as typeof window.fetch;

const nativeOpen = XMLHttpRequest.prototype.open;
const invokeOpen = nativeOpen as unknown as (
  this: XMLHttpRequest,
  method: string,
  url: string,
  async: boolean,
  username?: string | null,
  password?: string | null,
) => void;
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  async: boolean = true,
  username?: string | null,
  password?: string | null,
) {
  assertLocalNetwork(url, "xhr");
  return invokeOpen.call(this, method, String(url), async, username, password);
} as typeof XMLHttpRequest.prototype.open;

const nativeSendBeacon = navigator.sendBeacon?.bind(navigator);
if (nativeSendBeacon) {
  navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
    assertLocalNetwork(url, "beacon");
    return nativeSendBeacon(url, data);
  }) as typeof navigator.sendBeacon;
}

const banner = document.createElement("div");
banner.setAttribute("role", "status");
banner.dataset.verdanzaRecette = "local-interactive";
banner.textContent = "RECETTE LOCALE — DONNÉES FICTIVES";
Object.assign(banner.style, {
  position: "fixed",
  inset: "0 0 auto 0",
  zIndex: "2147483647",
  padding: "8px 12px",
  background: "#7c2d12",
  color: "#fff7ed",
  font: "700 12px/1.3 system-ui, sans-serif",
  letterSpacing: ".08em",
  textAlign: "center",
  boxShadow: "0 1px 6px rgba(0,0,0,.25)",
});
document.body.prepend(banner);

await import("../../../src/main.tsx");
