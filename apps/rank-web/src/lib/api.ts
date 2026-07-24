import type {
  ClientRecord,
  ClientSummary,
  CreateClientInput,
  CreateKeywordInput,
  GoogleConnectionStatus,
  GscPerformance,
  GscSite,
  GscSyncStatus,
  ImportKeywordsInput,
  ImportKeywordsResult,
  KeywordRecord,
  AlertWithContext,
  ClaudeStatus,
  CompetitorDomain,
  InsightDetail,
  InsightRecord,
  KeywordHistory,
  KeywordSuggestionResponse,
  KeywordWithStatus,
  SchedulerState,
  SerpCheckAck,
  SerpStatus,
  RankAppSettings,
  UpdateClientInput
} from "@rankos/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    const error = new Error(payload.error || "Request failed.") as Error & { code?: string };
    error.code = payload.code;
    throw error;
  }

  return response.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<RankAppSettings>("/api/settings"),

  listClients: (includeArchived = false) =>
    request<ClientSummary[]>(`/api/clients${includeArchived ? "?includeArchived=true" : ""}`),
  getClient: (clientId: string) => request<ClientRecord>(`/api/clients/${clientId}`),
  createClient: (payload: CreateClientInput) =>
    request<ClientRecord>("/api/clients", { method: "POST", body: JSON.stringify(payload) }),
  updateClient: (clientId: string, payload: UpdateClientInput) =>
    request<ClientRecord>(`/api/clients/${clientId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  getGoogleStatus: () => request<GoogleConnectionStatus>("/api/google/status"),
  connectGoogle: () => request<{ authUrl: string }>("/api/google/connect", { method: "POST" }),
  disconnectGoogle: () => request<{ ok: boolean }>("/api/google/disconnect", { method: "POST" }),
  listProperties: () => request<GscSite[]>("/api/google/properties"),

  syncGsc: (clientId: string) =>
    request<{ status: string; kind: string }>(`/api/clients/${clientId}/gsc/sync`, { method: "POST" }),
  backfillGsc: (clientId: string) =>
    request<{ status: string; kind: string }>(`/api/clients/${clientId}/gsc/backfill`, { method: "POST" }),
  cancelGsc: (clientId: string) =>
    request<{ cancelled: boolean }>(`/api/clients/${clientId}/gsc/cancel`, { method: "POST" }),
  getSyncStatus: (clientId: string) => request<GscSyncStatus>(`/api/clients/${clientId}/gsc/status`),
  getPerformance: (clientId: string, days: number) =>
    request<GscPerformance>(`/api/clients/${clientId}/gsc/performance?days=${days}`),

  listKeywords: (clientId: string) => request<KeywordWithStatus[]>(`/api/clients/${clientId}/keywords`),
  createKeyword: (clientId: string, payload: CreateKeywordInput) =>
    request<KeywordRecord>(`/api/clients/${clientId}/keywords`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  importKeywords: (clientId: string, payload: ImportKeywordsInput) =>
    request<ImportKeywordsResult>(`/api/clients/${clientId}/keywords/import`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateKeyword: (keywordId: string, payload: Partial<Pick<KeywordRecord, "targetUrl" | "tags" | "cadence" | "isActive">>) =>
    request<KeywordRecord>(`/api/keywords/${keywordId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteKeyword: async (keywordId: string) => {
    const response = await fetch(`/api/keywords/${keywordId}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error("Could not delete that keyword.");
    }
  },
  getSuggestions: (clientId: string, days = 90) =>
    request<KeywordSuggestionResponse>(`/api/clients/${clientId}/keywords/suggestions?days=${days}`),

  runSerpCheck: (clientId: string, body: { keywordIds?: string[]; dueOnly?: boolean } = {}) =>
    request<SerpCheckAck>(`/api/clients/${clientId}/serp/check`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  cancelSerpCheck: (clientId: string) =>
    request<{ cancelled: boolean }>(`/api/clients/${clientId}/serp/cancel`, { method: "POST" }),
  getSerpStatus: (clientId: string) => request<SerpStatus>(`/api/clients/${clientId}/serp/status`),
  getKeywordHistory: (keywordId: string) => request<KeywordHistory>(`/api/keywords/${keywordId}/history`),
  getCompetitors: (clientId: string, days = 30) =>
    request<{ since: string; domains: CompetitorDomain[] }>(
      `/api/clients/${clientId}/serp/competitors?days=${days}`
    ),

  getClaudeStatus: () => request<ClaudeStatus>("/api/insights/status"),
  listInsights: (clientId: string) => request<InsightRecord[]>(`/api/clients/${clientId}/insights`),
  generateInsight: (clientId: string, days = 28) =>
    request<{ status: string; days: number }>(`/api/clients/${clientId}/insights`, {
      method: "POST",
      body: JSON.stringify({ days })
    }),
  getInsight: (insightId: string) => request<InsightDetail>(`/api/insights/${insightId}`),

  listAlerts: (clientId: string, all = false) =>
    request<AlertWithContext[]>(`/api/clients/${clientId}/alerts${all ? "?all=true" : ""}`),
  acknowledgeAlert: (alertId: string) =>
    request<{ ok: boolean }>(`/api/alerts/${alertId}/acknowledge`, { method: "POST" }),
  acknowledgeAllAlerts: (clientId: string) =>
    request<{ acknowledged: number }>(`/api/clients/${clientId}/alerts/acknowledge-all`, { method: "POST" }),

  getScheduler: () => request<SchedulerState>("/api/scheduler"),
  runScheduledTask: (task: string) =>
    request<{ status: string; task: string }>(`/api/scheduler/run/${task}`, { method: "POST" })
};
