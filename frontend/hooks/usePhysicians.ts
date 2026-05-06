// hooks/usePhysicians.ts
//
// Changes vs v6:
//
// FIX 1 — initialSpecialty no longer pinned forever inside the hook.
//   Professional apps treat "change specialty + search" as a NEW search,
//   not an additive one. The old behaviour pinned initialSpecialty on the
//   first search and sent it on every subsequent call — meaning the user
//   could never get a clean result set by typing a different specialty.
//   Now the hook is stateless about specialty history; PhysicianPanel owns
//   that logic entirely using the pre-resolved NUCC names from
//   getConditionSpecialties().
//
// FIX 2 — RADIUS_STEPS aligned with PhysicianPanel RADIUS_OPTIONS [5,10,25,50,100].
//   Old steps [25,50,75,100] meant loadMore() skipped the user's chosen
//   starting radius (e.g. 10mi) and jumped straight to 50mi.
//
// FIX 3 — loadMore() tracks the last used radius directly (lastRadiusRef)
//   and expands to the next step in RADIUS_STEPS regardless of what the
//   user picked as their starting point.
//
// FIX 4 — useSuggestedPhysicians accepts excludeNpis as a string[] but the
//   caller (PhysicianPanel) now passes a stable memoised value so the
//   useEffect dep does not change on every parent render.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians, fetchSuggestedPhysicians } from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SuggestedPhysicianParams,
  SelectedSite,
} from "@/types/physician";

export const PAGE_SIZE           = 10;
export const SUGGESTED_PAGE_SIZE = 5;

// Must match RADIUS_OPTIONS in PhysicianPanel exactly
export const RADIUS_STEPS = [5, 10, 25, 50, 100] as const;
type RadiusStep = typeof RADIUS_STEPS[number];

// ── Shared state shape ────────────────────────────────────────────────────────

export interface PhysicianState {
  allPhysicians:     Physician[];
  physicians:        Physician[];
  total:             number;
  loading:           boolean;
  error:             string | null;
  searched:          boolean;
  radiusMiles:       number;
  zipsSearched:      number;
  hasMore:           boolean;
  searchSpecialties: string[];
}

const INITIAL: PhysicianState = {
  allPhysicians:     [],
  physicians:        [],
  total:             0,
  loading:           false,
  error:             null,
  searched:          false,
  radiusMiles:       25,
  zipsSearched:      0,
  hasMore:           false,
  searchSpecialties: [],
};

function nextRadius(current: number): number | null {
  const idx = RADIUS_STEPS.indexOf(current as RadiusStep);
  if (idx >= 0 && idx < RADIUS_STEPS.length - 1) return RADIUS_STEPS[idx + 1];
  // If current isn't in the array (e.g. 75), find the next step above it
  const above = RADIUS_STEPS.find((r) => r > current);
  return above ?? null;
}

// ── usePhysicians ─────────────────────────────────────────────────────────────

