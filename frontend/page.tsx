"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SearchForm from "./SearchForm";
import TrialList from "./TrialList";
import TrialSiteMap from "./TrialSiteMap";
import { Trial } from "./types";
import { useTrials, fetchTrialSites } from "./useTrials";

type Filters = {
  condition: string;
  city: string;
  state: string;
  status: string;
  phase: string;
};

type SiteData = {
  nctId: string;
  title: string;
  status: string;
  sites: {
    facility: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    status: string | null;
    lat: number | null;
    lon: number | null;
  }[];
};

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Derive filters directly from URL — single source of truth
  const filtersFromUrl: Filters = {
    condition: searchParams.get("condition") || "",
    city:      searchParams.get("city")      || "",
    state:     searchParams.get("state")     || "",
    status:    searchParams.get("status")    || "",
    phase:     searchParams.get("phase")     || "",
  };

  const hasResults = !!filtersFromUrl.condition;

  const [selectedTrial, setSelectedTrial] = useState<Trial | null>(null);
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  const prevConditionRef = useRef(filtersFromUrl.condition);
  useEffect(() => {
    if (prevConditionRef.current !== filtersFromUrl.condition) {
      setSelectedTrial(null);
      setSiteData(null);
      setSitesError(null);
      prevConditionRef.current = filtersFromUrl.condition;
    }
  }, [filtersFromUrl.condition]);

  const { trials, loading, error, totalCount, hasMore, refetch, loadMore } =
    useTrials(
      hasResults ? filtersFromUrl.condition : null,
      filtersFromUrl.city   || null,
      filtersFromUrl.state  || null,
      filtersFromUrl.status || undefined,
      filtersFromUrl.phase  || undefined,
    );

  const handleSearch = useCallback((nextFilters: Filters) => {
    const params = new URLSearchParams();
    if (nextFilters.condition.trim()) params.set("condition", nextFilters.condition.trim());
    if (nextFilters.city.trim())      params.set("city",      nextFilters.city.trim());
    if (nextFilters.state)            params.set("state",     nextFilters.state);
    if (nextFilters.status)           params.set("status",    nextFilters.status);
    if (nextFilters.phase)            params.set("phase",     nextFilters.phase);
    router.push(`?${params.toString()}`);
    setSelectedTrial(null);
    setSiteData(null);
    setSitesError(null);
  }, [router]);

  const handleSelectTrial = useCallback(async (trial: Trial) => {
    if (selectedTrial?.nctId === trial.nctId) {
      setSelectedTrial(null);
      setSiteData(null);
      return;
    }
    setSelectedTrial(trial);
    setSiteData(null);
    setSitesError(null);
    setSitesLoading(true);
    try {
      const data = await fetchTrialSites(trial.nctId);
      setSiteData(data);
    } catch {
      setSitesError("Could not load site locations. Please try again.");
    } finally {
      setSitesLoading(false);
    }
  }, [selectedTrial]);

  // Build a stable key from all URL params so SearchForm fully remounts
  // whenever the user submits a new search — ensuring initialValues always
  // populate the fields correctly on the results page.
  const searchFormKey = [
    filtersFromUrl.condition,
    filtersFromUrl.city,
    filtersFromUrl.state,
    filtersFromUrl.status,
    filtersFromUrl.phase,
  ].join("|");

  return (
    <div className={`app-shell${hasResults ? " has-results" : ""}`}>

      {/* ── HEADER ── */}
      <header className="site-header">
        <div className="header-inner">
          <div className="logo-group">
            <div className="logo-icon">Ct</div>
            <div className="logo-text">Clinical<span>Trial</span>Locator</div>
          </div>
          <div className="header-tagline">Find trials · Explore sites · View on map</div>
        </div>
      </header>

      {/* ── SEARCH FORM (hero mode — no results yet) ── */}
      {!hasResults && (
        <SearchForm
          key="hero"
          onSearch={handleSearch}
          loading={loading}
          compact={false}
        />
      )}

      {/* ── COMPACT SEARCH BAR (results mode — pre-filled from URL, fully editable) ── */}
      {hasResults && (
        <div className="search-card">
          <SearchForm
            key={searchFormKey}         {/* remount when URL params change */}
            onSearch={handleSearch}
            loading={loading}
            compact={true}
            initialValues={filtersFromUrl}
          />
        </div>
      )}

      {/* ── RESULTS LAYOUT ── */}
      {hasResults && (
        <div className="results-layout">

          {/* LEFT: Trial List */}
          <div className="trials-panel">
            {loading && (
              <div className="state-box">
                <div className="spinner" />
                <p className="state-msg">Searching trials…</p>
              </div>
            )}

            {!loading && error && (
              <div className="error-box">
                <span>Error</span>
                <div>
                  <p>{error}</p>
                  <button className="btn-primary" onClick={refetch}>Try Again</button>
                </div>
              </div>
            )}

            {!loading && !error && trials.length === 0 && (
              <div className="no-results">
                <div className="no-results-icon">🔍</div>
                <h3>No trials found</h3>
                <p>Try broadening your search criteria.</p>
              </div>
            )}

            {!loading && !error && trials.length > 0 && (
              <TrialList
                trials={trials}
                totalCount={totalCount}
                selectedId={selectedTrial?.nctId ?? null}
                onSelect={handleSelectTrial}
                hasMore={hasMore}
                onLoadMore={loadMore}
                loading={loading}
              />
            )}
          </div>

          {/* RIGHT: Detail Panel */}
          <div className="detail-panel">
            {!selectedTrial && (
              <div className="detail-empty">
                <div className="detail-empty-icon">🗺️</div>
                <p>Select a trial to view site locations</p>
              </div>
            )}

            {selectedTrial && (
              <>
                <div style={{
                  padding: "16px 28px",
                  borderBottom: "1px solid var(--gray-100)",
                  background: "var(--white)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: "var(--blue-500)",
                      letterSpacing: "0.6px", textTransform: "uppercase",
                    }}>{selectedTrial.nctId}</span>
                    {selectedTrial.status && (
                      <span className={`badge ${
                        (selectedTrial.status || "").toLowerCase() === "recruiting"
                          ? "badge-status-recruiting" : "badge-status-default"
                      }`}>{selectedTrial.status}</span>
                    )}
                    {selectedTrial.phases?.map((p) => (
                      <span key={p} className="badge badge-phase">{p}</span>
                    ))}
                  </div>
                  <div style={{
                    fontSize: 15, fontWeight: 600, color: "var(--gray-800)",
                    lineHeight: 1.45, marginBottom: selectedTrial.sponsor ? 4 : 0,
                  }}>{selectedTrial.title}</div>
                  {selectedTrial.sponsor && (
                    <div style={{ fontSize: 12, color: "var(--gray-400)" }}>
                      Sponsor: <span style={{ color: "var(--gray-600)", fontWeight: 500 }}>{selectedTrial.sponsor}</span>
                    </div>
                  )}
                </div>

                {sitesLoading && (
                  <div className="state-box">
                    <div className="spinner" />
                    <p className="state-msg">Loading site locations…</p>
                  </div>
                )}

                {sitesError && (
                  <div style={{ padding: "16px 28px 0" }}>
                    <div className="error-box">
                      <span>Error</span>
                      <p>{sitesError}</p>
                    </div>
                  </div>
                )}

                {siteData && !sitesLoading && (
                  <TrialSiteMap
                    sites={siteData.sites}
                    trialTitle={siteData.title}
                    description={selectedTrial.description || null}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <div className="spinner" />
      </div>
    }>
      <HomeInner />
    </Suspense>
  );
}