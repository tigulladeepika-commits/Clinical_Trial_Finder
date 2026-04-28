"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SearchForm    from "@/components/trials/SearchForm";
import TrialList     from "@/components/trials/TrialList";
import TrialSiteMap  from "@/components/trials/TrialSiteMap";
import PhysicianPanel from "@/components/physicians/PhysicianPanel";

import { useTrials, fetchTrialSites } from "@/hooks/useTrials";
import { usePhysicians }              from "@/hooks/usePhysicians";
import { getConditionSpecialties }    from "@/lib/api";
import { initializeCityStateValidation } from "@/lib/validation";

import type { Trial, TrialSearchFilters, SiteData } from "@/types/trial";
import type { SelectedSite }                         from "@/types/physician";

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────
const HEADER_H  = 56;
const SEARCH_H  = 68;

// ─────────────────────────────────────────────────────────────────────────────
//  Inner component (needs useSearchParams, so it must be inside <Suspense>)
// ─────────────────────────────────────────────────────────────────────────────
function HomeInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const filtersFromUrl: TrialSearchFilters = {
    condition: searchParams.get("condition") ?? "",
    city:      searchParams.get("city")      ?? "",
    state:     searchParams.get("state")     ?? "",
    status:    searchParams.get("status")    ?? "",
    phase:     searchParams.get("phase")     ?? "",
  };
  const hasResults = Boolean(filtersFromUrl.condition.trim());

  // ── Local state ──────────────────────────────────────────────────────────
  const [selectedTrial, setSelectedTrial] = useState<Trial | null>(null);
  const [siteData,      setSiteData]      = useState<SiteData | null>(null);
  const [sitesLoading,  setSitesLoading]  = useState(false);
  const [sitesError,    setSitesError]    = useState<string | null>(null);
  const [selectedSite,  setSelectedSite]  = useState<SelectedSite | null>(null);
  const [initialSpecialties, setInitialSpecialties] = useState<string | null>(null); // Mapped specialties from condition
  
  // CRITICAL FIX for issue #5: Track AbortController for trial sites fetches
  // so quickly clicking different trials cancels the in-flight request.
  const sitesFetchAbortRef = useRef<AbortController | null>(null);

  const {
    physicians:  nearbyPhysicians,
    total:       physicianTotal,
    loading:     physiciansLoading,
    error:       physiciansError,
    searched:    physiciansSearched,
    hasMore:     physiciansHasMore,
    search:      searchPhysicians,
    loadMore:    loadMorePhysicians,
    reset:       resetPhysicians,
    searchSpecialties: physiciansSearchSpecialties,
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

  // CRITICAL FIX for issue #5: Cancel any in-flight sites fetch on unmount
  useEffect(() => {
    return () => {
      sitesFetchAbortRef.current?.abort();
    };
  }, []);

  // CRITICAL FIX: Initialize city/state validation data on mount
  // This loads the cities-by-state mapping from the backend (30-day cached)
  // and caches it locally for O(1) validation during trial searches
  useEffect(() => {
    initializeCityStateValidation();
  }, []);

  const {
    trials,
    loading,
    error,
    totalCount,
    hasMore,
    refetch,
    loadMore,
  } = useTrials(
    hasResults ? filtersFromUrl.condition : null,
    filtersFromUrl.city  || null,
    filtersFromUrl.state || null,
    filtersFromUrl.status  || undefined,
    filtersFromUrl.phase   || undefined,
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

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

    // Cancel any in-flight sites fetch before starting a new one
    sitesFetchAbortRef.current?.abort();
    const controller = new AbortController();
    sitesFetchAbortRef.current = controller;

    setSelectedTrial(trial);
    setSiteData(null);
    setSitesError(null);
    setSelectedSite(null);
    resetPhysicians();
    setSitesLoading(true);

    try {
      const data = await fetchTrialSites(trial.nctId, controller.signal);
      // Only set data if this request wasn't aborted
      if (!controller.signal.aborted) {
        setSiteData(data);
      }
    } catch (err) {
      // Ignore abort errors; only show real errors
      if (!controller.signal.aborted) {
        setSitesError("Could not load site locations. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setSitesLoading(false);
      }
    }
  }, [resetPhysicians, selectedTrial]);

  const handleFindPhysicians = useCallback(async (site: SelectedSite) => {
    setSelectedSite(site);
    resetPhysicians();
    
    // CRITICAL FIX: Fetch mapped specialties for the condition
    // e.g., "High Grade Sarcoma" → ["Medical Oncology", "Surgical Oncology"]
    let specialtyList: string[] = [];
    if (site.condition) {
      try {
        specialtyList = await getConditionSpecialties(site.condition);
      } catch (err) {
        console.warn("Could not fetch condition specialties:", err);
      }
    }
    
    // Combine mapped specialties into a comma-separated string for the API
    const mappedSpecialty = specialtyList.length > 0 ? specialtyList.join(", ") : undefined;
    setInitialSpecialties(mappedSpecialty || null);
    
    // Pass mapped specialties, defaulting to 25 mile radius
    searchPhysicians(site, 25, mappedSpecialty);
  }, [resetPhysicians, searchPhysicians]);

  // EDIT 1: Updated handlePhysicianSearch to accept and forward all four params
  const handlePhysicianSearch = useCallback(
    (
      radius:           number,
      specialty:        string,
      userSpecialty:    string,
      initialSpecialty: string,
    ) => {
      if (!selectedSite) return;
      searchPhysicians(
        selectedSite,
        radius,
        specialty        || undefined,
        userSpecialty    || undefined,
        initialSpecialty || undefined,
      );
    },
    [selectedSite, searchPhysicians],
  );

  const handleBackToSites = useCallback(() => {
    setSelectedSite(null);
    resetPhysicians();
  }, [resetPhysicians]);

  const searchFormKey = [
    filtersFromUrl.condition,
    filtersFromUrl.city,
    filtersFromUrl.state,
    filtersFromUrl.status,
    filtersFromUrl.phase,
  ].join("|");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .app-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          background: #f6f7fb;
        }

        /* ── Header ── */
        .site-header {
          height: ${HEADER_H}px;
          flex-shrink: 0;
          background: #fff;
          border-bottom: 1px solid #e4e8f0;
          z-index: 100;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .header-inner {
          max-width: 1800px;
          margin: 0 auto;
          padding: 0 24px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .logo-group { display: flex; align-items: center; gap: 10px; }
        .logo-mark {
          width: 32px; height: 32px;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'DM Mono', monospace;
          font-size: 11px; font-weight: 600; color: #fff;
          letter-spacing: -0.5px;
        }
        .logo-text {
          font-size: 15px; font-weight: 700; color: #0d1117;
          letter-spacing: -0.3px;
        }
        .logo-text span { color: #2563eb; }
        .header-tagline {
          font-size: 12px; color: #94a3b8;
          font-weight: 500; font-style: italic;
        }
        @media (max-width: 640px) { .header-tagline { display: none; } }

        /* ── Compact search bar (results view) ── */
        .search-card {
          height: ${SEARCH_H}px;
          flex-shrink: 0;
          background: #fff;
          border-bottom: 1px solid #e4e8f0;
          padding: 0 24px;
          display: flex;
          align-items: center;
        }

        /* ── Hero (landing) — full viewport, form centered and large ── */
        .hero-wrap {
          flex: 1;
          overflow-y: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #dbeafe;   /* light blue — matches the form's outer band */
        }


        /* ── Results layout ── */
        .results-layout {
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
          animation: fadeUp 0.28s ease both;
          overflow: hidden;
        }
        @media (max-width: 860px) {
          .results-layout {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
          }
          .trials-panel { max-height: 45vh; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .trials-panel {
          border-right: 1px solid #e4e8f0;
          overflow-y: auto;
          background: #fff;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .detail-panel {
          display: flex;
          flex-direction: column;
          background: #f6f7fb;
          min-width: 0;
          overflow: hidden;
        }

        /* ── Trial detail header ── */
        .trial-detail-header {
          padding: 14px 20px;
          border-bottom: 1px solid #e4e8f0;
          background: #fff;
          flex-shrink: 0;
        }
        .tdh-badges {
          display: flex; align-items: center; gap: 6px;
          margin-bottom: 6px; flex-wrap: wrap;
        }
        .tdh-nct {
          font-size: 10px; font-weight: 700; color: #2563eb;
          letter-spacing: 0.8px; text-transform: uppercase;
          font-family: 'DM Mono', monospace;
        }
        .tdh-title {
          font-size: 14px; font-weight: 600; color: #0d1117;
          line-height: 1.45; margin-bottom: 4px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tdh-sponsor { font-size: 11px; color: #8b95a1; }
        .tdh-sponsor strong { color: #4b5563; font-weight: 500; }

        /* ── KPI row ── */
        .kpi-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          border-bottom: 1px solid #e4e8f0;
          background: #fff;
          flex-shrink: 0;
        }
        .kpi-cell {
          padding: 12px 8px;
          text-align: center;
          border-right: 1px solid #e4e8f0;
        }
        .kpi-cell:last-child { border-right: none; }
        .kpi-num {
          font-size: 22px; font-weight: 700; color: #0d1117;
          line-height: 1; font-family: 'DM Mono', monospace;
        }
        .kpi-num.green { color: #16a34a; }
        .kpi-label {
          font-size: 9px; font-weight: 600; letter-spacing: 0.07em;
          text-transform: uppercase; color: #8b95a1; margin-top: 4px;
        }

        /* ── Map / content area ── */
        .detail-content {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }

        /* ── Badge ── */
        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 20px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.2px;
          text-transform: uppercase; white-space: nowrap;
        }
        .b-recruiting { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
        .b-active     { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .b-completed  { background: #f8fafc; color: #334155; border: 1px solid #e2e8f0; }
        .b-terminated { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .b-warning    { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
        .b-default    { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
        .b-phase      { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; font-family: 'DM Mono', monospace; }
        .b-na {
          background: #f1f5f9;
          color: #64748b;
          border: 1px solid #e2e8f0;
          font-size: 10px;
          font-weight: 500;
          padding: 2px 7px;
          border-radius: 20px;
          letter-spacing: 0.3px;
          white-space: nowrap;
          font-family: inherit;
        }

        /* ── States ── */
        .state-box {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 10px; padding: 48px 20px; color: #8b95a1;
        }
        .spinner {
          width: 26px; height: 26px;
          border: 2.5px solid #e4e8f0; border-top-color: #2563eb;
          border-radius: 50%; animation: spinAnim 0.7s linear infinite;
        }
        @keyframes spinAnim { to { transform: rotate(360deg); } }
        .state-msg { font-size: 13px; font-weight: 500; }

        .error-box {
          margin: 14px; padding: 12px 14px; border-radius: 10px;
          background: #fef2f2; border: 1px solid #fecaca;
          color: #dc2626; font-size: 13px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .err-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }

        .no-results {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 8px;
          padding: 56px 24px; text-align: center; color: #8b95a1;
        }
        .no-results h3 { font-size: 14px; font-weight: 600; color: #4b5563; margin-top: 4px; }
        .no-results p  { font-size: 12px; }

        .detail-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 14px;
          height: 100%; padding: 40px; text-align: center; color: #8b95a1;
        }
        .detail-empty-icon { font-size: 42px; opacity: 0.5; }
        .detail-empty p {
          font-size: 14px; font-weight: 500; color: #4b5563;
          max-width: 220px; line-height: 1.6;
        }

        .btn-primary {
          padding: 9px 20px; background: #2563eb; color: #fff;
          border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
          cursor: pointer; font-family: inherit; transition: background 0.15s;
        }
        .btn-primary:hover { background: #1d4ed8; }
      `}</style>

      <div className="app-shell">

        {/* ── Top header ── */}
        <header className="site-header">
          <div className="header-inner">
            <div className="logo-group">
              <div className="logo-mark">Ct</div>
              <div className="logo-text">Clinical<span>Trial</span> Navigator</div>
            </div>
            <div className="header-tagline">Find trials · Explore sites · Discover physicians</div>
          </div>
        </header>

        {/* ── Hero: just the form, full-width, no text or stats ── */}
        {!hasResults && (
          <div className="hero-wrap">
            <div className="hero-form-only">
              <SearchForm
                key="hero"
                onSearch={handleSearch}
                loading={loading}
                compact={false}
                initialValues={filtersFromUrl}
              />
            </div>
          </div>
        )}

        {/* ── Compact search bar (results active) ── */}
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

        {/* ── Results layout ── */}
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
                  <span className="err-label">Error loading trials</span>
                  <p>{error}</p>
                  <button className="btn-primary" onClick={refetch}>Try Again</button>
                </div>
              )}
              {!loading && !error && trials.length === 0 && (
                <div className="no-results">
                  <div style={{ fontSize: 32 }}>🔍</div>
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
                    <div className="tdh-badges">
                      <span className="tdh-nct">{selectedTrial.nctId}</span>

                      {selectedTrial.status && (() => {
                        const s = selectedTrial.status.toLowerCase();
                        let cls = "badge b-default";
                        if (s === "recruiting")                                      cls = "badge b-recruiting";
                        else if (s.includes("active"))                               cls = "badge b-active";
                        else if (s === "completed")                                  cls = "badge b-completed";
                        else if (s === "terminated")                                 cls = "badge b-terminated";
                        else if (s.includes("not yet") || s.includes("invitation")) cls = "badge b-warning";
                        return <span className={cls}>{selectedTrial.status}</span>;
                      })()}

                      {selectedTrial.phases?.map((p) =>
                        p === "N/A" || p === "NA"
                          ? <span key={p} className="b-na">Not applicable</span>
                          : <span key={p} className="badge b-phase">{p}</span>
                      )}
                    </div>

                    <div className="tdh-title">{selectedTrial.title}</div>

                    {selectedTrial.sponsor && (
                      <div className="tdh-sponsor">
                        Sponsor: <strong>{selectedTrial.sponsor}</strong>
                      </div>
                    )}
                  </div>

                  {siteData && !sitesLoading && (
                    <div className="kpi-row">
                      <div className="kpi-cell">
                        <div className="kpi-num">{siteData.sites.length}</div>
                        <div className="kpi-label">Total Sites</div>
                      </div>
                      <div className="kpi-cell">
                        <div className="kpi-num green">
                          {siteData.sites.filter(s => s.status?.toLowerCase() === "recruiting").length}
                        </div>
                        <div className="kpi-label">Recruiting</div>
                      </div>
                      <div className="kpi-cell">
                        <div className="kpi-num">
                          {siteData.sites.filter(s => s.lat != null && s.lon != null).length}
                        </div>
                        <div className="kpi-label">On Map</div>
                      </div>
                      <div className="kpi-cell">
                        <div className="kpi-num">
                          {new Set(siteData.sites.map(s => s.country).filter(Boolean)).size || 1}
                        </div>
                        <div className="kpi-label">Countries</div>
                      </div>
                    </div>
                  )}

                  <div className="detail-content">

                    {sitesLoading && (
                      <div className="state-box">
                        <div className="spinner" />
                        <p className="state-msg">Loading site locations…</p>
                      </div>
                    )}

                    {sitesError && !sitesLoading && (
                      <div className="error-box">
                        <span className="err-label">Error</span>
                        <p>{sitesError}</p>
                      </div>
                    )}

                    {siteData && !sitesLoading && selectedSite && (
                      /* EDIT 2: Added searchSpecialties prop */
                      <PhysicianPanel
                        site={selectedSite}
                        physicians={nearbyPhysicians}
                        total={physicianTotal}
                        loading={physiciansLoading}
                        error={physiciansError}
                        searched={physiciansSearched}
                        hasMore={physiciansHasMore}
                        searchSpecialties={physiciansSearchSpecialties}
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
                        description={selectedTrial.description ?? null}
                        condition={selectedTrial.conditions?.[0] ?? null}
                        inclusionCriteria={selectedTrial.inclusionCriteria}
                        exclusionCriteria={selectedTrial.exclusionCriteria}
                        onFindPhysicians={handleFindPhysicians}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Root page — wraps HomeInner in Suspense (required for useSearchParams)
// ─────────────────────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            height:         "100vh",
            flexDirection:  "column",
            gap:            12,
            fontFamily:     "'DM Sans', sans-serif",
            color:          "#94a3b8",
          }}
        >
          <div
            style={{
              width:           32,
              height:          32,
              border:          "3px solid #f1f5f9",
              borderTopColor:  "#2563eb",
              borderRadius:    "50%",
              animation:       "spinAnim 0.75s linear infinite",
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Loading…</span>
          <style>{`@keyframes spinAnim { to { transform: rotate(360deg); } }`}</style>
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}