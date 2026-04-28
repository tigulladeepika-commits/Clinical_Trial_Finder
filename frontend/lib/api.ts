// lib/api.ts
//
// v4 changes:
//  - PhysicianSearchParams now has three specialty fields:
//      specialty         — raw trial condition (backend maps via resolve_with_broader)
//      initial_specialty — the specialty from the user's very first search;
//                          forwarded on every subsequent search so it is always
//                          OR-included even when the user edits the field.
//      user_specialty    — any additional specialty explicitly typed by the user.
//  - fetchPhysicians / getPhysiciansForTrial both forward all three fields.
//  - PhysicianFetchResponse now includes search_specialties[] so the UI
//    can display which specialties were actually searched.

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
 * Passes all three specialty inputs to the backend so they are OR-combined:
 *   specialty         — trial condition (mapped via resolve_with_broader)
 *   initial_specialty — specialty from the user's first search (always included)
 *   user_specialty    — any additional specialty the user typed explicitly
 *
 * Returns null when the trial has no geocoded location data.
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
    ...(trialCondition.trim()    ? { specialty:          trialCondition.trim()    } : {}),
    ...(initialSpecialty?.trim() ? { initial_specialty:  initialSpecialty.trim()  } : {}),
    ...(userSpecialty?.trim()    ? { user_specialty:     userSpecialty.trim()     } : {}),
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