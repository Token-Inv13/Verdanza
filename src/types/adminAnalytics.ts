export type AdminAnalyticsPreset = "7d" | "30d" | "90d" | "custom";

export type AdminAnalyticsRange = {
  startDate: string;
  endDate: string;
  label: string;
};

export type AdminAnalyticsQuery = {
  preset: AdminAnalyticsPreset;
  startDate?: string;
  endDate?: string;
  compare?: boolean;
};

export type AdminAnalyticsSummary = {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  engagementRate: number;
  averageEngagementDurationSeconds: number;
  orderSubmittedCount: number;
  sessionToOrderRate: number;
  orderSubmittedValue: number;
  purchaseCount: number;
  purchaseRevenue: number | null;
};

export type AdminAnalyticsNamedRow = {
  name: string;
  users: number;
  sessions: number;
  ordersSubmitted: number;
  conversionRate: number;
};

export type AdminAnalyticsPageRow = {
  path: string;
  title: string;
  views: number;
  users: number;
  engagementRate: number;
  averageEngagementDurationSeconds: number;
};

export type AdminAnalyticsFunnelStep = {
  eventName: string;
  label: string;
  count: number;
  rateFromPrevious: number | null;
  rateFromStart: number | null;
};

export type AdminAnalyticsProductRow = {
  name: string;
  views: number;
  addToCart: number;
  favorites: number | null;
  ordersSubmitted: number | null;
  paidPurchases: number;
};

export type AdminAnalyticsContentRow = {
  path: string;
  title: string;
  views: number;
  articleViews: number;
  progress50: number | null;
  progress90: number | null;
  shopClicks: number | null;
};

export type AdminAnalyticsDeliveryRow = {
  name: string;
  count: number;
};

export type AdminAnalyticsDeviceRow = {
  device: string;
  users: number;
  sessions: number;
  engagementRate: number;
};

export type AdminAnalyticsRealtimeRow = {
  name: string;
  activeUsers: number;
};

export type AdminAnalyticsResponse = {
  configured: boolean;
  propertyId?: string;
  range: AdminAnalyticsRange;
  comparisonRange?: AdminAnalyticsRange;
  fetchedAt: string;
  freshness: {
    standardFetchedAt?: string;
    realtimeFetchedAt?: string;
    standardTtlSeconds: number;
    realtimeTtlSeconds: number;
  };
  summary: AdminAnalyticsSummary;
  comparison?: AdminAnalyticsSummary;
  acquisition: {
    channels: AdminAnalyticsNamedRow[];
    sourceMediums: AdminAnalyticsNamedRow[];
    campaigns: AdminAnalyticsNamedRow[];
  };
  pages: AdminAnalyticsPageRow[];
  funnel: AdminAnalyticsFunnelStep[];
  products: AdminAnalyticsProductRow[];
  content: AdminAnalyticsContentRow[];
  delivery: {
    methods: AdminAnalyticsDeliveryRow[];
    localZones: AdminAnalyticsDeliveryRow[];
    paymentMethods: AdminAnalyticsDeliveryRow[];
  };
  devices: AdminAnalyticsDeviceRow[];
  realtime: {
    activeUsers30Minutes: number;
    pages: AdminAnalyticsRealtimeRow[];
    sources: AdminAnalyticsRealtimeRow[];
  };
  notices: string[];
};
