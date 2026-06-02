// lib/api.ts
//
// v11 changes:
//  - Added EmailLookupResult interface
//  - Added fetchPhysicianEmail() — calls POST /api/apollo/find-email
//    Runs the Apollo search → enrich pipeline to retrieve a physician's
//    work email. Never throws; degrades gracefully on any failure.
//  - All other helpers unchanged from v10.

import type { TrialFetchParams, TrialFetchResponse, SiteData, Trial } from "@/types/trial";
import type { AIInsightsData } from "@/types/physician";
import type {
  PhysicianSearchParams,
  SuggestedPhysicianParams,
  PhysicianFetchResponse,
  SuggestedPhysicianFetchResponse,
  PublicationFetchResponse,
  PhysicianInsight,
  LeadPayload,
  Physician,
  SelectedSite,
} from "@/types/physician";

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");

// ── Apollo email lookup type ──────────────────────────────────────────────────

export interface EmailLookupResult {
  found:       boolean;
  email:       string | null;
  apollo_name: string | null;
  error:       string | null;
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  path:     string,
  options?: RequestInit,
  signal?:  AbortSignal,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }

  return res.json() as Promise<T>;
}

// ── Trials ────────────────────────────────────────────────────────────────────

export async function fetchTrials(
  params: TrialFetchParams,
  signal?: AbortSignal,
): Promise<TrialFetchResponse> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  return apiFetch<TrialFetchResponse>(`/api/trials/?${qs}`, undefined, signal);
}

export async function fetchTrialSites(nctId: string, signal?: AbortSignal): Promise<SiteData> {
  return apiFetch<SiteData>(`/api/trials/${nctId}/sites`, undefined, signal);
}

// ── Physicians ────────────────────────────────────────────────────────────────

/**
 * Build a URLSearchParams string from PhysicianSearchParams.
 * Specialty fields are split on commas and appended as repeated params.
 */
function buildPhysicianParams(params: PhysicianSearchParams): string {
  const qs = new URLSearchParams();

  qs.append("lat",    String(params.lat));
  qs.append("lng",    String(params.lng));
  qs.append("radius", String(params.radius));

  const specialtyFields = [
    ["specialty",         params.specialty],
    ["initial_specialty", params.initial_specialty],
    ["user_specialty",    params.user_specialty],
  ] as const;

  for (const [key, value] of specialtyFields) {
    if (!value?.trim()) continue;
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => qs.append(key, s));
  }

  return qs.toString();
}

export async function fetchPhysicians(
  params:  PhysicianSearchParams,
  signal?: AbortSignal,
): Promise<PhysicianFetchResponse> {
  return apiFetch<PhysicianFetchResponse>(
    `/api/physicians/search?${buildPhysicianParams(params)}`,
    undefined,
    signal,
  );
}

/**
 * Fetch suggested physicians related to the trial condition.
 * These are supporting/broader specialists (e.g. pediatricians for childhood
 * cancer) — NOT the same as the main search list.
 *
 * Pass exclude_npis (NPIs already in the main list) so the backend
 * de-duplicates automatically.
 */
export async function fetchSuggestedPhysicians(
  params:  SuggestedPhysicianParams,
  signal?: AbortSignal,
): Promise<SuggestedPhysicianFetchResponse> {
  const qs = new URLSearchParams();
  qs.append("lat",    String(params.lat));
  qs.append("lng",    String(params.lng));
  qs.append("radius", String(params.radius));

  if (params.condition?.trim()) {
    qs.append("condition", params.condition.trim());
  }

  // Send each excluded NPI as a repeated param
  (params.exclude_npis ?? []).forEach((npi) => qs.append("exclude_npis", npi));

  return apiFetch<SuggestedPhysicianFetchResponse>(
    `/api/physicians/suggested?${qs.toString()}`,
    undefined,
    signal,
  );
}

/**
 * Fetch recent PubMed publications for a physician.
 *
 * The NPI is used as the URL path segment (cache-friendly, unique).
 * The actual PubMed search uses name + optional specialty since PubMed
 * indexes by author name, not by NPI.
 *
 * Never throws — returns an empty publications array on any error so
 * the PhysicianDetailPanel degrades gracefully.
 */
export async function fetchPhysicianPublications(
  npi:      string,
  name:     string,
  specialty?: string | null,
  signal?:  AbortSignal,
): Promise<PublicationFetchResponse> {
  const empty: PublicationFetchResponse = { npi, name, count: 0, publications: [] };

  if (!npi?.trim() || !name?.trim()) return empty;

  try {
    const qs = new URLSearchParams({ name: name.trim() });
    if (specialty?.trim()) qs.append("specialty", specialty.trim());

    return await apiFetch<PublicationFetchResponse>(
      `/api/physicians/${encodeURIComponent(npi)}/publications?${qs.toString()}`,
      undefined,
      signal,
    );
  } catch (err) {
    console.warn(`[fetchPhysicianPublications] Failed for NPI ${npi}:`, err);
    return empty;
  }
}

/**
 * Fetch the NUCC specialty list for a medical condition string.
 */
export async function getConditionSpecialties(
  condition: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!condition?.trim()) return [];

  try {
    const encoded = encodeURIComponent(condition.trim());
    const response = await apiFetch<{ specialties: string[] }>(
      `/api/trials/condition/${encoded}/specialties`,
      undefined,
      signal,
    );
    return response.specialties ?? [];
  } catch (err) {
    console.warn(`Could not fetch specialties for condition "${condition}":`, err);
    return [];
  }
}

