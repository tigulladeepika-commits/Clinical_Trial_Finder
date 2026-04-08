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

  // BUG FIX C: ref for the "Site Locations" section so we can scroll to it
  // after site data loads — otherwise the user has to manually scroll down.
  const mapSectionRef = useRef<HTMLElement>(null);

  const {
    trials,
    loading,
    error,
    totalCount,
    hasMore,
    refetch,
    loadMore,
    hasAnyFilter,
  } = useTrials(
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

  const handleSelectTrial = useCallback(
    async (trial: Trial) => {
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
    },
    [selectedTrial],
  );

  // BUG FIX C: scroll the map section into view once site data arrives.
  // We wait a tick (setTimeout 0) so the section has rendered before scrolling.
  useEffect(() => {
    if (!siteData && !sitesLoading) return;
    const timer = setTimeout(() => {
      mapSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [siteData, sitesLoading]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <div className="logo-group">
            <div className="logo-icon">[]</div>
            <div className="logo-text">
              Clinical<span>Trial</span>Locator
            </div>
          </div>
          <div className="header-tagline">
            Find trials | Explore sites | View on map
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="section">
          <div className="step-label">
            <span className="step-num">01</span> Search Trials
          </div>
          <SearchForm onSearch={handleSearch} loading={loading} />
        </section>

        {!hasAnyFilter && (
          <div className="hero">
            <div className="hero-graphic">
              <div className="hero-circle c1" />
              <div className="hero-circle c2" />
              <div className="hero-circle c3" />
              <div className="hero-icon">+</div>
            </div>
            <h2 className="hero-title">Locate Clinical Trials Nationwide</h2>
            <p className="hero-sub">
              Search by condition, filter by phase and status, select a trial,
              and explore all its site locations on an interactive site map.
            </p>
          </div>
        )}

        {loading && (
          <div className="state-box">
            <div className="spinner" />
            <p className="state-msg">Searching clinical trials...</p>
          </div>
        )}

        {!loading && error && (
          <div className="error-box">
            <span>Warning</span>
            <div>
              <p>{error}</p>
              <button className="btn-primary" onClick={refetch}>
                Try Again
              </button>
            </div>
          </div>
        )}

        {!loading && !error && hasAnyFilter && trials.length === 0 && (
          <div className="state-box">
            <span className="state-icon">?</span>
            <div className="state-title">No trials found</div>
            <div className="state-sub">Try broadening your search criteria.</div>
          </div>
        )}

        {!loading && !error && trials.length > 0 && (
          <section className="section">
            <div className="step-label">
              <span className="step-num">02</span> Select a Trial
              <span className="step-hint">
                Click a trial to view its site locations
              </span>
            </div>
            <TrialList
              trials={trials}
              totalCount={totalCount}
              selectedId={selectedTrial?.nctId ?? null}
              onSelect={handleSelectTrial}
              hasMore={hasMore}
              onLoadMore={loadMore}
              loading={loading}
            />
          </section>
        )}

        {selectedTrial && (
          <section className="section" id="site-map-section" ref={mapSectionRef}>
            <div className="step-label">
              <span className="step-num">03</span> Site Locations
              <span className="step-hint">{selectedTrial.nctId}</span>
            </div>

            <div className="selected-trial-banner">
              <div className="selected-trial-title">{selectedTrial.title}</div>
              {selectedTrial.sponsor && (
                <div className="selected-trial-sponsor">
                  Sponsor: {selectedTrial.sponsor}
                </div>
              )}
            </div>

            {sitesLoading && (
              <div className="state-box">
                <div className="spinner" />
                <p className="state-msg">Loading site locations...</p>
              </div>
            )}

            {sitesError && (
              <div className="error-box">
                <span>Warning</span>
                <p>{sitesError}</p>
              </div>
            )}

            {siteData && !sitesLoading && (
              <>
                <div className="sites-summary">
                  <span>
                    Sites: <strong>{siteData.sites.length}</strong>
                  </span>
                  <span>
                    Recruiting:{" "}
                    <strong>
                      {
                        siteData.sites.filter(
                          (site) => site.status === "RECRUITING",
                        ).length
                      }
                    </strong>
                  </span>
                  <span>
                    Mapped:{" "}
                    <strong>
                      {
                        siteData.sites.filter(
                          (site) => site.lat != null && site.lon != null,
                        ).length
                      }
                    </strong>
                  </span>
                </div>
                <TrialSiteMap
                  sites={siteData.sites}
                  trialTitle={siteData.title}
                />
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
