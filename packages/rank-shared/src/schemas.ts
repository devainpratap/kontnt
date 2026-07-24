import { z } from "zod";

import {
  alertKinds,
  checkCadences,
  devices,
  gscPropertyTypes,
  insightKinds,
  insightStatuses,
  rankCheckSources,
  rankCheckStatuses,
  serpFeatures,
  syncRunKinds,
  syncRunStatuses
} from "./constants";

export const gscPropertyTypeSchema = z.enum(gscPropertyTypes);
export const deviceSchema = z.enum(devices);
export const rankCheckStatusSchema = z.enum(rankCheckStatuses);
export const rankCheckSourceSchema = z.enum(rankCheckSources);
export const serpFeatureSchema = z.enum(serpFeatures);
export const syncRunKindSchema = z.enum(syncRunKinds);
export const syncRunStatusSchema = z.enum(syncRunStatuses);
export const alertKindSchema = z.enum(alertKinds);
export const insightKindSchema = z.enum(insightKinds);
export const insightStatusSchema = z.enum(insightStatuses);
export const checkCadenceSchema = z.enum(checkCadences);

export type GscPropertyType = z.infer<typeof gscPropertyTypeSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type RankCheckStatus = z.infer<typeof rankCheckStatusSchema>;
export type RankCheckSource = z.infer<typeof rankCheckSourceSchema>;
export type SerpFeature = z.infer<typeof serpFeatureSchema>;
export type SyncRunKind = z.infer<typeof syncRunKindSchema>;
export type SyncRunStatus = z.infer<typeof syncRunStatusSchema>;
export type AlertKind = z.infer<typeof alertKindSchema>;
export type InsightKind = z.infer<typeof insightKindSchema>;
export type InsightStatus = z.infer<typeof insightStatusSchema>;
export type CheckCadence = z.infer<typeof checkCadenceSchema>;

/** `YYYY-MM-DD` in GSC's timezone. Enforced as a string, never a Date. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");

/**
 * A bare registrable domain. Rejects schemes, paths, ports and whitespace so a
 * pasted URL cannot silently become a domain that never matches a SERP result.
 */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter a domain.")
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Enter a bare domain like example.com, without https:// or a path."
  );

/**
 * A Search Console property string exactly as the API returns it: either
 * `sc-domain:example.com` or a URL prefix ending in a slash.
 */
export const gscPropertySchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("sc-domain:") || /^https?:\/\/.+\/$/.test(value),
    "Expected sc-domain:example.com or a URL prefix ending in /."
  );

export const httpUrlSchema = z
  .string()
  .trim()
  .url("Enter a valid URL.")
  .refine((value) => /^https?:\/\//i.test(value), "Only http and https URLs are supported.");

export const createClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required.").max(120),
  primaryDomain: domainSchema,
  gscProperty: gscPropertySchema.optional().nullable(),
  /**
   * Branded queries, excluded from opportunity analysis so the reports surface
   * non-brand growth rather than restating that the client ranks for its own name.
   */
  brandTerms: z.array(z.string().trim().min(1)).max(50).default([]),
  notes: z.string().trim().max(2000).default("")
});

export const updateClientSchema = createClientSchema.partial().extend({
  archived: z.boolean().optional()
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const createKeywordSchema = z.object({
  phrase: z.string().trim().min(1, "Keyword is required.").max(200),
  country: z.string().trim().length(2, "Use a 2-letter country code.").toLowerCase().default("in"),
  device: deviceSchema.default("desktop"),
  location: z.string().trim().max(120).optional().nullable(),
  targetUrl: httpUrlSchema.optional().nullable(),
  tags: z.array(z.string().trim().min(1)).max(20).default([]),
  cadence: checkCadenceSchema.default("weekly")
});

export type CreateKeywordInput = z.infer<typeof createKeywordSchema>;

/** Bulk paste/CSV import. One keyword per line, optional comma-separated target URL. */
export const importKeywordsSchema = z.object({
  raw: z.string().min(1, "Paste at least one keyword."),
  country: z.string().trim().length(2).toLowerCase().default("in"),
  device: deviceSchema.default("desktop"),
  location: z.string().trim().max(120).optional().nullable(),
  tags: z.array(z.string().trim().min(1)).max(20).default([]),
  cadence: checkCadenceSchema.default("weekly")
});

export type ImportKeywordsInput = z.infer<typeof importKeywordsSchema>;
