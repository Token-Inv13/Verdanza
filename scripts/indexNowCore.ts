import { INDEXNOW_ENDPOINT, INDEXNOW_HOST, INDEXNOW_KEY, INDEXNOW_KEY_LOCATION } from "./indexNowConfig";
import { allSeoRoutes, sitemapUrls } from "./seoRoutes";

export type IndexNowMode = "dry-run" | "submit";

export type ParsedIndexNowArgs = {
  urls: string[];
  deletedUrls: string[];
  allIndexable: boolean;
  dryRun: boolean;
  endpoint: string;
  timeoutMs: number;
};

export type NormalizedIndexNowBatch = {
  urls: string[];
  deletedUrls: string[];
};

export type SubmitIndexNowOptions = {
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const maxUrlBatch = 10000;
const defaultTimeoutMs = 15000;
const allowedUrlSet = new Set(sitemapUrls());
const disallowedPathPatterns = [
  /^\/admin(?:\/|$)/,
  /^\/compte(?:\/|$)/,
  /^\/panier$/,
  /^\/checkout(?:\/|$)/,
  /^\/connexion$/,
  /^\/inscription$/,
  /^\/route-introuvable-test$/,
  /^\/produits\/produit-introuvable-test$/,
];
const sensitiveUrlPatterns = [
  /token/i,
  /secret/i,
  /apikey/i,
  /api_key/i,
  /password/i,
  /session/i,
  /firebase/i,
  /adminsdk/i,
];

export function parseIndexNowArgs(argv: string[]): ParsedIndexNowArgs {
  const parsed: ParsedIndexNowArgs = {
    urls: [],
    deletedUrls: [],
    allIndexable: false,
    dryRun: false,
    endpoint: INDEXNOW_ENDPOINT,
    timeoutMs: defaultTimeoutMs,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--url") {
      parsed.urls.push(readValue(argv, ++index, "--url"));
    } else if (arg === "--deleted") {
      parsed.deletedUrls.push(readValue(argv, ++index, "--deleted"));
    } else if (arg === "--all-indexable") {
      parsed.allIndexable = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--endpoint") {
      parsed.endpoint = readValue(argv, ++index, "--endpoint");
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(readValue(argv, ++index, "--timeout-ms"));
      if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 100) {
        throw new Error("--timeout-ms must be a number >= 100.");
      }
    } else {
      throw new Error(`Unknown IndexNow argument: ${arg}`);
    }
  }

  if (!parsed.allIndexable && !parsed.urls.length && !parsed.deletedUrls.length) {
    throw new Error("Provide --url, --deleted or --all-indexable.");
  }

  return parsed;
}

export function buildIndexNowBatch(args: ParsedIndexNowArgs): NormalizedIndexNowBatch {
  const rawExistingUrls = [
    ...(args.allIndexable ? sitemapUrls() : []),
    ...args.urls,
  ];
  const urls = dedupe(rawExistingUrls.map((url) => normalizeIndexNowUrl(url, "indexable")));
  const deletedUrls = dedupe(args.deletedUrls.map((url) => normalizeIndexNowUrl(url, "deleted")));
  const total = urls.length + deletedUrls.length;

  if (!total) throw new Error("No URL to submit after normalization.");
  if (total > maxUrlBatch) throw new Error(`IndexNow batch limit exceeded: ${total} > ${maxUrlBatch}.`);

  return { urls, deletedUrls };
}

