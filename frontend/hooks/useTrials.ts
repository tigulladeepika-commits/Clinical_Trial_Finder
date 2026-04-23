// hooks/useTrials.ts
// Manages paginated trial search state.
// fetchTrialSites is re-exported here so page.tsx has a single import point.

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { fetchTrials, fetchTrialSites }             from "@/lib/api";
import type { Trial }                               from "@/types/trial";

export function useTrials(
  condition: string | null,
  city?:     string | null,
  state?:    string | null,
  status?:   string,
  phase?:    string,
) {
  const [trials,     setTrials]     = useState<Trial[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore,    setHasMore]    = useState(false);

  const LIMIT = 10;
  const offsetRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify([
    condition ?? "",
    city ?? "",
    state ?? "",
    status ?? "",
    phase ?? "",
  ]);
  const requestKeyRef = useRef(requestKey);

  const load = useCallback(async (reset: boolean) => {
    if (!condition) {
      return;
    }

    const currentRequestKey = requestKey;
    requestKeyRef.current = currentRequestKey;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const currentOffset = reset ? 0 : offsetRef.current;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchTrials({
        condition,
        city,
        state,
        status,
        phase,
        page_size: LIMIT,
        page: Math.floor(currentOffset / LIMIT) + 1,
      }, controller.signal);

      if (controller.signal.aborted || requestKeyRef.current !== currentRequestKey) {
        return;
      }

      const loadedCount = currentOffset + data.trials.length;
      offsetRef.current = loadedCount;

      setTrials((prev) => (reset ? data.trials : [...prev, ...data.trials]));
      setTotalCount(data.total);
      setHasMore(loadedCount < data.total);
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        return;
      }
      if (requestKeyRef.current !== currentRequestKey) {
        return;
      }
      setError((err as Error).message || "Failed to fetch trials");
    } finally {
      if (!controller.signal.aborted && requestKeyRef.current === currentRequestKey) {
        setLoading(false);
      }
    }
  }, [condition, city, state, status, phase, requestKey]);

  useEffect(() => {
    requestKeyRef.current = requestKey;
    offsetRef.current = 0;
    setTrials([]);
    setError(null);
    setTotalCount(0);
    setHasMore(false);

    if (!condition) {
      abortRef.current?.abort();
      setLoading(false);
      return;
    }

    void load(true);
  }, [condition, load, requestKey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const refetch = useCallback(() => {
    offsetRef.current = 0;
    void load(true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || !condition) {
      return;
    }
    void load(false);
  }, [condition, hasMore, load, loading]);

  return { trials, loading, error, totalCount, hasMore, refetch, loadMore };
}

// Re-export so page.tsx can do:
//   import { useTrials, fetchTrialSites } from "@/hooks/useTrials"
export { fetchTrialSites };
