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
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchTrials(
  params: TrialFetchParams,
  signal?: AbortSignal,
): Promise<TrialFetchResponse> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();
  return apiFetch<TrialFetchResponse>(`/api/trials/?${qs}`, undefined, signal);
}

export async function fetchTrialSites(nctId: string): Promise<SiteData> {
  return apiFetch<SiteData>(`/api/trials/${nctId}/sites`);
}

export async function fetchPhysicians(
  params:  PhysicianSearchParams,
  signal?: AbortSignal,
): Promise<PhysicianFetchResponse> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();
  return apiFetch<PhysicianFetchResponse>(`/api/physicians/search?${qs}`, undefined, signal);
}

export async function getPhysiciansForTrial(
  trial:         Trial,
  userSpecialty: string | null = null,
  radius:        number        = 25,
  signal?:       AbortSignal,
): Promise<PhysicianFetchResponse | null> {
  const site = trial.locations?.find((s) => s.lat != null && s.lon != null)
            ?? trial.locations?.[0];

  if (!site?.lat || !site?.lon) {
    console.warn(`[getPhysiciansForTrial] Trial ${trial.nctId} has no coordinates — skipping physician search.`);
    return null;
  }

  const trialCondition = trial.conditions?.[0] ?? "";

  const params: Record<string, string> = {
    lat:    String(site.lat),
    lng:    String(site.lon),
    radius: String(radius),
  };

  if (trialCondition.trim()) params.specialty      = trialCondition.trim();
  if (userSpecialty?.trim()) params.user_specialty = userSpecialty.trim();

  const qs = new URLSearchParams(params).toString();
  return apiFetch<PhysicianFetchResponse>(`/api/physicians/search?${qs}`, undefined, signal);
}

export async function submitLead(
  payload: LeadPayload,
): Promise<{ success: boolean; lead_id?: string }> {
  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}