export function normalizeIndexNowUrl(input: string, mode: "indexable" | "deleted") {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid absolute URL: ${input}`);
  }

  if (url.protocol !== "https:") throw new Error(`IndexNow URL must use HTTPS: ${input}`);
  if (url.hostname !== INDEXNOW_HOST) throw new Error(`IndexNow URL host must be ${INDEXNOW_HOST}: ${input}`);
  if (url.username || url.password) throw new Error(`IndexNow URL must not contain credentials: ${input}`);

  url.protocol = "https:";
  url.host = INDEXNOW_HOST;
  url.hash = "";
  url.search = "";
  url.pathname = normalizePathname(url.pathname);

  const normalized = url.toString();
  if (containsSensitiveUrlMarker(normalized)) {
    throw new Error(`IndexNow URL appears to contain sensitive data: ${maskUrl(normalized)}`);
  }
  if (isDisallowedIndexNowPath(url.pathname)) {
    throw new Error(`IndexNow URL is private, noindex or fallback: ${normalized}`);
  }
  if (mode === "indexable" && !allowedUrlSet.has(normalized)) {
    throw new Error(`IndexNow URL is not in the current indexable sitemap set: ${normalized}`);
  }

  return normalized;
}

export function buildIndexNowPayload(batch: NormalizedIndexNowBatch) {
  return {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: [...batch.urls, ...batch.deletedUrls],
  };
}

export async function submitIndexNow(
  batch: NormalizedIndexNowBatch,
  options: SubmitIndexNowOptions = {},
) {
  const endpoint = options.endpoint || INDEXNOW_ENDPOINT;
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(buildIndexNowPayload(batch)),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    return interpretIndexNowResponse(response.status, responseText);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`IndexNow request timed out after ${options.timeoutMs ?? defaultTimeoutMs} ms.`);
    }
    throw new Error(`IndexNow network failure: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function interpretIndexNowResponse(status: number, body = "") {
  const detail = body.trim() ? ` Response: ${body.trim().slice(0, 500)}` : "";
  if (status === 200) {
    return {
      ok: true,
      status,
      message: "IndexNow submission received. This is not a guarantee of indexing.",
    };
  }
  if (status === 202) {
    return {
      ok: true,
      status,
      message: "IndexNow submission received and key validation is pending. This is not a guarantee of indexing.",
    };
  }

  const messages: Record<number, string> = {
    400: "Invalid IndexNow request format.",
    403: "IndexNow key is missing, invalid or not reachable.",
    422: "IndexNow URL list or host is not valid.",
    429: "IndexNow rate limit reached. Wait before trying again.",
  };

  return {
    ok: false,
    status,
    message: `${messages[status] || `IndexNow request failed with HTTP ${status}.`}${detail}`,
  };
}

export function formatDryRun(batch: NormalizedIndexNowBatch, endpoint = INDEXNOW_ENDPOINT) {
  return [
    "IndexNow dry-run only. No external request sent.",
    `Endpoint: ${endpoint}`,
    `Host: ${INDEXNOW_HOST}`,
    `Key location: ${INDEXNOW_KEY_LOCATION}`,
    `URL count: ${batch.urls.length + batch.deletedUrls.length}`,
    ...batch.urls.map((url) => `- ${url}`),
    ...batch.deletedUrls.map((url) => `- [deleted] ${url}`),
  ].join("\n");
}

export function currentIndexableUrls() {
  return sitemapUrls();
}

export function currentIndexableRoutePaths() {
  return allSeoRoutes().filter((route) => route.indexable).map((route) => route.path);
}

export function maskIndexNowKey(key = INDEXNOW_KEY) {
  return `${key.slice(0, 8)}...${key.slice(-8)}`;
}

function readValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function normalizePathname(pathname: string) {
  const decoded = decodeURI(pathname);
  const withoutDuplicateSlashes = decoded.replace(/\/{2,}/g, "/");
  if (!withoutDuplicateSlashes || withoutDuplicateSlashes === "/") return "/";
  return withoutDuplicateSlashes.replace(/\/+$/, "");
}

function isDisallowedIndexNowPath(pathname: string) {
  return disallowedPathPatterns.some((pattern) => pattern.test(pathname));
}

function containsSensitiveUrlMarker(url: string) {
  return sensitiveUrlPatterns.some((pattern) => pattern.test(url));
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function maskUrl(url: string) {
  return url.replace(/([?&][^=]+=)[^&]+/g, "$1[redacted]");
}
