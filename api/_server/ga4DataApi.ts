import { createPrivateKey, sign } from "node:crypto";
import type {
  AdminAnalyticsContentRow,
  AdminAnalyticsDeliveryRow,
  AdminAnalyticsDeviceRow,
  AdminAnalyticsFunnelStep,
  AdminAnalyticsNamedRow,
  AdminAnalyticsPageRow,
  AdminAnalyticsProductRow,
  AdminAnalyticsQuery,
  AdminAnalyticsRange,
  AdminAnalyticsResponse,
  AdminAnalyticsSummary,
} from "../../src/types/adminAnalytics.js";

const analyticsScope = "https://www.googleapis.com/auth/analytics.readonly";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const standardCacheTtlMs = 12 * 60 * 1000;
const realtimeCacheTtlMs = 60 * 1000;

type FetchLike = typeof fetch;

type Ga4Credentials = {
  clientEmail: string;
  privateKey: string;
};

type Ga4Config = {
  propertyId: string;
  credentials: Ga4Credentials;
};

type ReportMetric = {
  name: string;
  value: number;
};

type ReportRow = {
  dimensions: string[];
  metrics: ReportMetric[];
};

type Ga4ReportResponse = {
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
};

type StandardReportData = Omit<AdminAnalyticsResponse, "realtime" | "freshness" | "fetchedAt">;

type RealtimeReportData = AdminAnalyticsResponse["realtime"];

type CacheEntry<T> = {
  fetchedAt: string;
  expiresAt: number;
  value: T;
};

type Ga4Runtime = {
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  now?: Date;
};

const standardCache = new Map<string, CacheEntry<StandardReportData>>();
const realtimeCache = new Map<string, CacheEntry<RealtimeReportData>>();
let accessTokenCache: { accessToken: string; expiresAt: number; key: string } | null = null;

export async function getAdminAnalyticsReport(
  query: AdminAnalyticsQuery,
  runtime: Ga4Runtime = {},
): Promise<AdminAnalyticsResponse> {
  const env = runtime.env || process.env;
  const now = runtime.now || new Date();
  const fetchImpl = runtime.fetch || fetch;
  const range = resolveRange(query, now);
  const comparisonRange = query.compare ? resolvePreviousRange(range) : undefined;
  const config = readGa4Config(env);
  const fallback = emptyResponse(range, comparisonRange, now);

  if (!config) {
    return {
      ...fallback,
      notices: [
        "Configuration GA4 absente. Renseignez GA4_PROPERTY_ID et les identifiants Google serveur dans Vercel.",
      ],
    };
  }

  const standardKey = JSON.stringify({ propertyId: config.propertyId, range, comparisonRange });
  const realtimeKey = config.propertyId;
  const standard = await cached(
    standardCache,
    standardKey,
    standardCacheTtlMs,
    now,
    () => loadStandardReport(config, range, comparisonRange, fetchImpl),
  );
  const realtime = await cached(
    realtimeCache,
    realtimeKey,
    realtimeCacheTtlMs,
    now,
    () => loadRealtimeReport(config, fetchImpl),
  );

  return {
    ...standard.value,
    realtime: realtime.value,
    fetchedAt: now.toISOString(),
    freshness: {
      standardFetchedAt: standard.fetchedAt,
      realtimeFetchedAt: realtime.fetchedAt,
      standardTtlSeconds: standardCacheTtlMs / 1000,
      realtimeTtlSeconds: realtimeCacheTtlMs / 1000,
    },
  };
}

function readGa4Config(env: NodeJS.ProcessEnv): Ga4Config | null {
  const propertyId = env.GA4_PROPERTY_ID?.trim();
  if (!propertyId) return null;
  if (!/^\d+$/.test(propertyId)) {
    throw new Error("GA4_PROPERTY_ID doit etre l'identifiant numerique de propriete, pas le Measurement ID.");
  }

  const credentials = readGoogleCredentials(env);
  if (!credentials) return null;
  return { propertyId, credentials };
}

