import type {
  AlertKind,
  CheckCadence,
  Device,
  GscPropertyType,
  InsightKind,
  InsightStatus,
  RankCheckSource,
  RankCheckStatus,
  SyncRunKind,
  SyncRunStatus
} from "./schemas";

export type ClientRecord = {
  id: string;
  name: string;
  slug: string;
  primaryDomain: string;
  gscProperty: string | null;
  gscPropertyType: GscPropertyType | null;
  brandTerms: string[];
  notes: string;
  clientPath: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

/** Client row plus the cheap roll-ups the list page needs. */
export type ClientSummary = ClientRecord & {
  keywordCount: number;
  activeKeywordCount: number;
  unacknowledgedAlertCount: number;
  lastGscSyncAt: string | null;
  lastSerpCheckAt: string | null;
};

export type KeywordRecord = {
  id: string;
  clientId: string;
  phrase: string;
  country: string;
  device: Device;
  location: string | null;
  targetUrl: string | null;
  tags: string[];
  cadence: CheckCadence;
  isActive: boolean;
  createdAt: string;
};

export type RankCheckRecord = {
  id: string;
  keywordId: string;
  checkedAt: string;
  checkedDate: string;
  source: RankCheckSource;
  status: RankCheckStatus;
  /**
   * Null whenever `status` is not "ok". A null position is never a rank of
   * zero or 100 and must never be charted as one.
   */
  position: number | null;
  rankingUrl: string | null;
  previousPosition: number | null;
  rawPath: string | null;
  errorMessage: string | null;
};

export type SerpResultRecord = {
  id: string;
  rankCheckId: string;
  position: number;
  url: string;
  domain: string;
  title: string | null;
  isClient: boolean;
};

export type SyncRunRecord = {
  id: string;
  clientId: string | null;
  kind: SyncRunKind;
  status: SyncRunStatus;
  startedAt: string;
  completedAt: string | null;
  rowsWritten: number;
  itemsOk: number;
  itemsBlocked: number;
  itemsFailed: number;
  errorMessage: string | null;
};

export type AlertRecord = {
  id: string;
  clientId: string;
  keywordId: string | null;
  kind: AlertKind;
  detectedAt: string;
  delta: number | null;
  payload: Record<string, unknown>;
  acknowledgedAt: string | null;
};

export type InsightRecord = {
  id: string;
  clientId: string;
  kind: InsightKind;
  status: InsightStatus;
  periodStart: string;
  periodEnd: string;
  promptPath: string | null;
  outputPath: string | null;
  /** The short WhatsApp brief, produced from the same stats as outputPath. */
  briefPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

/** Status of the single connected Google account, for the settings page. */
export type GoogleConnectionStatus = {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  /** True when the stored refresh token was rejected and a reconnect is required. */
  needsReconnect: boolean;
};

export type SerpProviderStatus = {
  name: string;
  available: boolean;
  message: string;
};

export type RankAppSettings = {
  google: GoogleConnectionStatus;
  serp: SerpProviderStatus;
  clientsRoot: string;
};

// ---------------------------------------------------------------- dashboard

export type GscSite = {
  siteUrl: string;
  permissionLevel: string;
  propertyType: GscPropertyType;
};

export type DailyPoint = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** True while Google is still revising this day; charted dashed, not solid. */
  provisional: boolean;
};

export type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PeriodTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  /** Null when there were no impressions — never 0, which would read as rank 1. */
  position: number | null;
  days: number;
};

export type CoverageSummary = {
  totalClicks: number;
  attributedClicks: number;
  coverageRatio: number;
};

export type DateBounds = { earliest: string | null; latest: string | null };

export type GscPerformance = {
  window: { startDate: string; endDate: string; days: number };
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  daily: DailyPoint[];
  topQueries: QueryRow[];
  topPages: PageRow[];
  coverage: CoverageSummary;
  bounds: DateBounds;
};

export type GscSyncStatus = {
  running: boolean;
  bounds: DateBounds;
  runs: SyncRunRecord[];
};

// ----------------------------------------------------------- keyword mining

/**
 * A query the client already earns impressions for but does not yet track.
 * Derived entirely from Search Console data — no scraping involved.
 */
export type KeywordSuggestion = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  /** Distinct URLs ranking for this query in the window. 2+ signals cannibalization. */
  pageCount: number;
  /** The URL earning the most clicks, offered as the tracking target. */
  topPage: string;
  /**
   * Modelled additional clicks per window if the query reached position 3,
   * using a published-average CTR-by-position curve. An estimate for ranking
   * candidates against each other, never a forecast.
   */
  opportunityClicks: number;
  reasons: KeywordSuggestionReason[];
};

export type KeywordSuggestionReason = "striking-distance" | "cannibalization" | "high-impression-low-ctr";

export type KeywordSuggestionResponse = {
  window: { startDate: string; endDate: string; days: number };
  suggestions: KeywordSuggestion[];
  /** Counts before the "already tracked" and brand-term filters, for context. */
  totals: { candidates: number; alreadyTracked: number; brandExcluded: number };
};

/** A tracked keyword plus its latest check, for the keyword table. */
export type KeywordWithStatus = KeywordRecord & {
  latestCheck: RankCheckRecord | null;
  /** GSC average position for the same phrase over the last 28 days, if known. */
  gscPosition: number | null;
  gscImpressions: number | null;
};

export type ImportKeywordsResult = {
  created: number;
  duplicates: number;
  invalid: Array<{ line: string; reason: string }>;
};

// -------------------------------------------------------------- rank checks

export type PositionPoint = {
  date: string;
  status: RankCheckStatus;
  /** Non-null only when status is "ok". A gap in the chart, never a zero. */
  position: number | null;
  rankingUrl: string | null;
};

export type KeywordHistory = {
  history: PositionPoint[];
  latestSerp: { checkedAt: string | null; results: SerpResultRecord[] };
};

export type CheckHealth = { ok: number; notFound: number; blocked: number; error: number };

export type ProviderBudget = {
  provider: string;
  used: number;
  monthlyFree: number;
  /** Null when the provider has no free tier and is billed per request. */
  remaining: number | null;
  resetsOn: string;
};

export type SerpStatus = {
  running: boolean;
  provider: string;
  remainingToday: number;
  dailyCap: number;
  budgets: ProviderBudget[];
  health: CheckHealth;
  runs: SyncRunRecord[];
};

export type CompetitorDomain = {
  domain: string;
  appearances: number;
  bestPosition: number;
  avgPosition: number;
  isClient: boolean;
};

export type SerpCheckAck = {
  status: string;
  queued: number;
  remainingToday: number;
  estimatedMinutes: number;
};


// ----------------------------------------------------------------- insights

export type InsightDetail = {
  record: InsightRecord;
  markdown: string | null;
  brief: string | null;
};

export type ClaudeStatus = { available: boolean; message: string };