/**
 * Fire a physician search directly from a Trial object.
 */
export async function getPhysiciansForTrial(
  trial:            Trial,
  userSpecialty:    string | null = null,
  initialSpecialty: string | null = null,
  radius:           number        = 25,
  signal?:          AbortSignal,
): Promise<PhysicianFetchResponse | null> {
  const site =
    trial.locations?.find((s) => s.lat != null && s.lon != null) ??
    trial.locations?.[0];

  if (!site?.lat || !site?.lon) {
    console.warn(
      `[getPhysiciansForTrial] Trial ${trial.nctId} has no coordinates — skipping physician search.`,
    );
    return null;
  }

  const trialCondition = trial.conditions?.[0] ?? "";

  const params: PhysicianSearchParams = {
    lat:    site.lat,
    lng:    site.lon,
    radius,
    ...(trialCondition.trim()    ? { specialty:         trialCondition.trim()   } : {}),
    ...(initialSpecialty?.trim() ? { initial_specialty: initialSpecialty.trim() } : {}),
    ...(userSpecialty?.trim()    ? { user_specialty:    userSpecialty.trim()    } : {}),
  };

  return apiFetch<PhysicianFetchResponse>(
    `/api/physicians/search?${buildPhysicianParams(params)}`,
    undefined,
    signal,
  );
}

// ── Leads ─────────────────────────────────────────────────────────────────────

function buildLeadPayload(raw: LeadPayload): Record<string, unknown> {
  const name  = raw.name?.trim()  ?? "";
  const email = raw.email?.trim() ?? "";

  if (!name)  throw new Error("Lead submission requires a name.");
  if (!email) throw new Error("Lead submission requires an email address.");

  const payload: Record<string, unknown> = {
    name,
    email,
    lead_source: raw.lead_source ?? "Clinical Trial",
    company:     raw.company     ?? "Individual Physicians",
    auto:        raw.auto        ?? false,
  };

  if (raw.phone?.trim())          payload.phone           = raw.phone.trim();
  if (raw.npi?.trim())            payload.npi             = raw.npi.trim();
  if (raw.nct_id?.trim())         payload.nct_id          = raw.nct_id.trim();
  if (raw.site?.trim())           payload.site            = raw.site.trim();
  if (raw.message?.trim())        payload.message         = raw.message.trim();
  if (raw.title?.trim())          payload.title           = raw.title.trim();
  if (raw.physician_name?.trim()) payload.physician_name  = raw.physician_name.trim();

  return payload;
}

export async function submitLead(
  payload: LeadPayload,
): Promise<{ success: boolean; id?: string }> {
  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(buildLeadPayload(payload)),
  });
}

export async function submitAutoLead(
  physician: Physician,
  site:      SelectedSite,
): Promise<{ success: boolean; id?: string }> {
  const payload: Record<string, unknown> = {
    name:           physician.name,
    company:        "Individual Physicians",
    lead_source:    "Clinical Trial",
    physician_name: physician.name,
    npi:            physician.npi,
    nct_id:         site.nct_id,
    auto:           true,
  };

  if (physician.phone?.trim())         payload.phone = physician.phone.trim();
  if (physician.taxonomy_desc?.trim()) payload.title = physician.taxonomy_desc.trim();
  if (site.facility?.trim())           payload.site  = site.facility.trim();

  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

// ── Apollo email lookup ───────────────────────────────────────────────────────

/**
 * Look up a physician's email via the Apollo search → enrich pipeline.
 *
 * Always resolves (never throws) — on network failure it returns
 * { found: false, email: null, error: "..." } so the caller can degrade
 * gracefully without a try/catch at the call site.
 *
 * Response semantics:
 *   found=true,  email=string  → email retrieved, proceed with lead
 *   found=true,  email=null    → person found but no email available → show fallback popup
 *   found=false, email=null    → no Apollo match → show fallback popup
 *   error=string               → hard failure (API key missing, network down)
 */
export async function fetchPhysicianEmail(params: {
  name:          string;
  address?:      string;
  organization?: string;
}): Promise<EmailLookupResult> {
  const fallback: EmailLookupResult = {
    found: false, email: null, apollo_name: null, error: null,
  };

  if (!params.name?.trim()) return fallback;

  try {
    const payload: Record<string, string> = {
      name: params.name.trim(),
    };
    if (params.address?.trim())      payload.address      = params.address.trim();
    if (params.organization?.trim()) payload.organization = params.organization.trim();

    const res = await fetch(`${BASE_URL}/api/apollo/find-email`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      console.warn(`[fetchPhysicianEmail] HTTP ${res.status}: ${detail}`);
      return { ...fallback, error: `HTTP ${res.status}` };
    }

    return (await res.json()) as EmailLookupResult;
  } catch (err) {
    console.warn("[fetchPhysicianEmail] Network error:", err);
    return { ...fallback, error: "Network error" };
  }
}

interface FetchAIInsightsParams {
  npi:      string;
  name:     string;
  specialty: string;
  disease:  string;
}

export async function fetchAIInsights({
  npi,
  name,
  specialty,
  disease,
}: FetchAIInsightsParams): Promise<AIInsightsData> {
  const params = new URLSearchParams({
    name,
    specialty,
    disease,
  });

  const res = await fetch(
    `${BASE_URL}/api/physicians/${encodeURIComponent(npi)}/insights?${params.toString()}`
  );

  if (!res.ok) {
    throw new Error(`AI Insights request failed: ${res.status}`);
  }

  return res.json();
}