function readGoogleCredentials(env: NodeJS.ProcessEnv): Ga4Credentials | null {
  const encoded = env.GOOGLE_SERVICE_ACCOUNT_BASE64 || env.GA4_SERVICE_ACCOUNT_BASE64;
  if (encoded) {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      client_email?: string;
      private_key?: string;
    };
    if (parsed.client_email && parsed.private_key) {
      return {
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      };
    }
  }

  const json = env.GOOGLE_SERVICE_ACCOUNT_JSON || env.GA4_SERVICE_ACCOUNT_JSON;
  if (json) {
    const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
    if (parsed.client_email && parsed.private_key) {
      return {
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      };
    }
  }

  const clientEmail = env.GOOGLE_CLIENT_EMAIL || env.GA4_CLIENT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY || env.GA4_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;
  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

async function loadStandardReport(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  comparisonRange: AdminAnalyticsRange | undefined,
  fetchImpl: FetchLike,
): Promise<StandardReportData> {
  const notices: string[] = [];
  const summary = await loadSummary(config, range, fetchImpl);
  const comparison = comparisonRange
    ? await loadSummary(config, comparisonRange, fetchImpl)
    : undefined;
  const [channels, sourceMediums, campaigns, pages, funnel, products, content, delivery, devices] =
    await Promise.all([
      loadAcquisitionRows(config, range, "sessionDefaultChannelGroup", fetchImpl),
      loadAcquisitionRows(config, range, "sessionSourceMedium", fetchImpl),
      loadAcquisitionRows(config, range, "sessionCampaignName", fetchImpl),
      loadPages(config, range, fetchImpl),
      loadFunnel(config, range, fetchImpl),
      loadProducts(config, range, fetchImpl, notices),
      loadContent(config, range, fetchImpl, notices),
      loadDelivery(config, range, fetchImpl, notices),
      loadDevices(config, range, fetchImpl),
    ]);

  return {
    configured: true,
    propertyId: config.propertyId,
    range,
    comparisonRange,
    summary,
    comparison,
    acquisition: { channels, sourceMediums, campaigns },
    pages,
    funnel,
    products,
    content,
    delivery,
    devices,
    notices,
  };
}

async function loadSummary(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
): Promise<AdminAnalyticsSummary> {
  const traffic = firstMetrics(
    await runReport(
      config,
      {
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
        metrics: [
          { name: "activeUsers" },
          { name: "newUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
          { name: "userEngagementDuration" },
        ],
        dimensionFilter: publicTrafficFilter(),
      },
      fetchImpl,
    ),
  );
  const events = await eventCounts(config, range, fetchImpl, [
    "order_submitted",
    "purchase",
  ]);
  const values = firstMetrics(
    await runReport(
      config,
      {
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "eventValue" }, { name: "totalRevenue" }],
        dimensionFilter: andFilter([
          publicTrafficFilter(),
          inListFilter("eventName", ["order_submitted", "purchase"]),
        ]),
      },
      fetchImpl,
    ),
  );
  const sessions = metricValue(traffic, "sessions");
  const orderSubmittedCount = events.get("order_submitted") || 0;
  const purchaseCount = events.get("purchase") || 0;

  return {
    activeUsers: metricValue(traffic, "activeUsers"),
    newUsers: metricValue(traffic, "newUsers"),
    sessions,
    pageViews: metricValue(traffic, "screenPageViews"),
    engagementRate: ratio(metricValue(traffic, "engagementRate"), 1),
    averageEngagementDurationSeconds: sessions
      ? metricValue(traffic, "userEngagementDuration") / sessions
      : 0,
    orderSubmittedCount,
    sessionToOrderRate: ratio(orderSubmittedCount, sessions),
    orderSubmittedValue: metricValue(values, "eventValue"),
    purchaseCount,
    purchaseRevenue: purchaseCount ? metricValue(values, "totalRevenue") : null,
  };
}

