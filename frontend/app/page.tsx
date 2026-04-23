"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams }   from "next/navigation";
import SearchForm                        from "@/components/trials/SearchForm";
import TrialList                         from "@/components/trials/TrialList";
import TrialSiteMap                      from "@/components/trials/TrialSiteMap";
import PhysicianPanel                    from "@/components/physicians/PhysicianPanel";
import { useTrials, fetchTrialSites }    from "@/hooks/useTrials";
import { usePhysicians }                 from "@/hooks/usePhysicians";
import type { Trial, TrialSearchFilters, SiteData } from "@/types/trial";
import type { SelectedSite }             from "@/types/physician";

const HEADER_H   = 58;
const SEARCH_H   = 73;
const PANEL_TOP  = HEADER_H + SEARCH_H;

function HomeInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const filtersFromUrl: TrialSearchFilters = {
    condition: searchParams.get("condition") || "",
    city:      searchParams.get("city")      || "",
    state:     searchParams.get("state")     || "",
    status:    searchParams.get("status")    || "",
    phase:     searchParams.get("phase")     || "",
  };
  const hasResults = !!filtersFromUrl.condition;

  const [selectedTrial,  setSelectedTrial]  = useState<Trial | null>(null);
  const [siteData,       setSiteData]       = useState<SiteData | null>(null);
  const [sitesLoading,   setSitesLoading]   = useState(false);
  const [sitesError,     setSitesError]     = useState<string | null>(null);
  const [selectedSite,   setSelectedSite]   = useState<SelectedSite | null>(null);

  const {
    physicians: nearbyPhysicians,
    total:      physicianTotal,
    loading:    physiciansLoading,
    error:      physiciansError,
    searched:   physiciansSearched,
    hasMore:    physiciansHasMore,
    search:     searchPhysicians,
    loadMore:   loadMorePhysicians,
    reset:      resetPhysicians,
  } = usePhysicians();

  const prevConditionRef = useRef(filtersFromUrl.condition);
  useEffect(() => {
    if (prevConditionRef.current !== filtersFromUrl.condition) {
      setSelectedTrial(null);
      setSiteData(null);
      setSitesError(null);
      setSelectedSite(null);
      resetPhysicians();
      prevConditionRef.current = filtersFromUrl.condition;
    }
  }, [filtersFromUrl.condition, resetPhysicians]);

  const { trials, loading, error, totalCount, hasMore, refetch, loadMore } = useTrials(
    hasResults ? filtersFromUrl.condition : null,
    filtersFromUrl.city   || null,
    filtersFromUrl.state  || null,
    filtersFromUrl.status || undefined,
    filtersFromUrl.phase  || undefined,
  );

  const handleSearch = useCallback((nextFilters: TrialSearchFilters) => {
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
    setSelectedSite(null);
    resetPhysicians();
  }, [resetPhysicians, router]);

  const handleSelectTrial = useCallback(async (trial: Trial) => {
    if (selectedTrial?.nctId === trial.nctId) {
      setSelectedTrial(null);
      setSiteData(null);
      setSelectedSite(null);
      resetPhysicians();
      return;
    }
    setSelectedTrial(trial);
    setSiteData(null);
    setSitesError(null);
    setSelectedSite(null);
    resetPhysicians();
    setSitesLoading(true);
    try {
      const data = await fetchTrialSites(trial.nctId);
      setSiteData(data);
    } catch {
      setSitesError("Could not load site locations. Please try again.");
    } finally {
      setSitesLoading(false);
    }
  }, [resetPhysicians, selectedTrial]);

  // ── FIX: pass site.condition as the specialty so the backend filters
  //         physicians by the trial's condition from the very first search.
  const handleFindPhysicians = useCallback((site: SelectedSite) => {
    setSelectedSite(site);
    resetPhysicians();
    searchPhysicians(site, 25, site.condition ?? undefined);
  }, [resetPhysicians, searchPhysicians]);

  const handlePhysicianSearch = useCallback((radius: number, specialty: string) => {
    if (!selectedSite) return;
    searchPhysicians(selectedSite, radius, specialty || undefined);
  }, [searchPhysicians, selectedSite]);

  const handleBackToSites = useCallback(() => {
    setSelectedSite(null);
    resetPhysicians();
  }, [resetPhysicians]);

  const searchFormKey = [
    filtersFromUrl.condition, filtersFromUrl.city, filtersFromUrl.state,
    filtersFromUrl.status, filtersFromUrl.phase,
  ].join("|");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,600&family=Sora:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --header-h:   ${HEADER_H}px;
          --search-h:   ${SEARCH_H}px;
          --panel-top:  ${PANEL_TOP}px;

          --white:      #ffffff;
          --gray-50:    #f8fafc;
          --gray-100:   #f1f5f9;
          --gray-200:   #e2e8f0;
          --gray-300:   #cbd5e1;
          --gray-400:   #94a3b8;
          --gray-500:   #64748b;
          --gray-600:   #475569;
          --gray-700:   #334155;
          --gray-800:   #1e293b;
          --gray-900:   #0f172a;
          --blue-50:    #eff6ff;
          --blue-100:   #dbeafe;
          --blue-200:   #bfdbfe;
          --blue-500:   #3b82f6;
          --blue-600:   #2563eb;
          --blue-700:   #1d4ed8;
          --green-500:  #22c55e;
          --green-600:  #16a34a;
        }

        html, body { height: 100%; font-family: 'Sora', sans-serif; }

        @keyframes appFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spinnerAnim { to { transform: rotate(360deg); } }

        .app-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          background: var(--gray-50);
        }

        .site-header {
          height: var(--header-h);
          flex-shrink: 0;
          background: #fff;
          border-bottom: 1px solid var(--gray-100);
          z-index: 100;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .header-inner {
          max-width: 1600px;
          margin: 0 auto;
          padding: 0 28px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .logo-group { display: flex; align-items: center; gap: 10px; }
        .logo-icon {
          width: 34px; height: 34px;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px; font-weight: 700; color: #fff;
          letter-spacing: -0.5px;
          box-shadow: 0 2px 8px rgba(37,99,235,0.28);
        }
        .logo-text {
          font-family: 'Sora', sans-serif;
          font-size: 15px; font-weight: 700;
          color: var(--gray-900); letter-spacing: -0.3px;
        }
        .logo-text span { color: var(--blue-600); }
        .header-tagline {
          font-size: 12px; color: var(--gray-400);
          font-weight: 500; font-style: italic;
        }
        @media (max-width: 640px) { .header-tagline { display: none; } }

        .search-card {
          height: var(--search-h);
          flex-shrink: 0;
          background: #fff;
          border-bottom: 1px solid var(--gray-100);
          padding: 16px 28px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.03);
          overflow: hidden;
        }

        .results-layout {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 300px 1fr;
          animation: appFadeIn 0.3s ease both;
        }
        @media (max-width: 900px) {
          .results-layout {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
          }
        }

        .trials-panel {
          border-right: 1px solid var(--gray-100);
          overflow-y: auto;
          background: #fff;
          display: flex;
          flex-direction: column;
        }
        @media (max-width: 900px) { .trials-panel { max-height: 50vh; } }

        .detail-panel {
          overflow-y: auto;
          background: var(--gray-50);
          display: flex;
          flex-direction: column;
        }

        .state-box {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 12px; padding: 48px 20px; color: var(--gray-400);
        }
        .spinner {
          width: 28px; height: 28px;
          border: 3px solid var(--gray-100);
          border-top-color: var(--blue-500);
          border-radius: 50%;
          animation: spinnerAnim 0.75s linear infinite;
        }
        .state-msg { font-size: 14px; color: var(--gray-400); font-weight: 500; }

        .error-box {
          margin: 16px; padding: 14px 16px;
          border-radius: 10px;
          background: #fef2f2; border: 1px solid #fecaca;
          color: #dc2626; font-size: 13px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .error-box span {
          font-weight: 700; font-size: 11px;
          text-transform: uppercase; letter-spacing: 0.8px;
        }

        .no-results {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 8px; padding: 56px 24px;
          text-align: center; color: var(--gray-400);
        }
        .no-results-icon { font-size: 36px; }
        .no-results h3 { font-size: 15px; font-weight: 700; color: var(--gray-600); }
        .no-results p  { font-size: 13px; }

        .btn-primary {
          padding: 9px 20px;
          background: var(--blue-600); color: #fff;
          border: none; border-radius: 8px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          font-family: 'Sora', sans-serif; transition: all 0.15s;
        }
        .btn-primary:hover { background: var(--blue-700); }

        .detail-empty {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 14px; height: 100%; min-height: 400px;
          padding: 40px; text-align: center; color: var(--gray-400);
        }
        .detail-empty-icon { font-size: 44px; opacity: 0.6; }
        .detail-empty p {
          font-size: 14px; font-weight: 500;
          color: var(--gray-500); max-width: 240px; line-height: 1.6;
        }

        .trial-detail-header {
          padding: 18px 24px;
          border-bottom: 1px solid var(--gray-100);
          background: #fff; flex-shrink: 0;
        }
        .trial-detail-badges {
          display: flex; align-items: center;
          gap: 6px; margin-bottom: 7px; flex-wrap: wrap;
        }
        .trial-detail-nct {
          font-size: 10px; font-weight: 700;
          color: var(--blue-600); letter-spacing: 0.8px;
          text-transform: uppercase;
          font-family: 'IBM Plex Mono', monospace;
        }
        .trial-detail-title {
          font-size: 14px; font-weight: 700;
          color: var(--gray-900); line-height: 1.45; margin-bottom: 5px;
        }
        .trial-detail-sponsor { font-size: 11px; color: var(--gray-400); }
        .trial-detail-sponsor strong { color: var(--gray-600); font-weight: 600; }

        .badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 2px 9px; border-radius: 20px;
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.3px; text-transform: uppercase; white-space: nowrap;
        }
        .badge-status-recruiting { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
        .badge-status-active     { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .badge-status-default    { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }
        .badge-status-completed  { background: #f8fafc; color: #334155; border: 1px solid #e2e8f0; }
        .badge-status-terminated { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .badge-status-warning    { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
        .badge-status-soon       { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
        .badge-phase             { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      <div className="app-shell">

        {/* Header */}
        <header className="site-header">
          <div className="header-inner">
            <div className="logo-group">
              <div className="logo-icon">Ct</div>
              <div className="logo-text">Clinical<span>Trial</span>Navigator</div>
            </div>
            <div className="header-tagline">Find trials · Explore sites · Discover physicians</div>
          </div>
        </header>

        {/* Hero search */}
        {!hasResults && (
          <div style={{ overflowY: "auto", flex: 1 }}>
            <SearchForm
              key="hero"
              onSearch={handleSearch}
              loading={loading}
              compact={false}
              initialValues={filtersFromUrl}
            />
          </div>
        )}

        {/* Compact search bar */}
        {hasResults && (
          <div className="search-card">
            <SearchForm
              key={searchFormKey}
              onSearch={handleSearch}
              loading={loading}
              compact={true}
              initialValues={filtersFromUrl}
            />
          </div>
        )}

        {/* Results layout */}
        {hasResults && (
          <div className="results-layout">

            {/* LEFT: Trial list */}
            <div className="trials-panel">
              {loading && (
                <div className="state-box">
                  <div className="spinner" />
                  <p className="state-msg">Searching trials…</p>
                </div>
              )}
              {!loading && error && (
                <div className="error-box">
                  <span>Error loading trials</span>
                  <p>{error}</p>
                  <button className="btn-primary" onClick={refetch}>Try Again</button>
                </div>
              )}
              {!loading && !error && trials.length === 0 && (
                <div className="no-results">
                  <div className="no-results-icon">🔍</div>
                  <h3>No trials found</h3>
                  <p>Try broadening your search criteria or removing filters.</p>
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

            {/* RIGHT: Detail panel */}
            <div className="detail-panel">

              {!selectedTrial && (
                <div className="detail-empty">
                  <div className="detail-empty-icon">🗺️</div>
                  <p>Select a trial from the list to view its site locations on the map</p>
                </div>
              )}

              {selectedTrial && (
                <>
                  <div className="trial-detail-header">
                    <div className="trial-detail-badges">
                      <span className="trial-detail-nct">{selectedTrial.nctId}</span>
                      {selectedTrial.status && (() => {
                        const s = (selectedTrial.status || "").toLowerCase();
                        let cls = "badge badge-status-default";
                        if (s === "recruiting")       cls = "badge badge-status-recruiting";
                        else if (s.includes("active")) cls = "badge badge-status-active";
                        else if (s === "completed")   cls = "badge badge-status-completed";
                        else if (s === "terminated")  cls = "badge badge-status-terminated";
                        return <span className={cls}>{selectedTrial.status}</span>;
                      })()}
                      {selectedTrial.phases?.map((p) => (
                        <span key={p} className="badge badge-phase">{p}</span>
                      ))}
                    </div>
                    <div className="trial-detail-title">{selectedTrial.title}</div>
                    {selectedTrial.sponsor && (
                      <div className="trial-detail-sponsor">
                        Sponsor: <strong>{selectedTrial.sponsor}</strong>
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
                    <div className="error-box">
                      <span>Error</span>
                      <p>{sitesError}</p>
                    </div>
                  )}

                  {siteData && !sitesLoading && selectedSite && (
                    <PhysicianPanel
                      site={selectedSite}
                      physicians={nearbyPhysicians}
                      total={physicianTotal}
                      loading={physiciansLoading}
                      error={physiciansError}
                      searched={physiciansSearched}
                      hasMore={physiciansHasMore}
                      onSearch={handlePhysicianSearch}
                      onLoadMore={loadMorePhysicians}
                      onBack={handleBackToSites}
                    />
                  )}

                  {siteData && !sitesLoading && !selectedSite && (
                    <TrialSiteMap
                      sites={siteData.sites}
                      trialTitle={siteData.title}
                      nctId={selectedTrial.nctId}
                      description={selectedTrial.description || null}
                      condition={selectedTrial.conditions?.[0] ?? null}
                      onFindPhysicians={handleFindPhysicians}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 12,
        fontFamily: "'Sora', sans-serif", color: "#94a3b8",
      }}>
        <div style={{
          width: 32, height: 32,
          border: "3px solid #f1f5f9",
          borderTopColor: "#2563eb",
          borderRadius: "50%",
          animation: "spinnerAnim 0.75s linear infinite",
        }} />
        <span style={{ fontSize: 14, fontWeight: 500 }}>Loading…</span>
      </div>
    }>
      <HomeInner />
    </Suspense>
  );
}