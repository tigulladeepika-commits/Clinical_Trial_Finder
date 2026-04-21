// hooks/usePhysicians.ts
// Manages all state for physician search triggered by a selected trial site.
// Keeps the fetch logic out of components entirely.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians }               from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SelectedSite,
} from "@/types/physician";

export type PhysicianSearchState = {
  physicians:   Physician[];
  total:        number;
  loading:      boolean;
  error:        string | null;
  searched:     boolean;   // true once at least one search has completed
  radiusMiles:  number;
  zipsSearched: number;
};

const INITIAL_STATE: PhysicianSearchState = {
  physicians:   [],
  total:        0,
  loading:      false,
  error:        null,
  searched:     false,
  radiusMiles:  25,
  zipsSearched: 0,
};

export function usePhysicians() {
  const [state, setState] = useState<PhysicianSearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (
    site:      SelectedSite,
    radius:    number = 25,
    specialty?: string,
  ) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const params: PhysicianSearchParams = {
        lat:    site.lat,
        lng:    site.lng,
        radius,
        ...(specialty ? { specialty } : {}),
      };

      const result = await fetchPhysicians(params);

      setState({
        physicians:   result.physicians,
        total:        result.total,
        loading:      false,
        error:        null,
        searched:     true,
        radiusMiles:  result.radius_miles,
        zipsSearched: result.zips_searched,
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

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, search, reset };
}