async function loadAcquisitionRows(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  dimension: string,
  fetchImpl: FetchLike,
): Promise<AdminAnalyticsNamedRow[]> {
  const trafficRows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      dimensionFilter: publicTrafficFilter(),
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 12,
    },
    fetchImpl,
  );
  const orderRows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: andFilter([
        publicTrafficFilter(),
        eventFilter("eventName", "order_submitted", false),
      ]),
      limit: 100,
    },
    fetchImpl,
  );
  const ordersByName = new Map(
    orderRows.map((row) => [cleanDimension(row.dimensions[0]), metricValue(row.metrics, "eventCount")] as const),
  );
  return trafficRows.map((row) => {
    const name = cleanDimension(row.dimensions[0]);
    const sessions = metricValue(row.metrics, "sessions");
    const ordersSubmitted = ordersByName.get(name) || 0;
    return {
      name,
      users: metricValue(row.metrics, "activeUsers"),
      sessions,
      ordersSubmitted,
      conversionRate: ratio(ordersSubmitted, sessions),
    };
  });
}

async function loadPages(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
): Promise<AdminAnalyticsPageRow[]> {
  const rows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
        { name: "engagementRate" },
        { name: "userEngagementDuration" },
      ],
      dimensionFilter: publicTrafficFilter(),
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 20,
    },
    fetchImpl,
  );
  return rows.map((row) => {
    const users = metricValue(row.metrics, "activeUsers");
    return {
      path: cleanDimension(row.dimensions[0]),
      title: cleanDimension(row.dimensions[1]),
      views: metricValue(row.metrics, "screenPageViews"),
      users,
      engagementRate: ratio(metricValue(row.metrics, "engagementRate"), 1),
      averageEngagementDurationSeconds: users
        ? metricValue(row.metrics, "userEngagementDuration") / users
        : 0,
    };
  });
}

async function loadFunnel(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
): Promise<AdminAnalyticsFunnelStep[]> {
  const steps = [
    ["view_item_list", "Liste produits"],
    ["view_item", "Fiche produit"],
    ["add_to_cart", "Ajout panier"],
    ["view_cart", "Panier"],
    ["begin_checkout", "Debut checkout"],
    ["add_shipping_info", "Livraison"],
    ["add_payment_info", "Reglement"],
    ["order_submitted", "Commande soumise"],
    ["purchase", "Achat paye"],
  ] as const;
  const counts = await eventCounts(config, range, fetchImpl, steps.map(([eventName]) => eventName));
  const start = counts.get(steps[0][0]) || 0;
  let previous = 0;
  return steps.map(([eventName, label], index) => {
    const count = counts.get(eventName) || 0;
    const step: AdminAnalyticsFunnelStep = {
      eventName,
      label,
      count,
      rateFromPrevious: index === 0 ? null : ratio(count, previous),
      rateFromStart: index === 0 ? null : ratio(count, start),
    };
    previous = count;
    return step;
  });
}

