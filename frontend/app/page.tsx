"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SearchForm     from "@/components/trials/SearchForm";
import TrialList      from "@/components/trials/TrialList";
import TrialSiteMap   from "@/components/trials/TrialSiteMap";
import PhysicianPanel from "@/components/physicians/PhysicianPanel";

import { useTrials, fetchTrialSites } from "@/hooks/useTrials";
import { usePhysicians }              from "@/hooks/usePhysicians";
import { getConditionSpecialties }    from "@/lib/api";
import { initializeCityStateValidation } from "@/lib/validation";

import type { Trial, TrialSearchFilters, SiteData } from "@/types/trial";
import type { SelectedSite }                         from "@/types/physician";

const HEADER_H = 56;
const SEARCH_H = 68;

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

  const [selectedTrial, setSelectedTrial] = useState<Trial | null>(null);
  const [siteData,      setSiteData]      = useState<SiteData | null>(null);
  const [sitesLoading,  setSitesLoading]  = useState(false);
  const [sitesError,    setSitesError]    = useState<string | null>(null);
  const [selectedSite,  setSelectedSite]  = useState<SelectedSite | null>(null);

  // Stores the resolved specialty strings from BOTH the user's search
  // condition AND the trial condition, kept for the lifetime of the
  // physician session so every re-search still OR-includes them.
  const pinnedTrialSpecialtyRef = useRef<string | undefined>(undefined);
  const pinnedUserSpecialtyRef  = useRef<string | undefined>(undefined);

  const sitesFetchAbortRef = useRef<AbortController | null>(null);

  const {
    physicians:        nearbyPhysicians,
    total:             physicianTotal,
    loading:           physiciansLoading,
    error:             physiciansError,
    searched:          physiciansSearched,
    hasMore:           physiciansHasMore,
    search:            searchPhysicians,
    loadMore:          loadMorePhysicians,
    reset:             resetPhysicians,
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
      pinnedTrialSpecialtyRef.current = undefined;
      pinnedUserSpecialtyRef.current  = undefined;
      prevConditionRef.current = filtersFromUrl.condition;
    }
  }, [filtersFromUrl.condition, resetPhysicians]);

  useEffect(() => {
    return () => { sitesFetchAbortRef.current?.abort(); };
  }, []);

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
    pinnedTrialSpecialtyRef.current = undefined;
    pinnedUserSpecialtyRef.current  = undefined;
  }, [resetPhysicians, router]);

  const handleSelectTrial = useCallback(async (trial: Trial) => {
    if (selectedTrial?.nctId === trial.nctId) {
      setSelectedTrial(null);
      setSiteData(null);
      setSelectedSite(null);
      resetPhysicians();
      pinnedTrialSpecialtyRef.current = undefined;
      pinnedUserSpecialtyRef.current  = undefined;
      return;
    }

    sitesFetchAbortRef.current?.abort();
    const controller = new AbortController();
    sitesFetchAbortRef.current = controller;

    setSelectedTrial(trial);
    setSiteData(null);
    setSitesError(null);
    setSelectedSite(null);
    resetPhysicians();
    pinnedTrialSpecialtyRef.current = undefined;
    pinnedUserSpecialtyRef.current  = undefined;
    setSitesLoading(true);

    try {
      const data = await fetchTrialSites(trial.nctId, controller.signal);
      if (!controller.signal.aborted) setSiteData(data);
    } catch (err) {
      if (!controller.signal.aborted)
        setSitesError("Could not load site locations. Please try again.");
    } finally {
      if (!controller.signal.aborted) setSitesLoading(false);
    }
  }, [resetPhysicians, selectedTrial]);

  // ── handleFindPhysicians ─────────────────────────────────────────────────
  //
  // Three OR conditions sent to backend independently:
  //
  //   specialty          → trial's own condition  (e.g. "Non-Small Cell Lung Carcinoma")
  //   initial_specialty  → user's search bar input (e.g. "Lung Cancer")  ← always pinned
  //   user_specialty     → extra specialty user types in the panel later
  //
  // Backend resolves each via resolve_with_broader() and unions the results.
  // A physician matching ANY ONE of the three makes it into the result set.
  //
  const handleFindPhysicians = useCallback(async (site: SelectedSite) => {
    setSelectedSite(site);
    resetPhysicians();
    pinnedTrialSpecialtyRef.current = undefined;
    pinnedUserSpecialtyRef.current  = undefined;

    const userSearchCondition = filtersFromUrl.condition.trim();
    const trialCondition      = site.condition?.trim() ?? "";

    // Resolve trial condition → NUCC specialties
    let trialSpecialty: string | undefined;
    if (trialCondition) {
      try {
        const list = await getConditionSpecialties(trialCondition);
        trialSpecialty = list.length > 0
          ? list.join(", ")
          : trialCondition;
      } catch {
        trialSpecialty = trialCondition;
      }
    }

    // Resolve user's search bar condition → NUCC specialties
    // Only fetch if it's actually different from the trial condition
    // (same condition would just duplicate results already covered above)
    let userSpecialty: string | undefined;
    if (
      userSearchCondition &&
      userSearchCondition.toLowerCase() !== trialCondition.toLowerCase()
    ) {
      try {
        const list = await getConditionSpecialties(userSearchCondition);
        userSpecialty = list.length > 0
          ? list.join(", ")
          : userSearchCondition;
      } catch {
        userSpecialty = userSearchCondition;
      }
    }

    // Pin both for the lifetime of this physician session.
    // Every subsequent re-search in the panel will include these.
    pinnedTrialSpecialtyRef.current = trialSpecialty;
    pinnedUserSpecialtyRef.current  = userSpecialty;

    // initial_specialty = whichever is more specific (prefer user's input
    // since it's what they actually typed; fall back to trial condition)
    const initialSpecialty = userSpecialty ?? trialSpecialty;

    // usePhysicians.search signature:
    //   search(site, radius, specialty, userSpecialty, initialSpecialty)
    //
    // specialty        → trial condition  (backend slot: specialty)
    // userSpecialty    → user search bar  (backend slot: user_specialty)
    // initialSpecialty → pinned anchor    (backend slot: initial_specialty)
    //
    // Backend OR-combines all three independently via _add_resolved().
    searchPhysicians(
      site,
      25,
      trialSpecialty,   // specialty        — trial condition
      userSpecialty,    // user_specialty   — user's search bar condition
      initialSpecialty, // initial_specialty — pinned; always OR-included
    );
  }, [resetPhysicians, searchPhysicians, filtersFromUrl.condition]);

  // ── handlePhysicianSearch ────────────────────────────────────────────────
  //
  // Called when user hits Search inside PhysicianPanel (changes radius or
  // types a new specialty in the panel input).
  //
  // The panel sends back:
  //   specialty        — trial condition (site.condition, unchanged)
  //   userSpecialty    — whatever the user typed in the panel input box
  //   initialSpecialty — the pinned value from the first search
  //
  // We ALWAYS re-inject the two pinned values from refs so they are
  // never lost when the user types a third specialty in the panel.
  // Result: backend receives up to THREE independent OR conditions:
  //   1. pinnedTrialSpecialtyRef  (trial condition, always)
  //   2. pinnedUserSpecialtyRef   (user search bar, always)
  //   3. panelUserSpecialty       (new panel input, when present)
  //
  const handlePhysicianSearch = useCallback(
    (
      radius:           number,
      _specialty:       string, // trial condition forwarded by panel — we use our ref instead
      panelUserSpecialty: string, // new specialty user typed in panel input
      _initialSpecialty:  string, // panel's pinned value — we use our ref instead
    ) => {
      if (!selectedSite) return;

      const trialSpecialty   = pinnedTrialSpecialtyRef.current;
      const userBarSpecialty = pinnedUserSpecialtyRef.current;

      // If the user typed something new in the panel AND it differs from
      // both pinned values, it becomes a genuine third OR condition.
      const panelInput = panelUserSpecialty.trim() || undefined;

      // initial_specialty = whichever anchor is most specific
      const initialSpecialty = userBarSpecialty ?? trialSpecialty;

      // When user typed in panel: pass as user_specialty so backend adds it
      // as a third OR bucket on top of the two pinned ones.
      // When panel input matches a pinned value: no-op, backend deduplicates.
      searchPhysicians(
        selectedSite,
        radius,
        trialSpecialty,   // specialty        — trial condition (always)
        panelInput,       // user_specialty   — panel input (3rd OR condition)
        initialSpecialty, // initial_specialty — pinned anchor (always)
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
        .search-card {
          height: ${SEARCH_H}px;
          flex-shrink: 0;
          background: #fff;
          border-bottom: 1px solid #e4e8f0;
          padding: 0 24px;
          display: flex;
          align-items: center;
        }
        .hero-wrap {
          flex: 1;
          overflow-y: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #dbeafe;
        }
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
        .detail-content {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
        }
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
          background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;
          font-size: 10px; font-weight: 500; padding: 2px 7px;
          border-radius: 20px; letter-spacing: 0.3px; white-space: nowrap;
          font-family: inherit;
        }
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

        <header className="site-header">
          <div className="header-inner">
            <div className="logo-group">
              <div className="logo-mark">Ct</div>
              <div className="logo-text">Clinical<span>Trial</span> Navigator</div>
            </div>
            <div className="header-tagline">Find trials · Explore sites · Discover physicians</div>
          </div>
        </header>

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

        {hasResults && (
          <div className="results-layout">

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
                        kpiBar={
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
                        }
                      />
                    )}

                    {siteData && !sitesLoading && !selectedSite && (
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

export default function Home() {
  return (
    <Suspense
      fallback={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100vh", flexDirection: "column", gap: 12,
          fontFamily: "'DM Sans', sans-serif", color: "#94a3b8",
        }}>
          <div style={{
            width: 32, height: 32,
            border: "3px solid #f1f5f9", borderTopColor: "#2563eb",
            borderRadius: "50%", animation: "spinAnim 0.75s linear infinite",
          }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>Loading…</span>
          <style>{`@keyframes spinAnim { to { transform: rotate(360deg); } }`}</style>
        </div>
      }
    >
      <HomeInner />
    </Suspense>
  );
}