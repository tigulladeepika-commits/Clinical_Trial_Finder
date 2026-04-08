"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

export default function Home() {
  const [filters, setFilters] = useState<Filters | null>(null);
  const [selectedTrial, setSelectedTrial] = useState<Trial | null>(null);
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  const hasResults = filters !== null;

  const { trials, loading, error, totalCount, hasMore, refetch, loadMore, hasAnyFilter } =
    useTrials(
      filters?.condition ?? null,
      filters?.city ?? null,
      filters?.state ?? null,
      filters?.status || undefined,
      filters?.phase || undefined,
    );

  const handleSearch = useCallback((nextFilters: Filters) => {
    setFilters(nextFilters);
    setSelectedTrial(null);
    setSiteData(null);
    setSitesError(null);
  }, []);

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

      {/* ── HERO STATE (no results yet) ── */}
      {!hasResults && (
        <div className="hero-section">
          <div className="hero-badge">🔬 Clinical Research Database</div>
          <h1 className="hero-title">
            Find <em>Clinical Trials</em><br />Near You
          </h1>
          <p className="hero-sub">
            Search thousands of active clinical trials by condition, location, phase, and status.
            Select a trial to explore all its research sites on an interactive map.
          </p>
          <div className="search-card">
            <SearchForm onSearch={handleSearch} loading={loading} compact={false} />
          </div>
        </div>
      )}

      {/* ── COMPACT SEARCH BAR (after results) ── */}
      {hasResults && (
        <div className="search-card">
          <SearchForm onSearch={handleSearch} loading={loading} compact={true} />
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
                {/* Trial Header */}
                <div className="detail-content" style={{ paddingBottom: 0 }}>
                  <div className="detail-header">
                    <div className="detail-nct">{selectedTrial.nctId}</div>
                    <div className="detail-title">{selectedTrial.title}</div>
                    <div className="detail-badges">
                      {selectedTrial.status && (
                        <span className={`badge ${
                          (selectedTrial.status || "").toLowerCase() === "recruiting"
                            ? "badge-status-recruiting"
                            : "badge-status-default"
                        }`}>{selectedTrial.status}</span>
                      )}
                      {selectedTrial.phases?.map((p) => (
                        <span key={p} className="badge badge-phase">{p}</span>
                      ))}
                    </div>
                    {selectedTrial.sponsor && (
                      <div className="detail-sponsor">
                        Sponsor: <strong>{selectedTrial.sponsor}</strong>
                      </div>
                    )}
                  </div>

                  {selectedTrial.description && (
                    <div className="detail-section">
                      <div className="section-title">About This Trial</div>
                      <p className="description-text">{selectedTrial.description}</p>
                    </div>
                  )}
                </div>

                {/* Loading sites */}
                {sitesLoading && (
                  <div className="state-box">
                    <div className="spinner" />
                    <p className="state-msg">Loading site locations…</p>
                  </div>
                )}

                {sitesError && (
                  <div style={{ padding: "0 28px" }}>
                    <div className="error-box">
                      <span>Error</span>
                      <p>{sitesError}</p>
                    </div>
                  </div>
                )}

                {/* Map + Sites */}
                {siteData && !sitesLoading && (
                  <TrialSiteMap sites={siteData.sites} trialTitle={siteData.title} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}