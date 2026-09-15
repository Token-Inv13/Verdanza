import {
  RECIPE_ALLOWED_PORTS,
  RECIPE_HOST,
  RECIPE_ORIGIN,
  RECIPE_PORTS,
  RECIPE_PROJECT_ID,
} from "./runtimeConstants";

type BrowserRequestShape = {
  queryParameterNames: string[];
  hasSessionId: boolean;
  requestIdKind: "numeric" | "rpc" | "other" | "absent";
  transportType: "xmlhttp" | "other" | "absent";
  protocolVersion: "8" | "other" | "absent";
};

type BrowserResponseSignature = {
  byteLength: number;
  sha256: string;
  contentType: string | null;
  bodyPrefix: string;
  truncated: boolean;
  captureSource: "browser-fetch" | "browser-xhr";
  probeId?: string;
  probeInstanceId?: string;
  databaseId?: string;
  documentPath?: string;
  captureError?: string;
};

type BrowserFirestoreListenResponse = {
  method: string;
  origin: string;
  pathname: string;
  status: number;
  occurredAtEpochMs: number;
  requestShape: BrowserRequestShape;
  responseSignature: BrowserResponseSignature;
};

type BrowserProbeBinding = Pick<
  BrowserResponseSignature,
  "probeId" | "probeInstanceId" | "databaseId" | "documentPath"
>;

type BrowserFirestoreListenProbe = {
  probeId: string;
  probeInstanceId: string;
  databaseId: string;
  documentPath: string;
  generation: string;
  fromCache: boolean;
  hasPendingWrites: boolean;
  receivedAtEpochMs: number;
  terminalErrorCode?: string;
};

declare global {
  interface Window {
    __VERDANZA_RECETTE_NETWORK__?: Array<Record<string, unknown>>;
    __VERDANZA_RECETTE__?: {
      mode: string;
      origin: string;
      readWalletDocument: (uid: string) => Promise<{ exists: boolean }>;
      startFirestoreListenProbe: (documentId: string, probeId: string) => Promise<void>;
      readFirestoreListenProbe: () => BrowserFirestoreListenProbe[];
      readFirestoreListenResponses: () => Promise<BrowserFirestoreListenResponse[]>;
      stopFirestoreListenProbe: () => void;
    };
  }
}

