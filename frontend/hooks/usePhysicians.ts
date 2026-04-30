// hooks/usePhysicians.ts
// Manages all state for physician search triggered by a selected trial site.
//
// v5 changes:
//  - Fixed hasMore: was comparing result.physicians.length > PAGE_SIZE which
//    is always false because the backend caps results at MAX_DISPLAY (10).
//    Now correctly computes hasMore = total > physicians_returned, where
//    `total` is the full count of matching physicians in the search radius.
//  - loadMore now re-fetches from the backend with an increased radius
//    (stepping up through RADIUS_STEPS) rather than paginating a local slice,
//    because the backend only returns MAX_DISPLAY physicians per call.
//    This means "Load More" genuinely loads more physicians, not just
//    re-reveals ones already fetched.
//  - Retained all v4 behaviour: initialSpecialtyRef pinning, searchSpecialties
//    breadcrumb, AbortController signal forwarding.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians }               from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SelectedSite,
} from "@/types/physician";

export const PAGE_SIZE = 10;

// Radius steps used when "Load More" expands the search area.
// Starts from whatever radius the user last searched, then steps up.
const RADIUS_STEPS = [25, 50, 75, 100];

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
  /** Resolved specialty strings that were actually searched (for UI display). */
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

export function usePhysicians() {
  const [state, setState] = useState<PhysicianState>(INITIAL);
  const abortRef          = useRef<AbortController | null>(null);

  // Pinned refs — persist across re-searches for the lifetime of this session
  const initialSpecialtyRef = useRef<string | undefined>(undefined);
  const lastParamsRef       = useRef<PhysicianSearchParams | null>(null);
  const lastSiteRef         = useRef<SelectedSite | null>(null);
  const radiusStepRef       = useRef<number>(0); // index into RADIUS_STEPS

  // ── search ────────────────────────────────────────────────────────────────
  const search = useCallback(async (
    site:              SelectedSite,
    radius:            number  = 25,
    specialty?:        string,
    userSpecialty?:    string,
    initialSpecialty?: string,
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Capture the initial specialty once — first non-empty value wins.
    if (!initialSpecialtyRef.current) {
      const first = (initialSpecialty ?? userSpecialty ?? specialty ?? "").trim();
      if (first) initialSpecialtyRef.current = first;
    }

    // Reset radius step on a fresh search
    radiusStepRef.current = RADIUS_STEPS.indexOf(radius);
    if (radiusStepRef.current === -1) radiusStepRef.current = 0;

    // Persist site + params for loadMore re-fetches
    lastSiteRef.current = site;

    const params: PhysicianSearchParams = {
      lat:    site.lat,
      lng:    site.lng,
      radius,
      ...(specialty?.trim()                   ? { specialty:         specialty.trim()                   } : {}),
      ...(initialSpecialtyRef.current?.trim() ? { initial_specialty: initialSpecialtyRef.current.trim() } : {}),
      ...(userSpecialty?.trim()               ? { user_specialty:    userSpecialty.trim()               } : {}),
    };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      // FIX: hasMore must compare total (all matching physicians in radius)
      // against how many the backend actually returned this call.
      // result.total  = full count of physicians found in search area
      // result.physicians.length = how many were returned (capped at MAX_DISPLAY)
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

  // ── loadMore ──────────────────────────────────────────────────────────────
  // Re-fetches from the backend with an expanded radius so new physicians
  // are genuinely loaded (not just re-revealing an already-fetched slice).
  const loadMore = useCallback(async () => {
    const site       = lastSiteRef.current;
    const prevParams = lastParamsRef.current;
    if (!site || !prevParams || state.loading) return;

    // Step up to next radius
    const nextStepIdx = Math.min(radiusStepRef.current + 1, RADIUS_STEPS.length - 1);
    const nextRadius  = RADIUS_STEPS[nextStepIdx];
    radiusStepRef.current = nextStepIdx;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params: PhysicianSearchParams = {
      ...prevParams,
      radius: nextRadius,
    };
    lastParamsRef.current = params;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const returned = result.physicians.length;
      const hasMore  = (result.total > returned) || (nextStepIdx < RADIUS_STEPS.length - 1);

      setState((prev) => {
        // Merge: keep previous physicians, append new ones not already shown
        const existingNpis = new Set(prev.allPhysicians.map((p) => p.npi));
        const newOnes = result.physicians.filter((p) => !existingNpis.has(p.npi));
        const merged  = [...prev.allPhysicians, ...newOnes];
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

  // ── reset ─────────────────────────────────────────────────────────────────
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