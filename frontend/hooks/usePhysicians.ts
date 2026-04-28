// hooks/usePhysicians.ts
// Manages all state for physician search triggered by a selected trial site.
//
// v4 changes:
//  - Tracks `initialSpecialtyRef`: the specialty string from the user's very
//    first search is captured once and forwarded on every subsequent search as
//    `initial_specialty`, so it is always OR-included even when the user edits
//    the specialty field or runs a follow-up search with a different value.
//  - Exposes `searchSpecialties: string[]` — the resolved specialty list
//    returned by the backend — so the UI (PhysicianPanel) can display a
//    "Searching: Medical Oncology · Orthopedic Surgery" breadcrumb.
//  - `search` signature extended: accepts `initialSpecialty?` (the value to
//    pin) and `userSpecialty?` (the additional explicit override).
//  - AbortController signal is properly forwarded to fetchPhysicians.
//  - loadMore reveals next PAGE_SIZE results from the already-fetched dataset.

"use client";

import { useState, useCallback, useRef } from "react";
import { fetchPhysicians }               from "@/lib/api";
import type {
  Physician,
  PhysicianSearchParams,
  SelectedSite,
} from "@/types/physician";

export const PAGE_SIZE = 10;

export interface PhysicianState {
  allPhysicians:     Physician[];
  physicians:        Physician[];
  total:             number;
  loading:           boolean;
  error:             string | null;
  searched:          boolean;
  radiusMiles:       number;
  zipsSearched:      number;
  page:              number;
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
  page:              1,
  hasMore:           false,
  searchSpecialties: [],
};

export function usePhysicians() {
  const [state, setState]   = useState<PhysicianState>(INITIAL);
  const abortRef            = useRef<AbortController | null>(null);

  /**
   * Captures the specialty string from the user's very first search.
   * This ref persists across re-searches so `initial_specialty` is always
   * forwarded to the backend, even when the user later edits the field.
   */
  const initialSpecialtyRef = useRef<string | undefined>(undefined);

  // ── search ──────────────────────────────────────────────────────────────
  const search = useCallback(async (
    site:              SelectedSite,
    radius:            number  = 25,
    specialty?:        string,   // raw trial condition (mapped by backend)
    userSpecialty?:    string,   // additional specialty explicitly entered by user
    initialSpecialty?: string,   // specialty from the user's first search (captured once)
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Capture the initial specialty once — first non-empty value wins.
    // Priority: explicit initialSpecialty arg → userSpecialty → specialty
    if (!initialSpecialtyRef.current) {
      const first = (initialSpecialty ?? userSpecialty ?? specialty ?? "").trim();
      if (first) initialSpecialtyRef.current = first;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const params: PhysicianSearchParams = {
        lat:    site.lat,
        lng:    site.lng,
        radius,
        ...(specialty?.trim()                   ? { specialty:         specialty.trim()                   } : {}),
        ...(initialSpecialtyRef.current?.trim() ? { initial_specialty: initialSpecialtyRef.current.trim() } : {}),
        ...(userSpecialty?.trim()               ? { user_specialty:    userSpecialty.trim()               } : {}),
      };

      const result = await fetchPhysicians(params, controller.signal);
      if (controller.signal.aborted) return;

      const firstPage = result.physicians.slice(0, PAGE_SIZE);

      setState({
        allPhysicians:     result.physicians,
        physicians:        firstPage,
        total:             result.total,
        loading:           false,
        error:             null,
        searched:          true,
        radiusMiles:       result.radius_miles,
        zipsSearched:      result.zips_searched,
        page:              1,
        hasMore:           result.physicians.length > PAGE_SIZE,
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

  // ── loadMore ─────────────────────────────────────────────────────────────
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
    initialSpecialtyRef.current = undefined;
    setState(INITIAL);
  }, []);

  return { ...state, search, loadMore, reset };
}