const allowedPorts = new Set<number>(RECIPE_ALLOWED_PORTS);
const FIRESTORE_PROBE_CONFIG_KEY = "verdanza-recette-firestore-probe";
const networkEvidence: Array<Record<string, unknown>> = [];
let stopFirestoreListenProbe: (() => void) | undefined;
let activeFirestoreListenProbe: {
  probeId: string;
  probeInstanceId: string;
  databaseId: string;
  documentPath: string;
} | undefined;
let firestoreProbeInstanceSequence = 0;
let firestoreListenProbeEvents: BrowserFirestoreListenProbe[] = [];
const firestoreListenResponses: BrowserFirestoreListenResponse[] = [];
const pendingFirestoreListenCaptures = new Set<Promise<void>>();
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
    const documentPath = `products/${documentId}`;
    const probeInstanceId = `${probeId}-${Date.now()}-${++firestoreProbeInstanceSequence}`;
    activeFirestoreListenProbe = {
      probeId,
      probeInstanceId,
      databaseId: RECIPE_PROJECT_ID,
      documentPath,
    };
    await new Promise<void>((resolve, reject) => {
      let initialFreshSnapshotObserved = false;
      stopFirestoreListenProbe = onSnapshot(
        doc(db, "products", documentId),
        { includeMetadataChanges: true },
        (snapshot) => {
          const generation = snapshot.data()?.__recetteListenGeneration;
          firestoreListenProbeEvents.push({
            probeId,
            probeInstanceId,
            databaseId: RECIPE_PROJECT_ID,
            documentPath,
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
            probeInstanceId,
            databaseId: RECIPE_PROJECT_ID,
            documentPath,
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
  async readFirestoreListenResponses() {
    while (pendingFirestoreListenCaptures.size > 0) {
      await Promise.allSettled([...pendingFirestoreListenCaptures]);
    }
    return firestoreListenResponses.map((entry) => ({
      ...entry,
      requestShape: {
        ...entry.requestShape,
        queryParameterNames: [...entry.requestShape.queryParameterNames],
      },
      responseSignature: { ...entry.responseSignature },
    }));
  },
  stopFirestoreListenProbe() {
    stopFirestoreListenProbe?.();
    stopFirestoreListenProbe = undefined;
    activeFirestoreListenProbe = undefined;
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
  const url = new URL(String(target), window.location.href);
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  return nativeFetch(input, init).then((response) => {
    queueFetchResponseCapture(url, method, response);
    return response;
  });
}) as typeof window.fetch;

const nativeOpen = XMLHttpRequest.prototype.open;
const nativeSend = XMLHttpRequest.prototype.send;
const xhrRequests = new WeakMap<XMLHttpRequest, { method: string; url: URL }>();
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
  const parsed = new URL(String(url), window.location.href);
  xhrRequests.set(this, { method: method.toUpperCase(), url: parsed });
  return invokeOpen.call(this, method, String(url), async, username, password);
} as typeof XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  const request = xhrRequests.get(this);
  if (request && isFirestoreListenUrl(request.url)) {
    this.addEventListener("loadend", () => {
      if (this.status === 400) queueXhrResponseCapture(request.url, request.method, this);
    }, { once: true });
  }
  return nativeSend.call(this, body);
} as typeof XMLHttpRequest.prototype.send;

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

const preloadedProbeConfig = readPreloadedProbeConfig();
if (preloadedProbeConfig) {
  await window.__VERDANZA_RECETTE__.startFirestoreListenProbe(
    preloadedProbeConfig.documentId,
    preloadedProbeConfig.probeId,
  );
}

await import("../../../src/main.tsx");

function readPreloadedProbeConfig() {
  const raw = window.sessionStorage.getItem(FIRESTORE_PROBE_CONFIG_KEY);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as { documentId?: unknown; probeId?: unknown };
  if (
    typeof parsed.documentId !== "string" ||
    !/^[a-z0-9-]{8,120}$/.test(parsed.documentId) ||
    typeof parsed.probeId !== "string" ||
    !/^[a-z0-9-]{8,160}$/.test(parsed.probeId)
  ) {
    throw new Error("RECETTE LOCALE: configuration de sonde Firestore invalide.");
  }
  return { documentId: parsed.documentId, probeId: parsed.probeId };
}

function isFirestoreListenUrl(url: URL) {
  return url.origin === `http://${RECIPE_HOST}:${RECIPE_PORTS.firestore}` &&
    url.pathname === "/google.firestore.v1.Firestore/Listen/channel";
}

function firestoreRequestShape(url: URL): BrowserRequestShape {
  const requestId = url.searchParams.get("RID");
  const transportType = url.searchParams.get("TYPE");
  const version = url.searchParams.get("VER");
  return {
    queryParameterNames: [...new Set(url.searchParams.keys())].sort(),
    hasSessionId: url.searchParams.has("SID"),
    requestIdKind: requestId === null
      ? "absent"
      : requestId === "rpc"
        ? "rpc"
        : /^\d+$/.test(requestId)
          ? "numeric"
          : "other",
    transportType: transportType === null ? "absent" : transportType === "xmlhttp" ? "xmlhttp" : "other",
    protocolVersion: version === null ? "absent" : version === "8" ? "8" : "other",
  };
}

function queueFetchResponseCapture(url: URL, method: string, response: Response) {
  if (!isFirestoreListenUrl(url) || response.status !== 400) return;
  const occurredAtEpochMs = Date.now();
  const probeBinding = currentProbeBinding();
  let clone: Response;
  try {
    clone = response.clone();
  } catch (error) {
    firestoreListenResponses.push(responseEvidence(
      url,
      method,
      response.status,
      occurredAtEpochMs,
      failedResponseSignature(error, response.headers.get("content-type"), "browser-fetch", probeBinding),
    ));
    return;
  }
  queueResponseCapture(async () => {
    const contentType = response.headers.get("content-type");
    try {
      return responseEvidence(
        url,
        method,
        response.status,
        occurredAtEpochMs,
        await responseSignature(await boundedArrayBuffer(clone), contentType, "browser-fetch", probeBinding),
      );
    } catch (error) {
      return responseEvidence(
        url,
        method,
        response.status,
        occurredAtEpochMs,
        failedResponseSignature(error, contentType, "browser-fetch", probeBinding),
      );
    }
  });
}

function queueXhrResponseCapture(url: URL, method: string, request: XMLHttpRequest) {
  const occurredAtEpochMs = Date.now();
  const contentType = request.getResponseHeader("content-type");
  const probeBinding = currentProbeBinding();
  queueResponseCapture(async () => {
    try {
      let body: ArrayBuffer;
      if (request.responseType === "arraybuffer" && request.response instanceof ArrayBuffer) {
        body = request.response.slice(0);
      } else if (request.responseType === "" || request.responseType === "text") {
        body = new TextEncoder().encode(request.responseText).buffer;
      } else {
        throw new Error(`type de réponse XHR non capturable : ${request.responseType}`);
      }
      return responseEvidence(
        url,
        method,
        request.status,
        occurredAtEpochMs,
        await responseSignature(body, contentType, "browser-xhr", probeBinding),
      );
    } catch (error) {
      return responseEvidence(
        url,
        method,
        request.status,
        occurredAtEpochMs,
        failedResponseSignature(error, contentType, "browser-xhr", probeBinding),
      );
    }
  });
}

function queueResponseCapture(capture: () => Promise<BrowserFirestoreListenResponse>) {
  const task = capture()
    .then((entry) => { firestoreListenResponses.push(entry); })
    .catch((error) => {
      firestoreListenResponses.push({
        method: "UNKNOWN",
        origin: `http://${RECIPE_HOST}:${RECIPE_PORTS.firestore}`,
        pathname: "/google.firestore.v1.Firestore/Listen/channel",
        status: 400,
        occurredAtEpochMs: Date.now(),
        requestShape: {
          queryParameterNames: [],
          hasSessionId: false,
          requestIdKind: "absent",
          transportType: "absent",
          protocolVersion: "absent",
        },
        responseSignature: failedResponseSignature(error, null, "browser-fetch", currentProbeBinding()),
      });
    })
    .finally(() => { pendingFirestoreListenCaptures.delete(task); });
  pendingFirestoreListenCaptures.add(task);
}

function responseEvidence(
  url: URL,
  method: string,
  status: number,
  occurredAtEpochMs: number,
  signature: BrowserResponseSignature,
): BrowserFirestoreListenResponse {
  return {
    method,
    origin: url.origin,
    pathname: url.pathname,
    status,
    occurredAtEpochMs,
    requestShape: firestoreRequestShape(url),
    responseSignature: signature,
  };
}

async function boundedArrayBuffer(response: Response) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    response.arrayBuffer(),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("lecture navigateur au-delà de 2 000 ms")), 2_000);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function responseSignature(
  body: ArrayBuffer,
  contentType: string | null,
  captureSource: BrowserResponseSignature["captureSource"],
  probeBinding: BrowserProbeBinding,
): Promise<BrowserResponseSignature> {
  const bytes = new Uint8Array(body);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  return {
    byteLength: bytes.byteLength,
    sha256: [...digest].map((value) => value.toString(16).padStart(2, "0")).join(""),
    contentType,
    bodyPrefix: sanitizeEvidenceText(new TextDecoder().decode(bytes.slice(0, 256))),
    truncated: bytes.byteLength > 256,
    captureSource,
    ...probeBinding,
  };
}

function failedResponseSignature(
  error: unknown,
  contentType: string | null,
  captureSource: BrowserResponseSignature["captureSource"],
  probeBinding: BrowserProbeBinding,
): BrowserResponseSignature {
  return {
    byteLength: -1,
    sha256: "",
    contentType,
    bodyPrefix: "",
    truncated: false,
    captureSource,
    ...probeBinding,
    captureError: sanitizeEvidenceText(error instanceof Error ? error.message : String(error)),
  };
}

function currentProbeBinding(): BrowserProbeBinding {
  return activeFirestoreListenProbe ? { ...activeFirestoreListenProbe } : {};
}

function sanitizeEvidenceText(value: string) {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, 256);
}
