// hooks/usePhysicians.ts
// Manages all state for physician search triggered by a selected trial site.
// Keeps the fetch logic out of components entirely.
//
// Changes:
//  - (change #9) Added pagination: all physicians are fetched at once from the
//    backend but only PAGE_SIZE are shown at a time. Each "Load More" click
//    reveals the next PAGE_SIZE results without a new network request.
//  - (change #6) Exposes `hasMore` and `loadMore` so the Load More button in
//    the UI knows when to show the LeadCaptureModal before revealing new cards.
//  - (fix) AbortController signal is properly forwarded to fetchPhysicians so
//    in-flight requests are actually cancelled on new searches.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians }               from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SelectedSite,
} from "@/types/physician";

/** Number of physician cards shown per page (change #9). */
export const PAGE_SIZE = 10;

export type PhysicianSearchState = {
  /** All physicians returned by the backend (full dataset). */
  allPhysicians:    Physician[];
  /** Slice currently visible in the UI (first `page * PAGE_SIZE` items). */
  physicians:       Physician[];
  total:            number;
  loading:          boolean;
  error:            string | null;
  /** true once at least one search has completed */
  searched:         boolean;
  radiusMiles:      number;
  zipsSearched:     number;
  /** Current page index (1-based). Starts at 1 after first search. */
  page:             number;
  /** true when there are more physicians to reveal via Load More (change #9). */
  hasMore:          boolean;
};

const INITIAL_STATE: PhysicianSearchState = {
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
  const [state, setState] = useState<PhysicianSearchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  // ── search ────────────────────────────────────────────────────────────────
  const search = useCallback(async (
    site:       SelectedSite,
    radius:     number = 25,
    specialty?: string,
  ) => {
    // Cancel any in-flight request — both state update AND the outbound HTTP
    // request. Previously the AbortController was created but its signal was
    // never forwarded to fetchPhysicians, so in-flight requests kept running.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const params: PhysicianSearchParams = {
        lat:    site.lat,
        lng:    site.lng,
        radius,
        ...(specialty ? { specialty } : {}),
      };

      // Backend returns the full dataset (change #9 — no server-side page limit).
      // Pass the AbortSignal so the fetch is cancelled when the user navigates
      // away or triggers a new search before this one completes.
      const result = await fetchPhysicians(params, controller.signal);

      // Show only the first page of results immediately (change #9).
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
      // Ignore abort errors — they are intentional cancellations.
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
  /**
   * Reveals the next PAGE_SIZE physicians from the already-fetched full
   * dataset. No new network request is made (change #9).
   *
   * The UI component is responsible for showing the LeadCaptureModal before
   * calling loadMore when triggerSource === "load_more" (change #6).
   */
  const loadMore = useCallback(() => {
    setState((prev) => {
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

  // ── reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, search, loadMore, reset };
}