async function loadProducts(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
  notices: string[],
): Promise<AdminAnalyticsProductRow[]> {
  const ecommerceRows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "itemName" }],
      metrics: [{ name: "itemsViewed" }, { name: "itemsAddedToCart" }, { name: "itemsPurchased" }],
      dimensionFilter: publicTrafficFilter(),
      orderBys: [{ metric: { metricName: "itemsViewed" }, desc: true }],
      limit: 100,
    },
    fetchImpl,
  );
  const favoriteRows = await loadOptionalProductEventRows(
    config,
    range,
    fetchImpl,
    "add_to_wishlist",
    notices,
    "Favoris produits indisponibles : la propriete GA4 ne permet pas de croiser cet evenement avec les produits.",
  );
  const submittedRows = await loadOptionalProductEventRows(
    config,
    range,
    fetchImpl,
    "order_submitted",
    notices,
    "Commandes soumises par produit indisponibles : la propriete GA4 ne permet pas de croiser cet evenement avec les produits.",
  );

  const byProduct = new Map<string, AdminAnalyticsProductRow>();
  for (const row of ecommerceRows) {
    const name = cleanDimension(row.dimensions[0]);
    if (!isUsableProductName(name)) continue;
    const current = productAnalyticsRow(name);
    current.views = metricValue(row.metrics, "itemsViewed");
    current.addToCart = metricValue(row.metrics, "itemsAddedToCart");
    current.paidPurchases = metricValue(row.metrics, "itemsPurchased");
    byProduct.set(name, current);
  }
  mergeProductEventCounts(byProduct, favoriteRows, "favorites");
  mergeProductEventCounts(byProduct, submittedRows, "ordersSubmitted");
  return [...byProduct.values()]
    .map((row) => ({
      ...row,
      viewToCartRate: ratioOrNull(row.addToCart, row.views),
      cartToOrderRate: ratioOrNull(row.ordersSubmitted, row.addToCart),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);
}

async function loadOptionalProductEventRows(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
  eventName: string,
  notices: string[],
  notice: string,
) {
  return runOptionalReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "itemName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: andFilter([publicTrafficFilter(), exactFilter("eventName", eventName)]),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 100,
    },
    fetchImpl,
    notices,
    notice,
  );
}

function mergeProductEventCounts(
  rows: Map<string, AdminAnalyticsProductRow>,
  eventRows: ReportRow[],
  field: "favorites" | "ordersSubmitted",
) {
  for (const row of eventRows) {
    const name = cleanDimension(row.dimensions[0]);
    if (!isUsableProductName(name)) continue;
    const current = rows.get(name) || productAnalyticsRow(name);
    current[field] += metricValue(row.metrics, "eventCount");
    rows.set(name, current);
  }
}

function productAnalyticsRow(name: string): AdminAnalyticsProductRow {
  return {
    name,
    views: 0,
    addToCart: 0,
    favorites: 0,
    ordersSubmitted: 0,
    paidPurchases: 0,
    viewToCartRate: null,
    cartToOrderRate: null,
  };
}

function isUsableProductName(name: string) {
  return Boolean(name && name !== "Non renseigne");
}

async function loadContent(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
  notices: string[],
): Promise<AdminAnalyticsContentRow[]> {
  const pageRows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }],
      dimensionFilter: andFilter([publicTrafficFilter(), beginsWithFilter("pagePath", "/blog")]),
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    },
    fetchImpl,
  );
  const eventRows = await runOptionalReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "pagePath" }, { name: "eventName" }, { name: "customEvent:progress_percent" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: andFilter([
        publicTrafficFilter(),
        inListFilter("eventName", ["blog_article_view", "blog_read_progress", "blog_shop_click"]),
      ]),
      limit: 100,
    },
    fetchImpl,
    notices,
    "Les dimensions personnalisees de progression blog ne sont pas encore disponibles dans GA4.",
  );
  const eventsByPath = new Map<string, { articleViews: number; progress50: number; progress90: number; shopClicks: number }>();
  for (const row of eventRows) {
    const path = cleanDimension(row.dimensions[0]);
    const eventName = row.dimensions[1];
    const progress = row.dimensions[2];
    const current = eventsByPath.get(path) || { articleViews: 0, progress50: 0, progress90: 0, shopClicks: 0 };
    const count = metricValue(row.metrics, "eventCount");
    if (eventName === "blog_article_view") current.articleViews += count;
    if (eventName === "blog_read_progress" && progress === "50") current.progress50 += count;
    if (eventName === "blog_read_progress" && progress === "90") current.progress90 += count;
    if (eventName === "blog_shop_click") current.shopClicks += count;
    eventsByPath.set(path, current);
  }
  return pageRows.map((row) => {
    const path = cleanDimension(row.dimensions[0]);
    const events = eventsByPath.get(path);
    return {
      path,
      title: cleanDimension(row.dimensions[1]),
      views: metricValue(row.metrics, "screenPageViews"),
      articleViews: events?.articleViews || 0,
      progress50: eventRows.length ? events?.progress50 || 0 : null,
      progress90: eventRows.length ? events?.progress90 || 0 : null,
      shopClicks: eventRows.length ? events?.shopClicks || 0 : null,
    };
  });
}

