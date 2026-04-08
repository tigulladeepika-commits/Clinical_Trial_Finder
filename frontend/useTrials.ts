"use client";

import { useState, useEffect, useCallback } from "react";
import { Trial } from "./types";

const PAGE_SIZE = 10;
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL?.trim();
const API_BASE = PUBLIC_API_URL
  ? PUBLIC_API_URL.replace(/\/+$/, "")
  : process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "";

function buildApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function fetchTrials(params: {
  condition: string;
  city?: string;
  state?: string;
  status?: string;
  phase?: string;
  limit?: number;
  offset?: number;
}): Promise<{ trials: Trial[]; total: number }> {
  const query = new URLSearchParams();
  query.set("condition", params.condition);

  if (params.city) query.set("city", params.city);
  if (params.state) query.set("state", params.state);
  if (params.status) query.set("status", params.status);
  if (params.phase) query.set("phase", params.phase);

  query.set("limit", String(params.limit ?? PAGE_SIZE));
  query.set("offset", String(params.offset ?? 0));

  const res = await fetch(buildApiUrl(`/api/trials/?${query.toString()}`));
  if (!res.ok) throw new Error(`API error ${res.status}`);

  const data = await res.json();
  return {
    trials: data.trials ?? [],
    total: data.pagination?.total ?? 0,
  };
}

export async function fetchTrialSites(nctId: string) {
  const res = await fetch(buildApiUrl(`/api/trials/${nctId}/sites`));
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export function useTrials(
  condition: string | null,
  city: string | null,
  state: string | null,
  status?: string,
  phase?: string,
) {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const hasAnyFilter = !!(condition || city || state || status || phase);

  const load = useCallback(async (pageNum: number, replace: boolean) => {
    if (!condition && !city && !state && !status && !phase) return;

    setLoading(true);
    setError(null);

    try {
      const offset = (pageNum - 1) * PAGE_SIZE;
      const result = await fetchTrials({
        condition: condition || "",
        city: city || undefined,
        state: state || undefined,
        status: status || undefined,
        phase: phase || undefined,
        limit: PAGE_SIZE,
        offset,
      });

      setTrials((prev) => replace ? result.trials : [...prev, ...result.trials]);
      setTotalCount(result.total);
      setHasMore((pageNum * PAGE_SIZE) < result.total);
    } catch {
      setError("Failed to load trials. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [condition, city, state, status, phase]);

  useEffect(() => {
    setPage(1);
    setTrials([]);
    setTotalCount(0);
    setHasMore(false);
    load(1, true);
  }, [load]);

  const refetch = () => {
    setPage(1);
    setTrials([]);
    setTotalCount(0);
    load(1, true);
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    load(nextPage, false);
  };

  return { trials, loading, error, totalCount, hasMore, refetch, loadMore, hasAnyFilter };
}
