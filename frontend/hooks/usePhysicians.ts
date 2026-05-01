// hooks/usePhysicians.ts
// v6 changes:
//  - usePhysicians: main list now passes user specialty first, trial condition
//    only as fallback. This aligns with the updated /search endpoint priority.
//  - Added useSuggestedPhysicians hook: fetches from /suggested using only
//    the trial condition, passes main-list NPIs as exclude_npis.
//  - Both hooks are independent and can be used side-by-side in PhysicianPanel.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians, fetchSuggestedPhysicians } from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SuggestedPhysicianParams,
  SelectedSite,
} from "@/types/physician";

export const PAGE_SIZE = 10;
export const SUGGESTED_PAGE_SIZE = 5;

const RADIUS_STEPS = [25, 50, 75, 100];

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

// ── usePhysicians ─────────────────────────────────────────────────────────────
// Main physician list — user search criteria drive the specialties.
// Trial condition is only used as a fallback when the user hasn't entered
// any specialty, which matches the updated /search backend priority.

export function usePhysicians() {
  const [state, setState] = useState<PhysicianState>(INITIAL);
  const abortRef          = useRef<AbortController | null>(null);

  const initialSpecialtyRef = useRef<string | undefined>(undefined);
  const lastParamsRef       = useRef<PhysicianSearchParams | null>(null);
  const lastSiteRef         = useRef<SelectedSite | null>(null);
  const radiusStepRef       = useRef<number>(0);

  const search = useCallback(async (
    site:              SelectedSite,
    radius:            number  = 25,
    specialty?:        string,   // trial condition — fallback only
    userSpecialty?:    string,   // user-typed specialty — primary
    initialSpecialty?: string,   // pinned from first search
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!initialSpecialtyRef.current) {
      const first = (initialSpecialty ?? userSpecialty ?? specialty ?? "").trim();
      if (first) initialSpecialtyRef.current = first;
    }

    radiusStepRef.current = RADIUS_STEPS.indexOf(radius);
    if (radiusStepRef.current === -1) radiusStepRef.current = 0;

    lastSiteRef.current = site;

    // The /search endpoint now prioritises initial_specialty + user_specialty
    // over specialty (trial condition). Only pass specialty as a fallback when
    // there is genuinely no user-provided specialty so the list stays relevant.
    const hasUserSpecialty = !!(initialSpecialtyRef.current?.trim() || userSpecialty?.trim());

    const params: PhysicianSearchParams = {
      lat:    site.lat,
      lng:    site.lng,
      radius,
      // Only send trial condition as specialty when user hasn't provided one
      ...(!hasUserSpecialty && specialty?.trim() ? { specialty: specialty.trim() } : {}),
      ...(initialSpecialtyRef.current?.trim()    ? { initial_specialty: initialSpecialtyRef.current.trim() } : {}),
      ...(userSpecialty?.trim()                  ? { user_specialty:    userSpecialty.trim()               } : {}),
    };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const returned = result.physicians.length;
      const hasMore  = result.total > returned || radiusStepRef.current < RADIUS_STEPS.length - 1;

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
    const site       = lastSiteRef.current;
    const prevParams = lastParamsRef.current;
    if (!site || !prevParams || state.loading) return;

    const nextStepIdx = Math.min(radiusStepRef.current + 1, RADIUS_STEPS.length - 1);
    const nextRadius  = RADIUS_STEPS[nextStepIdx];
    radiusStepRef.current = nextStepIdx;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params: PhysicianSearchParams = { ...prevParams, radius: nextRadius };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const returned   = result.physicians.length;
      const hasMore    = (result.total > returned) || (nextStepIdx < RADIUS_STEPS.length - 1);

      setState((prev) => {
        const existingNpis = new Set(prev.allPhysicians.map((p) => p.npi));
        const newOnes  = result.physicians.filter((p) => !existingNpis.has(p.npi));
        const merged   = [...prev.allPhysicians, ...newOnes];
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
    initialSpecialtyRef.current = undefined;
    lastParamsRef.current       = null;
    lastSiteRef.current         = null;
    radiusStepRef.current       = 0;
    setState(INITIAL);
  }, []);

  return { ...state, search, loadMore, reset };
}

// ── useSuggestedPhysicians ────────────────────────────────────────────────────
// Suggested physicians — driven exclusively by the trial condition.
// Call `fetch()` with the site, condition, and the main list NPIs to exclude.
// `loadMore` expands the radius just like usePhysicians.

export function useSuggestedPhysicians() {
  const [state, setState] = useState<PhysicianState>(INITIAL);
  const abortRef          = useRef<AbortController | null>(null);
  const lastParamsRef     = useRef<SuggestedPhysicianParams | null>(null);
  const radiusStepRef     = useRef<number>(0);

  const fetch = useCallback(async (
    site:        SelectedSite,
    radius:      number   = 25,
    condition?:  string,
    excludeNpis: string[] = [],
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    radiusStepRef.current = RADIUS_STEPS.indexOf(radius);
    if (radiusStepRef.current === -1) radiusStepRef.current = 0;

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

      const returned = result.physicians.length;
      const hasMore  = result.total > returned || radiusStepRef.current < RADIUS_STEPS.length - 1;

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

    const nextStepIdx = Math.min(radiusStepRef.current + 1, RADIUS_STEPS.length - 1);
    const nextRadius  = RADIUS_STEPS[nextStepIdx];
    radiusStepRef.current = nextStepIdx;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params: SuggestedPhysicianParams = { ...prevParams, radius: nextRadius };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchSuggestedPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const returned = result.physicians.length;
      const hasMore  = (result.total > returned) || (nextStepIdx < RADIUS_STEPS.length - 1);

      setState((prev) => {
        const existingNpis = new Set(prev.allPhysicians.map((p) => p.npi));
        const newOnes  = result.physicians.filter((p) => !existingNpis.has(p.npi));
        const merged   = [...prev.allPhysicians, ...newOnes];
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
    radiusStepRef.current = 0;
    setState(INITIAL);
  }, []);

  return { ...state, fetch, loadMore, reset };
}