async function loadDelivery(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
  notices: string[],
): Promise<AdminAnalyticsResponse["delivery"]> {
  const [methods, localZones, paymentMethods] = await Promise.all([
    loadCustomDimensionRows(config, range, "customEvent:delivery_method", fetchImpl, notices, "Methode de livraison"),
    loadCustomDimensionRows(config, range, "customEvent:delivery_zone", fetchImpl, notices, "Zone locale"),
    loadCustomDimensionRows(config, range, "customEvent:preferred_payment_method", fetchImpl, notices, "Mode de reglement"),
  ]);
  return { methods, localZones, paymentMethods };
}

async function loadCustomDimensionRows(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  dimension: string,
  fetchImpl: FetchLike,
  notices: string[],
  label: string,
): Promise<AdminAnalyticsDeliveryRow[]> {
  const rows = await runOptionalReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: publicTrafficFilter(),
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 12,
    },
    fetchImpl,
    notices,
    `${label} indisponible : la dimension personnalisee GA4 n'est pas publiee ou n'a pas encore de donnees.`,
  );
  return rows.map((row) => ({
    name: cleanDimension(row.dimensions[0]),
    count: metricValue(row.metrics, "eventCount"),
  }));
}

async function loadDevices(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
): Promise<AdminAnalyticsDeviceRow[]> {
  const rows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "engagementRate" }],
      dimensionFilter: publicTrafficFilter(),
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    },
    fetchImpl,
  );
  return rows.map((row) => ({
    device: cleanDimension(row.dimensions[0]),
    users: metricValue(row.metrics, "activeUsers"),
    sessions: metricValue(row.metrics, "sessions"),
    engagementRate: ratio(metricValue(row.metrics, "engagementRate"), 1),
  }));
}

async function loadRealtimeReport(
  config: Ga4Config,
  fetchImpl: FetchLike,
): Promise<RealtimeReportData> {
  const [overview, pages, sources] = await Promise.all([
    runOptionalRealtimeReport(
      config,
      {
        metrics: [{ name: "activeUsers" }],
        dimensionFilter: publicRealtimeFilter(),
      },
      fetchImpl,
    ),
    runOptionalRealtimeReport(
      config,
      {
        dimensions: [{ name: "unifiedScreenName" }],
        metrics: [{ name: "activeUsers" }],
        dimensionFilter: publicRealtimeFilter(),
        limit: 10,
      },
      fetchImpl,
    ),
    runOptionalRealtimeReport(
      config,
      {
        dimensions: [{ name: "source" }],
        metrics: [{ name: "activeUsers" }],
        dimensionFilter: publicRealtimeFilter(),
        limit: 10,
      },
      fetchImpl,
    ),
  ]);
  return {
    activeUsers30Minutes: metricValue(firstMetrics(overview), "activeUsers"),
    pages: pages.map((row) => ({
      name: cleanDimension(row.dimensions[0]),
      activeUsers: metricValue(row.metrics, "activeUsers"),
    })),
    sources: sources.map((row) => ({
      name: cleanDimension(row.dimensions[0]),
      activeUsers: metricValue(row.metrics, "activeUsers"),
    })),
  };
}

async function eventCounts(
  config: Ga4Config,
  range: AdminAnalyticsRange,
  fetchImpl: FetchLike,
  eventNames: string[],
) {
  const rows = await runReport(
    config,
    {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: andFilter([
        publicTrafficFilter(),
        inListFilter("eventName", eventNames),
      ]),
      limit: eventNames.length,
    },
    fetchImpl,
  );
  return new Map(
    rows.map((row) => [row.dimensions[0], metricValue(row.metrics, "eventCount")] as const),
  );
}

