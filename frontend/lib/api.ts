// lib/api.ts
//
// v3 changes:
//  - getPhysiciansForTrial(): fixed bug where both trialCondition and
//    userSpecialty were assigned to the `specialty` key — the second
//    overwrote the first. They now use their correct distinct keys:
//    `specialty` for the trial condition, `user_specialty` for the
//    explicit user override. This ensures the backend receives both
//    and applies OR logic across all resolved specialties.
//  - getConditionSpecialties(): no functional changes; JSDoc updated.

import type { TrialFetchParams, TrialFetchResponse, SiteData, Trial } from "@/types/trial";
import type {
  PhysicianSearchParams,
  PhysicianFetchResponse,
  LeadPayload,
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
    // signal must come after the options spread so it is never overwritten
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

export async function fetchPhysicians(
  params:  PhysicianSearchParams,
  signal?: AbortSignal,
): Promise<PhysicianFetchResponse> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  return apiFetch<PhysicianFetchResponse>(`/api/physicians/search?${qs}`, undefined, signal);
}

/**
 * Fetch the NUCC specialty list for a medical condition string.
 *
 * The backend uses a 4-pass lookup (exact → prefix → substring → token)
 * against CONDITION_MAP so multi-word or mixed-case conditions from
 * ClinicalTrials.gov are handled correctly.
 *
 * Example:
 *   "High Grade Sarcoma" → ["Medical Oncology", "General Surgery"]
 *   "Metastatic Breast Cancer" → ["Medical Oncology", "Radiation Oncology"]
 *
 * Returns [] on network error (caller falls back gracefully).
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
 *
 * Returns null when the trial has no geocoded location data (avoids a
 * pointless 400 from the backend).
 *
 * FIX v3: `trialCondition` and `userSpecialty` previously both wrote to the
 * `specialty` key — the second assignment silently overwrote the first.
 * They now use distinct keys so the backend receives both:
 *   specialty      → trial condition string (backend maps via resolve_with_broader)
 *   user_specialty → explicit user override (OR'd with specialty results)
 */
export async function getPhysiciansForTrial(
  trial:         Trial,
  userSpecialty: string | null = null,
  radius:        number        = 25,
  signal?:       AbortSignal,
): Promise<PhysicianFetchResponse | null> {
  // Prefer the first site that has coordinates; fall back to the first site.
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
    // specialty = trial condition — backend maps this via resolve_with_broader()
    ...(trialCondition.trim()  ? { specialty:      trialCondition.trim()  } : {}),
    // user_specialty = explicit user override — OR'd with specialty results
    ...(userSpecialty?.trim()  ? { user_specialty: userSpecialty.trim()   } : {}),
  };

  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  return apiFetch<PhysicianFetchResponse>(
    `/api/physicians/search?${qs}`,
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