export function usePhysicians() {
  const [state, setState] = useState<PhysicianState>(INITIAL);
  const abortRef          = useRef<AbortController | null>(null);
  const lastParamsRef     = useRef<PhysicianSearchParams | null>(null);
  const lastRadiusRef     = useRef<number>(25);

  const search = useCallback(async (
    site:              SelectedSite,
    radius:            number,
    specialty?:        string,   // raw trial condition — used only when no resolved specialty
    userSpecialty?:    string,   // user-typed specialty — highest priority
    initialSpecialty?: string,   // pre-resolved NUCC names from getConditionSpecialties()
  ) => {
    abortRef.current?.abort();
    const controller      = new AbortController();
    abortRef.current      = controller;
    lastRadiusRef.current = radius;

    // Send raw trial condition only when the caller has no better resolved name
    const hasResolved = !!(initialSpecialty?.trim() || userSpecialty?.trim());

    const params: PhysicianSearchParams = {
      lat:    site.lat,
      lng:    site.lng,
      radius,
      ...(!hasResolved && specialty?.trim()     ? { specialty:         specialty.trim()         } : {}),
      ...(initialSpecialty?.trim()              ? { initial_specialty: initialSpecialty.trim()  } : {}),
      ...(userSpecialty?.trim()                 ? { user_specialty:    userSpecialty.trim()     } : {}),
    };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const more = nextRadius(radius);
      const hasMore = result.total > result.physicians.length || more !== null;

      setState({
        allPhysicians:     result.physicians,
        physicians:        result.physicians,
        total:             result.total,
        loading:           false,
        error:             null,
        searched:          true,
        radiusMiles:       result.radius_miles,
        zipsSearched:      result.zips_searched,
        hasMore,
        searchSpecialties: result.search_specialties ?? [],
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading:  false,
        error:    "Could not load physicians. Please try again.",
        searched: true,
      }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const prevParams = lastParamsRef.current;
    if (!prevParams || state.loading) return;

    const next = nextRadius(lastRadiusRef.current);
    if (next === null) return; // already at max radius

    abortRef.current?.abort();
    const controller      = new AbortController();
    abortRef.current      = controller;
    lastRadiusRef.current = next;

    const params: PhysicianSearchParams = { ...prevParams, radius: next };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const more    = nextRadius(next);
      const hasMore = result.total > result.physicians.length || more !== null;

      setState((prev) => {
        const existingNpis = new Set(prev.allPhysicians.map((p) => p.npi));
        const newOnes      = result.physicians.filter((p) => !existingNpis.has(p.npi));
        const merged       = [...prev.allPhysicians, ...newOnes];
        return {
          ...prev,
          allPhysicians:     merged,
          physicians:        merged,
          total:             result.total,
          loading:           false,
          error:             null,
          radiusMiles:       result.radius_miles,
          zipsSearched:      result.zips_searched,
          hasMore,
          searchSpecialties: result.search_specialties ?? prev.searchSpecialties,
        };
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error:   "Could not load more physicians. Please try again.",
      }));
    }
  }, [state.loading]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    lastParamsRef.current = null;
    lastRadiusRef.current = 25;
    setState(INITIAL);
  }, []);

  return { ...state, search, loadMore, reset };
}

// ── useSuggestedPhysicians ────────────────────────────────────────────────────

export function useSuggestedPhysicians() {
  const [state, setState] = useState<PhysicianState>(INITIAL);
  const abortRef          = useRef<AbortController | null>(null);
  const lastParamsRef     = useRef<SuggestedPhysicianParams | null>(null);
  const lastRadiusRef     = useRef<number>(25);

  const fetch = useCallback(async (
    site:        SelectedSite,
    radius:      number,
    condition?:  string,
    excludeNpis: string[] = [],
  ) => {
    abortRef.current?.abort();
    const controller      = new AbortController();
    abortRef.current      = controller;
    lastRadiusRef.current = radius;

    const params: SuggestedPhysicianParams = {
      lat:          site.lat,
      lng:          site.lng,
      radius,
      condition:    condition ?? site.condition ?? undefined,
      exclude_npis: excludeNpis,
    };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchSuggestedPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const more    = nextRadius(radius);
      const hasMore = result.total > result.physicians.length || more !== null;

      setState({
        allPhysicians:     result.physicians,
        physicians:        result.physicians,
        total:             result.total,
        loading:           false,
        error:             null,
        searched:          true,
        radiusMiles:       result.radius_miles,
        zipsSearched:      result.zips_searched,
        hasMore,
        searchSpecialties: result.search_specialties ?? [],
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading:  false,
        error:    "Could not load suggested physicians. Please try again.",
        searched: true,
      }));
    }
  }, []);

  const loadMore = useCallback(async () => {
    const prevParams = lastParamsRef.current;
    if (!prevParams || state.loading) return;

    const next = nextRadius(lastRadiusRef.current);
    if (next === null) return;

    abortRef.current?.abort();
    const controller      = new AbortController();
    abortRef.current      = controller;
    lastRadiusRef.current = next;

    const params: SuggestedPhysicianParams = { ...prevParams, radius: next };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchSuggestedPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const more    = nextRadius(next);
      const hasMore = result.total > result.physicians.length || more !== null;

      setState((prev) => {
        const existingNpis = new Set(prev.allPhysicians.map((p) => p.npi));
        const newOnes      = result.physicians.filter((p) => !existingNpis.has(p.npi));
        const merged       = [...prev.allPhysicians, ...newOnes];
        return {
          ...prev,
          allPhysicians:     merged,
          physicians:        merged,
          total:             result.total,
          loading:           false,
          error:             null,
          radiusMiles:       result.radius_miles,
          zipsSearched:      result.zips_searched,
          hasMore,
          searchSpecialties: result.search_specialties ?? prev.searchSpecialties,
        };
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error:   "Could not load more suggested physicians. Please try again.",
      }));
    }
  }, [state.loading]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    lastParamsRef.current = null;
    lastRadiusRef.current = 25;
    setState(INITIAL);
  }, []);

  return { ...state, fetch, loadMore, reset };
}