async function runReport(
  config: Ga4Config,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<ReportRow[]> {
  return normalizeRows(
    await callGa4Api(config, "runReport", { ...body, ...withMetricHeaders(body) }, fetchImpl),
    body,
  );
}

async function runRealtimeReport(
  config: Ga4Config,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<ReportRow[]> {
  return normalizeRows(
    await callGa4Api(config, "runRealtimeReport", { ...body, ...withMetricHeaders(body) }, fetchImpl),
    body,
  );
}

async function runOptionalReport(
  config: Ga4Config,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
  notices: string[],
  notice: string,
): Promise<ReportRow[]> {
  try {
    return await runReport(config, body, fetchImpl);
  } catch (error) {
    void error;
    notices.push(notice);
    return [];
  }
}

async function runOptionalRealtimeReport(
  config: Ga4Config,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<ReportRow[]> {
  try {
    return await runRealtimeReport(config, body, fetchImpl);
  } catch (error) {
    void error;
    return [];
  }
}

async function callGa4Api(
  config: Ga4Config,
  action: "runReport" | "runRealtimeReport",
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<Ga4ReportResponse> {
  const accessToken = await getAccessToken(config.credentials, fetchImpl);
  const response = await fetchImpl(
    `https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:${action}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
  } & Ga4ReportResponse;
  if (!response.ok) {
    const message = payload.error?.message || `GA4 Data API ${action} impossible.`;
    if (response.status === 403) {
      throw new Error(`Acces GA4 refuse. Verifiez que l'identite de service a le role Viewer sur la propriete GA4. ${message}`);
    }
    throw new Error(message);
  }
  return payload;
}

async function getAccessToken(credentials: Ga4Credentials, fetchImpl: FetchLike) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cacheKey = credentials.clientEmail;
  if (accessTokenCache && accessTokenCache.key === cacheKey && accessTokenCache.expiresAt > nowSeconds + 60) {
    return accessTokenCache.accessToken;
  }

  const assertion = createJwt(credentials, nowSeconds);
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || "Authentification Google Analytics impossible.");
  }
  accessTokenCache = {
    key: cacheKey,
    accessToken: payload.access_token,
    expiresAt: nowSeconds + Number(payload.expires_in || 3600),
  };
  return payload.access_token;
}

function createJwt(credentials: Ga4Credentials, nowSeconds: number) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: analyticsScope,
      aud: tokenEndpoint,
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    }),
  );
  const payload = `${header}.${claim}`;
  const signature = sign("RSA-SHA256", Buffer.from(payload), createPrivateKey(credentials.privateKey));
  return `${payload}.${base64Url(signature)}`;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeRows(response: Ga4ReportResponse, body: Record<string, unknown>): ReportRow[] {
  const metricNames = ((body.metrics as { name: string }[] | undefined) || []).map((metric) => metric.name);
  return (response.rows || []).map((row) => ({
    dimensions: (row.dimensionValues || []).map((value) => value.value || ""),
    metrics: (row.metricValues || []).map((value, index) => ({
      name: metricNames[index] || `metric_${index}`,
      value: Number(value.value || 0),
    })),
  }));
}

function firstMetrics(rows: ReportRow[]) {
  return rows[0]?.metrics || [];
}

