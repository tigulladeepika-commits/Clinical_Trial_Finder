// hooks/usePhysicians.ts
// Manages all state for physician search triggered by a selected trial site.
//
// Fixes applied:
//  - AbortController signal is properly forwarded to fetchPhysicians so
//    in-flight requests are actually cancelled on new searches.
//  - loadMore reveals next PAGE_SIZE results from the already-fetched
//    full dataset — no extra network request needed.
//  - `search` is exposed as `search` (not `searchPhysicians`) to keep
//    the hook's public API consistent with how page.tsx calls it.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians }               from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SelectedSite,
} from "@/types/physician";

/** Number of physician cards visible per page. */
export const PAGE_SIZE = 10;

export interface PhysicianState {
  /** Full dataset returned by the backend. */
  allPhysicians: Physician[];
  /** Visible slice (first `page × PAGE_SIZE` items). */
  physicians:    Physician[];
  total:         number;
  loading:       boolean;
  error:         string | null;
  /** true once at least one search has completed (success or error). */
  searched:      boolean;
  radiusMiles:   number;
  zipsSearched:  number;
  /** 1-based page index. */
  page:          number;
  /** true when there are more physicians to reveal. */
  hasMore:       boolean;
}

const INITIAL: PhysicianState = {
  allPhysicians: [],
  physicians:    [],
  total:         0,
  loading:       false,
  error:         null,
  searched:      false,
  radiusMiles:   25,
  zipsSearched:  0,
  page:          1,
  hasMore:       false,
};

export function usePhysicians() {
  const [state, setState] = useState<PhysicianState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  // ── search ──────────────────────────────────────────────────────────────
  const search = useCallback(async (
    site:       SelectedSite,
    radius:     number = 25,
    specialty?: string,
  ) => {
    // Cancel in-flight request AND the outbound HTTP call.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const params: PhysicianSearchParams = {
        lat:    site.lat,
        lng:    site.lng,
        radius,
        ...(specialty?.trim() ? { specialty: specialty.trim() } : {}),
      };

      // FIX: pass controller.signal so the fetch is actually cancelled.
      const result = await fetchPhysicians(params, controller.signal);

      if (controller.signal.aborted) return;

      const firstPage = result.physicians.slice(0, PAGE_SIZE);

      setState({
        allPhysicians: result.physicians,
        physicians:    firstPage,
        total:         result.total,
        loading:       false,
        error:         null,
        searched:      true,
        radiusMiles:   result.radius_miles,
        zipsSearched:  result.zips_searched,
        page:          1,
        hasMore:       result.physicians.length > PAGE_SIZE,
      });
    } catch (err: unknown) {
      // AbortError is intentional — silently swallow it.
      if ((err as Error).name === "AbortError") return;

      setState((prev) => ({
        ...prev,
        loading:  false,
        error:    "Could not load physicians. Please try again.",
        searched: true,
      }));
    }
  }, []);

  // ── loadMore ─────────────────────────────────────────────────────────────
  /**
   * Reveal the next PAGE_SIZE physicians from the already-fetched dataset.
   * No network request is made.
   */
  const loadMore = useCallback(() => {
    setState((prev) => {
      if (!prev.hasMore) return prev;

      const nextPage  = prev.page + 1;
      const nextSlice = prev.allPhysicians.slice(0, nextPage * PAGE_SIZE);

      return {
        ...prev,
        physicians: nextSlice,
        page:       nextPage,
        hasMore:    nextSlice.length < prev.allPhysicians.length,
      };
    });
  }, []);

  // ── reset ────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  return { ...state, search, loadMore, reset };
}