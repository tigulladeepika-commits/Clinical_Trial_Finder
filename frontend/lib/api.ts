// lib/api.ts
//
// v7 changes:
//  - submitLead() — added buildLeadPayload() guard that strips undefined/null
//    values and validates name + email before sending, preventing 422 errors
//    from Pydantic's EmailStr validator on the backend.
//  - submitAutoLead() — return type unified to { success: boolean; id?: string }
//    (was mismatched with { lead_id? } in submitLead — now both use `id`).
//  - buildPhysicianParams() helper (v5) retained unchanged.

import type { TrialFetchParams, TrialFetchResponse, SiteData, Trial } from "@/types/trial";
import type {
  PhysicianSearchParams,
  PhysicianFetchResponse,
  LeadPayload,
  Physician,
  SelectedSite,
} from "@/types/physician";

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");

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
 * Specialty fields are split on commas and appended as repeated params
 * so "Medical Oncology, Hematology & Oncology" becomes:
 *   specialty=Medical+Oncology&specialty=Hematology+%26+Oncology
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

/**
 * Validates and cleans a LeadPayload before sending to the API.
 * Strips undefined/null/empty optional fields so they are omitted from the
 * JSON body entirely — preventing Pydantic from receiving "undefined" as a
 * string and failing EmailStr validation.
 *
 * Throws if name or email are missing, so the caller gets a clear error
 * rather than a cryptic 422 from the backend.
 */
function buildLeadPayload(raw: LeadPayload): Record<string, unknown> {
  const name  = raw.name?.trim()  ?? "";
  const email = raw.email?.trim() ?? "";

  if (!name)  throw new Error("Lead submission requires a name.");
  if (!email) throw new Error("Lead submission requires an email address.");

  // Only include optional string fields when they have a real value —
  // omitting them means Pydantic uses its defaults instead of seeing "undefined".
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

/**
 * Submit a user-filled lead form (Load More modal).
 * Validates name + email before sending — throws on missing required fields.
 */
export async function submitLead(
  payload: LeadPayload,
): Promise<{ success: boolean; id?: string }> {
  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(buildLeadPayload(payload)),
  });
}

/**
 * Auto-generate a Salesforce lead from a Physician record.
 * No user form — all fields are derived from the physician data.
 *
 * Fixed values:
 *   email       → lead@aquarient.local
 *   company     → Individual Physicians
 *   lead_source → Clinical Trial
 *
 * Derived values:
 *   name            → physician.name
 *   phone           → physician.phone
 *   title           → physician.taxonomy_desc
 *   npi             → physician.npi
 *   nct_id          → site.nct_id
 *   site            → site.facility
 *   physician_name  → physician.name
 */
export async function submitAutoLead(
  physician: Physician,
  site:      SelectedSite,
): Promise<{ success: boolean; id?: string }> {
  // buildLeadPayload is not used here because all fields are hardcoded /
  // safely derived — there is no user input that could be undefined.
  const payload: Record<string, unknown> = {
    name:           physician.name,
    email:          "lead@aquarient.local",
    company:        "Individual Physicians",
    lead_source:    "Clinical Trial",
    physician_name: physician.name,
    npi:            physician.npi,
    nct_id:         site.nct_id,
    auto:           true,
  };

  // Optional fields — only include when present
  if (physician.phone?.trim())         payload.phone = physician.phone.trim();
  if (physician.taxonomy_desc?.trim()) payload.title = physician.taxonomy_desc.trim();
  if (site.facility?.trim())           payload.site  = site.facility.trim();

  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}