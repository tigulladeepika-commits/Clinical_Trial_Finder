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

function HomeInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // ── URL → filters (single source of truth) ────────────────────────────────
  const filtersFromUrl: TrialSearchFilters = {
    condition: searchParams.get("condition") || "",
    city:      searchParams.get("city")      || "",
    state:     searchParams.get("state")     || "",
    status:    searchParams.get("status")    || "",
    phase:     searchParams.get("phase")     || "",
  };
  const hasResults = !!filtersFromUrl.condition;

  // ── Trial selection state ─────────────────────────────────────────────────
  const [selectedTrial,  setSelectedTrial]  = useState<Trial | null>(null);
  const [siteData,       setSiteData]       = useState<SiteData | null>(null);
  const [sitesLoading,   setSitesLoading]   = useState(false);
  const [sitesError,     setSitesError]     = useState<string | null>(null);

  // ── Physician panel state ─────────────────────────────────────────────────
  const [selectedSite, setSelectedSite] = useState<SelectedSite | null>(null);
  const physicians = usePhysicians();

  // Reset trial + physician state when search condition changes
  const prevConditionRef = useRef(filtersFromUrl.condition);
  useEffect(() => {
    if (prevConditionRef.current !== filtersFromUrl.condition) {
      setSelectedTrial(null);
      setSiteData(null);
      setSitesError(null);
      setSelectedSite(null);
      physicians.reset();
      prevConditionRef.current = filtersFromUrl.condition;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersFromUrl.condition]);

  const { trials, loading, error, totalCount, hasMore, refetch, loadMore } = useTrials(
    hasResults ? filtersFromUrl.condition : null,
    filtersFromUrl.city   || null,
    filtersFromUrl.state  || null,
    filtersFromUrl.status || undefined,
    filtersFromUrl.phase  || undefined,
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
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
    physicians.reset();
  }, [router, physicians]);

  const handleSelectTrial = useCallback(async (trial: Trial) => {
    // Toggle off
    if (selectedTrial?.nctId === trial.nctId) {
      setSelectedTrial(null);
      setSiteData(null);
      setSelectedSite(null);
      physicians.reset();
      return;
    }
    setSelectedTrial(trial);
    setSiteData(null);
    setSitesError(null);
    setSelectedSite(null);
    physicians.reset();
    setSitesLoading(true);
    try {
      const data = await fetchTrialSites(trial.nctId);
      setSiteData(data);
    } catch {
      setSitesError("Could not load site locations. Please try again.");
    } finally {
      setSitesLoading(false);
    }
  }, [selectedTrial, physicians]);

  // Called from TrialSiteMap when user clicks "Find physicians near this site"
  const handleFindPhysicians = useCallback((site: SelectedSite) => {
    setSelectedSite(site);
    physicians.reset();
    // Trigger initial search with default radius 25, no specialty filter
    physicians.search(site, 25);
  }, [physicians]);

  // Called from PhysicianPanel when user changes radius/specialty
  const handlePhysicianSearch = useCallback((radius: number, specialty: string) => {
    if (!selectedSite) return;
    physicians.search(selectedSite, radius, specialty || undefined);
  }, [selectedSite, physicians]);

  // Called from PhysicianPanel "← back" button
  const handleBackToSites = useCallback(() => {
    setSelectedSite(null);
    physicians.reset();
  }, [physicians]);

  const searchFormKey = [
    filtersFromUrl.condition,
    filtersFromUrl.city,
    filtersFromUrl.state,
    filtersFromUrl.status,
    filtersFromUrl.phase,
  ].join("|");

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`app-shell${hasResults ? " has-results" : ""}`}>

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
        <SearchForm
          key="hero"
          onSearch={handleSearch}
          loading={loading}
          compact={false}
          initialValues={filtersFromUrl}
        />
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

          {/* RIGHT: Detail panel */}
          <div className="detail-panel">

            {/* Empty state */}
            {!selectedTrial && (
              <div className="detail-empty">
                <div className="detail-empty-icon">🗺️</div>
                <p>Select a trial to view site locations</p>
              </div>
            )}

            {/* Trial selected — show header + either site map or physician panel */}
            {selectedTrial && (
              <>
                {/* Trial header (always visible) */}
                <div style={{
                  padding: "16px 28px",
                  borderBottom: "1px solid var(--gray-100)",
                  background: "var(--white)",
                  flexShrink: 0,
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
                      Sponsor:{" "}
                      <span style={{ color: "var(--gray-600)", fontWeight: 500 }}>
                        {selectedTrial.sponsor}
                      </span>
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
                {sitesError && (
                  <div style={{ padding: "16px 28px 0" }}>
                    <div className="error-box">
                      <span>Error</span>
                      <p>{sitesError}</p>
                    </div>
                  </div>
                )}

                {/* ── Physician panel (when a site is selected) ── */}
                {siteData && !sitesLoading && selectedSite && (
                  <PhysicianPanel
                    site={selectedSite}
                    physicians={physicians.physicians}
                    total={physicians.total}
                    loading={physicians.loading}
                    error={physicians.error}
                    searched={physicians.searched}
                    onSearch={handlePhysicianSearch}
                    onBack={handleBackToSites}
                  />
                )}

                {/* ── Trial site map (default right-panel view) ── */}
                {siteData && !sitesLoading && !selectedSite && (
                  <TrialSiteMap
                    sites={siteData.sites}
                    trialTitle={siteData.title}
                    nctId={selectedTrial.nctId}
                    description={selectedTrial.description || null}
                    onFindPhysicians={handleFindPhysicians}
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