function metricValue(metrics: ReportMetric[], name: string) {
  return Number(metrics.find((metric) => metric.name === name)?.value || 0);
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function ratioOrNull(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function cleanDimension(value: string) {
  return value && value !== "(not set)" ? value : "Non renseigne";
}

function publicTrafficFilter() {
  return andFilter([
    notFilter(beginsWithFilter("pagePath", "/admin")),
    notFilter(regexpFilter("hostName", ".*vercel\\.app$")),
  ]);
}

function publicRealtimeFilter() {
  return notFilter(beginsWithFilter("unifiedScreenName", "/admin"));
}

function eventFilter(fieldName: string, value: string, exclude: boolean) {
  const filter = exactFilter(fieldName, value);
  return exclude ? notFilter(filter) : filter;
}

function andFilter(expressions: unknown[]) {
  return { andGroup: { expressions } };
}

function notFilter(expression: unknown) {
  return { notExpression: expression };
}

function exactFilter(fieldName: string, value: string) {
  return {
    filter: {
      fieldName,
      stringFilter: { matchType: "EXACT", value },
    },
  };
}

function beginsWithFilter(fieldName: string, value: string) {
  return {
    filter: {
      fieldName,
      stringFilter: { matchType: "BEGINS_WITH", value },
    },
  };
}

function regexpFilter(fieldName: string, value: string) {
  return {
    filter: {
      fieldName,
      stringFilter: { matchType: "FULL_REGEXP", value },
    },
  };
}

function inListFilter(fieldName: string, values: string[]) {
  return {
    filter: {
      fieldName,
      inListFilter: { values },
    },
  };
}

function withMetricHeaders(body: Record<string, unknown>) {
  return body;
}

async function cached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  now: Date,
  loader: () => Promise<T>,
) {
  const timestamp = now.getTime();
  const cachedEntry = cache.get(key);
  if (cachedEntry && cachedEntry.expiresAt > timestamp) return cachedEntry;
  const entry = {
    fetchedAt: now.toISOString(),
    expiresAt: timestamp + ttlMs,
    value: await loader(),
  };
  cache.set(key, entry);
  return entry;
}

function resolveRange(query: AdminAnalyticsQuery, now: Date): AdminAnalyticsRange {
  if (query.preset === "custom" && query.startDate && query.endDate) {
    return {
      startDate: query.startDate,
      endDate: query.endDate,
      label: `${formatDateLabel(query.startDate)} - ${formatDateLabel(query.endDate)}`,
    };
  }
  const days = query.preset === "7d" ? 7 : query.preset === "90d" ? 90 : 30;
  const end = toDateOnly(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  return {
    startDate: toDateOnly(start),
    endDate: end,
    label: `${days} derniers jours`,
  };
}

function resolvePreviousRange(range: AdminAnalyticsRange): AdminAnalyticsRange {
  const start = new Date(`${range.startDate}T00:00:00`);
  const end = new Date(`${range.endDate}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return {
    startDate: toDateOnly(previousStart),
    endDate: toDateOnly(previousEnd),
    label: "Periode precedente",
  };
}

function toDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: string) {
  return date.split("-").reverse().join("/");
}

function emptyResponse(
  range: AdminAnalyticsRange,
  comparisonRange: AdminAnalyticsRange | undefined,
  now: Date,
): AdminAnalyticsResponse {
  return {
    configured: false,
    range,
    comparisonRange,
    fetchedAt: now.toISOString(),
    freshness: {
      standardTtlSeconds: standardCacheTtlMs / 1000,
      realtimeTtlSeconds: realtimeCacheTtlMs / 1000,
    },
    summary: emptySummary(),
    comparison: comparisonRange ? emptySummary() : undefined,
    acquisition: { channels: [], sourceMediums: [], campaigns: [] },
    pages: [],
    funnel: [],
    products: [],
    content: [],
    delivery: { methods: [], localZones: [], paymentMethods: [] },
    devices: [],
    realtime: { activeUsers30Minutes: 0, pages: [], sources: [] },
    notices: [],
  };
}

function emptySummary(): AdminAnalyticsSummary {
  return {
    activeUsers: 0,
    newUsers: 0,
    sessions: 0,
    pageViews: 0,
    engagementRate: 0,
    averageEngagementDurationSeconds: 0,
    orderSubmittedCount: 0,
    sessionToOrderRate: 0,
    orderSubmittedValue: 0,
    purchaseCount: 0,
    purchaseRevenue: null,
  };
}

export const adminAnalyticsCachePolicy = {
  standardTtlMs: standardCacheTtlMs,
  realtimeTtlMs: realtimeCacheTtlMs,
};
