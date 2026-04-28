// lib/api.ts
//
// v6 changes:
//  - submitAutoLead() — auto-generates a Salesforce lead from a Physician
//    object without a user form. Fixed fields: email=lead@aquarient.local,
//    company=Individual Physicians, lead_source=Clinical Trial.
//  - buildPhysicianParams() helper (v5) retained.

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

export async function submitLead(
  payload: LeadPayload,
): Promise<{ success: boolean; lead_id?: string }> {
  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(payload),
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
 *   name   → physician.name
 *   phone  → physician.phone
 *   title  → physician.taxonomy_desc
 *   npi    → physician.npi
 *   nct_id → site.nct_id
 *   site   → site.facility
 */
export async function submitAutoLead(
  physician: Physician,
  site:      SelectedSite,
): Promise<{ success: boolean; id?: string }> {
  const payload = {
    name:           physician.name,
    email:          "lead@aquarient.local",
    phone:          physician.phone          ?? "",
    title:          physician.taxonomy_desc  ?? "",
    company:        "Individual Physicians",
    lead_source:    "Clinical Trial",
    physician_name: physician.name,
    npi:            physician.npi,
    nct_id:         site.nct_id,
    site:           site.facility            ?? "",
    auto:           true,
  };

  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}