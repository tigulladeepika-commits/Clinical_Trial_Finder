// lib/api.ts
// All backend fetch calls live here. Components and hooks import named
// functions rather than calling fetch() directly.

import type { TrialFetchParams, TrialFetchResponse, SiteData } from "@/types/trial";
import type {
  PhysicianSearchParams,
  PhysicianFetchResponse,
  LeadPayload,
} from "@/types/physician";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// ── Trials ────────────────────────────────────────────────────────────────────

export async function fetchTrials(
  params: TrialFetchParams
): Promise<TrialFetchResponse> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();
  // FIX: was /api/trials/search — backend route is /api/trials/ (no "search" suffix)
  return apiFetch<TrialFetchResponse>(`/api/trials/?${qs}`);
}

/**
 * Fetch site-level data for a single trial.
 * Returns a SiteData object (title + sites[]) so page.tsx can store it in
 * one piece of state and pass sites to TrialSiteMap and title to the header.
 */
export async function fetchTrialSites(nctId: string): Promise<SiteData> {
  return apiFetch<SiteData>(`/api/trials/${nctId}/sites`);
}

// ── Physicians ────────────────────────────────────────────────────────────────

export async function fetchPhysicians(
  params: PhysicianSearchParams
): Promise<PhysicianFetchResponse> {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)])
  ).toString();
  return apiFetch<PhysicianFetchResponse>(`/api/physicians/search?${qs}`);
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export async function submitLead(
  payload: LeadPayload
): Promise<{ success: boolean; lead_id?: string }> {
  return apiFetch("/api/leads", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}