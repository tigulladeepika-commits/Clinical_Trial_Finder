// app/page.tsx
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

import type { Trial, TrialSearchFilters, SiteData } from "@/types/trial";
import type { SelectedSite }                         from "@/types/physician";

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────
const HEADER_H  = 56;
const SEARCH_H  = 62;
const PANEL_TOP = HEADER_H + SEARCH_H;

// ─────────────────────────────────────────────────────────────────────────────
//  Inner component (needs useSearchParams, so it must be inside <Suspense>)
// ─────────────────────────────────────────────────────────────────────────────
function HomeInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // Derive filter values from URL params
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

  // ── Physicians hook ──────────────────────────────────────────────────────
  // FIX: hook exposes `search` not `searchPhysicians`
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
  } = usePhysicians();

  // ── Reset panel state when condition changes ─────────────────────────────
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

  // ── Trials hook ──────────────────────────────────────────────────────────
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
    // Toggle off if already selected
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

  // FIX: pass site.condition as specialty so backend can filter by trial condition
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

  // Key to force SearchForm to remount when URL filters change
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
          display: flex; flex-direction: column;
          height: 100vh; overflow: hidden;
          background: #f6f7fb;
        }

        /* ── Header ── */
        .site-header {
          height: ${HEADER_H}px; flex-shrink: 0;
          background: #fff; border-bottom: 1px solid #e4e8f0;
          z-index: 100; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .header-inner {
          max-width: 1800px; margin: 0 auto;
          padding: 0 24px; height: 100%;
          display: flex; align-items: center; justify-content: space-between;
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
        .header-tagline { font-size: 12px; color: #94a3b8; font-weight: 500; font-style: italic; }
        @media (max-width: 640px) { .header-tagline { display: none; } }

        /* ── Search card ── */
        .search-card {
          height: ${SEARCH_H}px; flex-shrink: 0;
          background: #fff; border-bottom: 1px solid #e4e8f0;
          padding: 13px 24px;
        }

        /* ── Hero ── */
        .hero-wrap { flex: 1; overflow-y: auto; }
        .hero-inner {
          max-width: 700px; margin: 0 auto;
          padding: 64px 24px 40px;
          display: flex; flex-direction: column; align-items: center; text-align: center;
        }
        .hero-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 12px;
          background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 20px;
          font-size: 11px; font-weight: 700; color: #2563eb;
          letter-spacing: 0.4px; text-transform: uppercase;
          margin-bottom: 20px;
        }
        .hero-title {
          font-size: 34px; font-weight: 700; color: #0d1117;
          letter-spacing: -1px; line-height: 1.18; margin-bottom: 14px;
        }
        .hero-title em { color: #2563eb; font-style: normal; }
        .hero-sub {
          font-size: 15px; color: #4b5563; line-height: 1.65;
          margin-bottom: 36px; max-width: 520px;
        }
        .hero-form-card {
          width: 100%; background: #fff;
          border: 1px solid #e4e8f0; border-radius: 14px;
          padding: 22px; box-shadow: 0 2px 12px rgba(0,0,0,0.07);
          text-align: left;
        }
        .hero-stats {
          display: flex; justify-content: center; gap: 32px; margin-top: 32px;
        }
        .hero-stat { text-align: center; }
        .hero-stat-num {
          font-size: 22px; font-weight: 700; color: #0d1117;
          font-family: 'DM Mono', monospace;
        }
        .hero-stat-lbl { font-size: 11px; color: #8b95a1; margin-top: 2px; }

        /* ── Results layout ── */
        .results-layout {
          flex: 1; min-height: 0;
          display: grid; grid-template-columns: 320px 1fr;
          animation: fadeUp 0.28s ease both;
        }
        @media (max-width: 860px) {
          .results-layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
          .trials-panel   { max-height: 45vh; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .trials-panel {
          border-right: 1px solid #e4e8f0;
          overflow-y: auto; background: #fff;
          display: flex; flex-direction: column;
        }
        .detail-panel {
          overflow-y: auto; background: #f6f7fb;
          display: flex; flex-direction: column;
        }

        /* ── Trial detail header ── */
        .trial-detail-header {
          padding: 16px 20px; border-bottom: 1px solid #e4e8f0;
          background: #fff; flex-shrink: 0;
        }
        .tdh-badges { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
        .tdh-nct {
          font-size: 10px; font-weight: 700; color: #2563eb;
          letter-spacing: 0.8px; text-transform: uppercase;
          font-family: 'DM Mono', monospace;
        }
        .tdh-title   { font-size: 14px; font-weight: 600; color: #0d1117; line-height: 1.45; margin-bottom: 4px; }
        .tdh-sponsor { font-size: 11px; color: #8b95a1; }
        .tdh-sponsor strong { color: #4b5563; font-weight: 500; }

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

        /* ── States ── */
        .state-box   { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 48px 20px; color: #8b95a1; }
        .spinner     { width: 26px; height: 26px; border: 2.5px solid #e4e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spinAnim 0.7s linear infinite; }
        @keyframes spinAnim { to { transform: rotate(360deg); } }
        .state-msg   { font-size: 13px; font-weight: 500; }

        .error-box   { margin: 14px; padding: 12px 14px; border-radius: 10px; background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; font-size: 13px; display: flex; flex-direction: column; gap: 8px; }
        .err-label   { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }

        .no-results  { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 56px 24px; text-align: center; color: #8b95a1; }
        .no-results h3 { font-size: 14px; font-weight: 600; color: #4b5563; margin-top: 4px; }
        .no-results p  { font-size: 12px; }

        .detail-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; height: 100%; min-height: 400px; padding: 40px; text-align: center; color: #8b95a1; }
        .detail-empty-icon { font-size: 42px; opacity: 0.5; }
        .detail-empty p { font-size: 14px; font-weight: 500; color: #4b5563; max-width: 220px; line-height: 1.6; }

        .btn-primary { padding: 9px 20px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s; }
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

        {/* ── Hero (no results yet) ── */}
        {!hasResults && (
          <div className="hero-wrap">
            <div className="hero-inner">
              <div className="hero-badge">🔬 Clinical Research Platform</div>
              <h1 className="hero-title">
                Find the right <em>clinical trial</em><br />for your patients
              </h1>
              <p className="hero-sub">
                Search active studies, explore trial sites across the country, and connect
                with nearby physicians — all in one place.
              </p>
              <div className="hero-form-card">
                <SearchForm
                  key="hero"
                  onSearch={handleSearch}
                  loading={loading}
                  compact={false}
                  initialValues={filtersFromUrl}
                />
              </div>
              <div className="hero-stats">
                <div className="hero-stat">
                  <div className="hero-stat-num">450K+</div>
                  <div className="hero-stat-lbl">Active Trials</div>
                </div>
                <div className="hero-stat">
                  <div className="hero-stat-num">180+</div>
                  <div className="hero-stat-lbl">Countries</div>
                </div>
                <div className="hero-stat">
                  <div className="hero-stat-num">2M+</div>
                  <div className="hero-stat-lbl">Sites Indexed</div>
                </div>
              </div>
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

              {/* Empty state */}
              {!selectedTrial && (
                <div className="detail-empty">
                  <div className="detail-empty-icon">🗺️</div>
                  <p>Select a trial from the list to view its site locations on the map</p>
                </div>
              )}

              {selectedTrial && (
                <>
                  {/* Trial detail header (always visible) */}
                  <div className="trial-detail-header">
                    <div className="tdh-badges">
                      <span className="tdh-nct">{selectedTrial.nctId}</span>
                      {selectedTrial.status && (() => {
                        const s = selectedTrial.status.toLowerCase();
                        let cls = "badge b-default";
                        if (s === "recruiting")          cls = "badge b-recruiting";
                        else if (s.includes("active"))   cls = "badge b-active";
                        else if (s === "completed")      cls = "badge b-completed";
                        else if (s === "terminated")     cls = "badge b-terminated";
                        else if (s.includes("not yet") || s.includes("invitation")) cls = "badge b-warning";
                        return <span className={cls}>{selectedTrial.status}</span>;
                      })()}
                      {selectedTrial.phases?.map((p) => (
                        <span key={p} className="badge b-phase">{p}</span>
                      ))}
                    </div>
                    <div className="tdh-title">{selectedTrial.title}</div>
                    {selectedTrial.sponsor && (
                      <div className="tdh-sponsor">
                        Sponsor: <strong>{selectedTrial.sponsor}</strong>
                      </div>
                    )}
                  </div>

                  {/* Sites loading */}
                  {sitesLoading && (
                    <div className="state-box">
                      <div className="spinner" />
                      <p className="state-msg">Loading site locations…</p>
                    </div>
                  )}

                  {/* Sites error */}
                  {sitesError && !sitesLoading && (
                    <div className="error-box">
                      <span className="err-label">Error</span>
                      <p>{sitesError}</p>
                    </div>
                  )}

                  {/* Physician panel (site selected) */}
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

                  {/* Site map (no site selected yet) */}
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