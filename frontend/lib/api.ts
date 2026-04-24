// lib/api.ts

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
    // FIX: signal must come after the options spread so it is never overwritten
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

export async function fetchTrialSites(nctId: string): Promise<SiteData> {
  return apiFetch<SiteData>(`/api/trials/${nctId}/sites`);
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
 * Convenience helper used by page.tsx to fire a physician search
 * directly from a Trial object.  Returns null when the trial has no
 * geocoded location data (avoids a pointless 400 from the backend).
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
    // FIX: only add specialty when it is a non-empty string
    ...(trialCondition.trim() ? { specialty: trialCondition.trim() } : {}),
    ...(userSpecialty?.trim()  ? { specialty: userSpecialty.trim() } : {}),
  };

  return apiFetch<PhysicianFetchResponse>(
    `/api/physicians/search?${new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    )}`,
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