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
  const [offset,     setOffset]     = useState(0);
  const [hasMore,    setHasMore]    = useState(false);

  const LIMIT         = 10;
  const conditionRef  = useRef(condition);

  const load = useCallback(async (reset: boolean) => {
    if (!condition) return;
    conditionRef.current = condition;

    setLoading(true);
    setError(null);

    const currentOffset = reset ? 0 : offset;

    try {
      const data = await fetchTrials({
        condition,
        city,
        state,
        status,
        phase,
        limit:  LIMIT,
        offset: currentOffset,
      });

      // Discard stale responses if condition changed mid-flight
      if (conditionRef.current !== condition) return;

      if (reset) {
        setTrials(data.trials);
        setOffset(LIMIT);
      } else {
        setTrials((prev) => [...prev, ...data.trials]);
        setOffset((prev) => prev + LIMIT);
      }

      setTotalCount(data.total);
      setHasMore(data.trials.length === LIMIT);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to fetch trials");
    } finally {
      setLoading(false);
    }
  // offset intentionally omitted — managed internally
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition, city, state, status, phase]);

  // Trigger a fresh search whenever the filter params change
  useEffect(() => {
    if (condition) load(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition, city, state, status, phase]);

  const refetch  = useCallback(() => load(true),  [load]);
  const loadMore = useCallback(() => load(false), [load]);

  return { trials, loading, error, totalCount, hasMore, refetch, loadMore };
}

// Re-export so page.tsx can do:
//   import { useTrials, fetchTrialSites } from "@/hooks/useTrials"
export { fetchTrialSites };