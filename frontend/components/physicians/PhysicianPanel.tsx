// components/physicians/PhysicianPanel.tsx
// v2 changes:
//  - Main physician list is now driven by user's search criteria only (10 max).
//    The trial condition is passed but backend now uses it only as fallback.
//  - Added "Suggested Physicians" section below the main list (5 max).
//    Suggested are fetched from /suggested using the trial condition and
//    exclude the NPIs already shown in the main list.
//  - Both lists have independent Load More buttons that each open a
//    LeadCaptureModal — filling the modal triggers the respective loadMore.
//  - PhysicianMap now receives both physician lists and plots them in
//    different colours (blue = main, teal = suggested).
//  - useSuggestedPhysicians is called after every main search completes.

"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import PhysicianCard           from "@/components/physicians/PhysicianCard";
import PhysicianDetailPanel    from "@/components/physicians/PhysicianDetailPanel";
import PhysicianMap            from "@/components/physicians/PhysicianMap";
import LeadCaptureModal        from "@/components/shared/LeadCaptureModal";
import { useSuggestedPhysicians } from "@/hooks/usePhysicians";
import type { Physician, SelectedSite } from "@/types/physician";

interface Props {
  site:              SelectedSite;
  kpiBar?:           React.ReactNode;
  physicians:        Physician[];
  total:             number;
  loading:           boolean;
  error:             string | null;
  searched:          boolean;
  hasMore:           boolean;
  searchSpecialties: string[];
  onSearch: (
    radius:           number,
    specialty:        string,
    userSpecialty:    string,
    initialSpecialty: string,
  ) => void;
  onLoadMore: () => void;
  onBack:     () => void;
}

const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

export default function PhysicianPanel({
  site,
  physicians,
  total,
  loading,
  error,
  searched,
  hasMore,
  searchSpecialties,
  kpiBar,
  onSearch,
  onLoadMore,
  onBack,
}: Props) {
  const [radius,                 setRadius]                 = useState<number>(25);
  const [specialty,              setSpecialty]              = useState(site.condition ?? "");
  const [selectedNpi,            setSelectedNpi]            = useState<string | null>(null);
  const [detailPhys,             setDetailPhys]             = useState<Physician | null>(null);
  const [showMainLoadMoreModal,  setShowMainLoadMoreModal]  = useState(false);
  const [showSuggestLoadMoreModal, setShowSuggestLoadMoreModal] = useState(false);

  const initialSpecialtyRef = useRef<string>("");

  // ── Suggested physicians hook ─────────────────────────────────────────────
  const suggested = useSuggestedPhysicians();

  // Re-fetch suggested whenever the main list changes (new search completed)
  useEffect(() => {
    if (!searched || loading || physicians.length === 0) return;
    const mainNpis = physicians.map((p) => p.npi);
    suggested.fetch(site, radius, site.condition ?? undefined, mainNpis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, loading, physicians]);

  const handleSearch = useCallback(() => {
    if (!initialSpecialtyRef.current) {
      initialSpecialtyRef.current = specialty.trim();
    }
    const trialCondition = site.condition?.trim() ?? "";
    const currentInput   = specialty.trim();
    const userSpecialty  = currentInput.toLowerCase() !== trialCondition.toLowerCase()
      ? currentInput
      : "";
    onSearch(radius, trialCondition, userSpecialty, initialSpecialtyRef.current);
  }, [radius, specialty, site.condition, onSearch]);

  // ── Physician detail view ────────────────────────────────────────────────
  if (detailPhys) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {kpiBar}
        <PhysicianDetailPanel
          physician={detailPhys}
          site={site}
          onBack={() => setDetailPhys(null)}
          onAddAsLead={() => { /* detail panel handles submission internally */ }}
        />
      </div>
    );
  }

  // All physicians for map (main = blue, suggested = teal)
  const allForMap = physicians;
  const suggestedForMap = suggested.physicians;

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .pp-shell {
          display: flex; flex-direction: column; height: 100%;
          overflow: hidden; font-family: 'DM Sans', system-ui, sans-serif;
        }
        .pp-toolbar {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 12px; background: #fff;
          border-bottom: 1px solid #e4e8f0; flex-shrink: 0; flex-wrap: wrap;
        }
        .pp-back-btn {
          display: flex; align-items: center; justify-content: center;
          height: 30px; width: 30px; background: transparent;
          border: 1px solid #e4e8f0; border-radius: 7px;
          cursor: pointer; font-size: 14px; color: #4b5563;
          flex-shrink: 0; transition: all 0.15s;
        }
        .pp-back-btn:hover { background: #f1f5f9; border-color: #cbd5e1; color: #0d1117; }
        .pp-site-label { flex: 1; min-width: 0; }
        .pp-site-name {
          font-size: 12px; font-weight: 700; color: #0d1117;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pp-site-sub { font-size: 10px; color: #94a3b8; font-weight: 500; }
        .pp-specialty-input {
          flex: 2 1 130px; height: 30px; padding: 0 10px;
          border: 1px solid #e4e8f0; border-radius: 7px;
          font-size: 11px; color: #0d1117; background: #f8fafc;
          outline: none; font-family: inherit; min-width: 0; transition: border-color 0.15s;
        }
        .pp-specialty-input:focus { border-color: #2563eb; background: #fff; }
        .pp-radius-select {
          flex: 0 0 90px; height: 30px; padding: 0 6px;
          border: 1px solid #e4e8f0; border-radius: 7px;
          font-size: 11px; color: #0d1117; background: #f8fafc;
          outline: none; cursor: pointer; font-family: inherit;
        }
        .pp-search-btn {
          height: 30px; padding: 0 13px; background: #2563eb; color: #fff;
          border: none; border-radius: 7px; font-size: 11px; font-weight: 700;
          cursor: pointer; font-family: inherit; flex-shrink: 0; transition: background 0.15s;
        }
        .pp-search-btn:hover:not(:disabled) { background: #1d4ed8; }
        .pp-search-btn:disabled { background: #cbd5e1; cursor: not-allowed; }
        .pp-chips-row {
          display: flex; align-items: center; gap: 5px;
          padding: 4px 12px; background: #f0f9ff;
          border-bottom: 1px solid #bae6fd; flex-shrink: 0; flex-wrap: wrap;
        }
        .pp-chips-label {
          font-size: 10px; font-weight: 700; color: #0369a1;
          letter-spacing: 0.5px; text-transform: uppercase; flex-shrink: 0;
        }
        .pp-chip {
          display: inline-flex; align-items: center; background: #0284c7;
          color: #fff; border-radius: 20px; padding: 2px 9px;
          font-size: 10px; font-weight: 600;
        }
        .pp-map-wrap {
          flex: 0 0 auto; height: 300px;
          position: relative; overflow: hidden; background: #e2e8f0;
        }
        .pp-map-empty {
          display: flex; align-items: center; justify-content: center;
          height: 100%; font-size: 12px; color: #94a3b8;
          font-weight: 500; flex-direction: column; gap: 8px;
        }
        /* ── Main list section ── */
        .pp-list-section {
          flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
        }
        .pp-count-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 12px 4px; flex-shrink: 0;
          border-bottom: 1px solid #f1f5f9; background: #fff;
        }
        .pp-count-bar { font-size: 11px; color: #64748b; font-weight: 600; }
        .pp-count-bar strong { color: #0d1117; }
        .pp-list {
          flex: 1; overflow-y: auto; padding: 8px 12px 12px;
          display: flex; flex-direction: column; gap: 7px;
        }
        /* ── Suggested section ── */
        .pp-suggested-section {
          flex-shrink: 0;
          border-top: 2px solid #ccfbf1;
          background: #f0fdfa;
        }
        .pp-suggested-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px 6px;
          border-bottom: 1px solid #99f6e4;
        }
        .pp-suggested-title {
          display: flex; align-items: center; gap: 7px;
        }
        .pp-suggested-title-text {
          font-size: 12px; font-weight: 700; color: #0f766e;
        }
        .pp-suggested-badge {
          background: #14b8a6; color: #fff; font-size: 9px;
          font-weight: 700; padding: 2px 7px; border-radius: 20px;
          letter-spacing: 0.5px; text-transform: uppercase;
        }
        .pp-suggested-sub {
          font-size: 10px; color: #0d9488; margin-top: 1px;
        }
        .pp-suggested-list {
          padding: 6px 12px 10px;
          display: flex; flex-direction: column; gap: 6px;
          max-height: 360px; overflow-y: auto;
        }
        /* ── Load more buttons ── */
        .pp-load-more-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border: none; border-radius: 7px;
          font-size: 11px; font-weight: 700;
          cursor: pointer; font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
          white-space: nowrap; flex-shrink: 0;
        }
        .pp-load-more-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .pp-load-more-main {
          background: #2563eb; color: #fff;
        }
        .pp-load-more-main:hover:not(:disabled) { background: #1d4ed8; }
        .pp-load-more-suggested {
          background: #14b8a6; color: #fff;
        }
        .pp-load-more-suggested:hover:not(:disabled) { background: #0d9488; }
        .pp-load-more-bottom-wrap {
          margin-top: 4px; padding: 10px 2px 4px;
          border-top: 1px solid #e4e8f0;
          display: flex; flex-direction: column; align-items: center; gap: 6px;
        }
        .pp-load-more-bottom {
          width: 100%; padding: 11px 0; background: #fff;
          border-radius: 10px; font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: inherit; letter-spacing: 0.2px;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
          display: flex; align-items: center; justify-content: center; gap: 7px;
        }
        .pp-load-more-bottom-main {
          color: #2563eb; border: 1.5px dashed #93c5fd;
        }
        .pp-load-more-bottom-main:hover:not(:disabled) {
          background: #eff6ff; border-color: #2563eb; color: #1d4ed8;
        }
        .pp-load-more-bottom-suggested {
          color: #0d9488; border: 1.5px dashed #5eead4;
        }
        .pp-load-more-bottom-suggested:hover:not(:disabled) {
          background: #f0fdfa; border-color: #14b8a6; color: #0f766e;
        }
        .pp-load-more-bottom:disabled { opacity: 0.5; cursor: not-allowed; }
        .pp-load-more-bottom-sub { font-size: 10px; color: #94a3b8; font-weight: 500; }
        /* ── States ── */
        .pp-center {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 10px; padding: 36px 20px;
          color: #94a3b8; text-align: center;
        }
        .pp-spinner {
          width: 24px; height: 24px; border: 2.5px solid #e4e8f0;
          border-top-color: #2563eb; border-radius: 50%;
          animation: ppSpin 0.7s linear infinite;
        }
        .pp-spinner-teal {
          width: 18px; height: 18px; border: 2px solid #ccfbf1;
          border-top-color: #14b8a6; border-radius: 50%;
          animation: ppSpin 0.7s linear infinite;
        }
        @keyframes ppSpin { to { transform: rotate(360deg); } }
        .pp-state-msg { font-size: 13px; font-weight: 500; }
        .pp-empty-icon { font-size: 30px; opacity: 0.5; }
        .pp-empty-title { font-size: 13px; font-weight: 600; color: #4b5563; }
        .pp-empty-sub { font-size: 11px; }
        .pp-error {
          margin: 4px 0; padding: 10px 12px; border-radius: 9px;
          background: #fef2f2; border: 1px solid #fecaca;
          color: #dc2626; font-size: 12px;
        }
        .pp-error-label {
          font-size: 9px; font-weight: 800; text-transform: uppercase;
          letter-spacing: 0.8px; margin-bottom: 3px;
        }
        /* ── Suggested physician card variant (teal accent) ── */
        .pp-suggested-card {
          background: #fff; border: 1px solid #99f6e4; border-radius: 10px;
          padding: 10px 12px; cursor: pointer;
          transition: box-shadow 0.15s, border-color 0.15s; outline: none;
          position: relative;
        }
        .pp-suggested-card:hover {
          box-shadow: 0 2px 8px rgba(20,184,166,0.15); border-color: #14b8a6;
        }
        .pp-suggested-tag {
          position: absolute; top: 8px; right: 10px;
          background: #f0fdfa; border: 1px solid #99f6e4;
          color: #0d9488; font-size: 9px; font-weight: 700;
          padding: 1px 6px; border-radius: 10px; letter-spacing: 0.4px;
        }
      `}</style>

      <div className="pp-shell">
        {kpiBar}

        {/* ── Toolbar ── */}
        <div className="pp-toolbar">
          <button className="pp-back-btn" onClick={onBack} title="Back to sites">←</button>
          <div className="pp-site-label">
            <div className="pp-site-name">{site.facility || "Site"}</div>
            <div className="pp-site-sub">
              {[site.city, site.state].filter(Boolean).join(", ")} · nearby physicians
            </div>
          </div>
          <input
            className="pp-specialty-input"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="Specialty / condition"
            title={
              site.condition
                ? `Pre-filled from "${site.condition}". Edit to override.`
                : "Enter a specialty or condition"
            }
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <select
            className="pp-radius-select"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>{r} mi</option>
            ))}
          </select>
          <button className="pp-search-btn" onClick={handleSearch} disabled={loading}>
            {loading ? "…" : "Search"}
          </button>
        </div>

        {/* ── Specialty chips ── */}
        {searchSpecialties.length > 0 && (
          <div className="pp-chips-row">
            <span className="pp-chips-label">Searching</span>
            {searchSpecialties.map((s) => (
              <span key={s} className="pp-chip">{s}</span>
            ))}
          </div>
        )}

        {/* ── Map — both physician lists plotted ── */}
        <div className="pp-map-wrap">
          {(searched && physicians.length > 0) || suggestedForMap.length > 0 ? (
            <PhysicianMap
              physicians={allForMap}
              suggestedPhysicians={suggestedForMap}
              selectedSite={site}
              selectedNpi={selectedNpi}
              onSelect={(p) => setSelectedNpi(p.npi)}
            />
          ) : (
            <div className="pp-map-empty">
              <span style={{ fontSize: 28, opacity: 0.4 }}>🗺️</span>
              <span>
                {loading
                  ? "Finding physicians…"
                  : "Run a search to see physicians on the map"}
              </span>
            </div>
          )}
        </div>

        {/* ── Scrollable area: main list + suggested section ── */}
        <div className="pp-list-section">

          {/* Count row for main list */}
          {!loading && physicians.length > 0 && (
            <div className="pp-count-row">
              <span className="pp-count-bar">
                Showing <strong>{physicians.length}</strong> of{" "}
                <strong>{total}</strong> physicians
              </span>
              {hasMore && (
                <button
                  className="pp-load-more-btn pp-load-more-main"
                  onClick={() => setShowMainLoadMoreModal(true)}
                  disabled={loading}
                >
                  + Load More
                </button>
              )}
            </div>
          )}

          <div className="pp-list">
            {/* ── Main list states ── */}
            {loading && (
              <div className="pp-center">
                <div className="pp-spinner" />
                <p className="pp-state-msg">Finding physicians…</p>
              </div>
            )}

            {!loading && error && (
              <div className="pp-error">
                <div className="pp-error-label">Error</div>
                {error}
              </div>
            )}

            {!loading && searched && !error && physicians.length === 0 && (
              <div className="pp-center">
                <span className="pp-empty-icon">👨‍⚕️</span>
                <span className="pp-empty-title">No physicians found</span>
                <span className="pp-empty-sub">
                  Try increasing the radius or changing the specialty.
                </span>
              </div>
            )}

            {!loading && physicians.length > 0 && physicians.map((p) => (
              <PhysicianCard
                key={p.npi}
                physician={p}
                nctId={site.nct_id}
                siteName={site.facility}
                onClick={(phys: Physician) => setDetailPhys(phys)}
              />
            ))}

            {/* Bottom Load More for main list */}
            {!loading && hasMore && physicians.length > 0 && (
              <div className="pp-load-more-bottom-wrap">
                <button
                  className="pp-load-more-bottom pp-load-more-bottom-main"
                  onClick={() => setShowMainLoadMoreModal(true)}
                  disabled={loading}
                >
                  <span>＋</span>
                  Load more physicians
                </button>
                <span className="pp-load-more-bottom-sub">
                  Showing {physicians.length} of {total}
                </span>
              </div>
            )}

            {/* ── Suggested Physicians Section ── */}
            {(suggested.searched || suggested.loading) && (
              <div className="pp-suggested-section" style={{ marginTop: 4, borderRadius: 10 }}>
                <div className="pp-suggested-header">
                  <div>
                    <div className="pp-suggested-title">
                      <span style={{ fontSize: 16 }}>⭐</span>
                      <span className="pp-suggested-title-text">Suggested Physicians</span>
                      <span className="pp-suggested-badge">Trial-related</span>
                    </div>
                    <div className="pp-suggested-sub">
                      Supporting specialists related to{" "}
                      <strong style={{ color: "#0f766e" }}>
                        {site.condition || "this trial"}
                      </strong>
                    </div>
                  </div>
                  {suggested.hasMore && !suggested.loading && (
                    <button
                      className="pp-load-more-btn pp-load-more-suggested"
                      onClick={() => setShowSuggestLoadMoreModal(true)}
                      disabled={suggested.loading}
                    >
                      + Load More
                    </button>
                  )}
                </div>

                <div className="pp-suggested-list">
                  {/* Suggested loading */}
                  {suggested.loading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", color: "#0d9488", fontSize: 12, fontWeight: 600 }}>
                      <div className="pp-spinner-teal" />
                      Finding suggested physicians…
                    </div>
                  )}

                  {/* Suggested error */}
                  {!suggested.loading && suggested.error && (
                    <div className="pp-error">
                      <div className="pp-error-label">Error</div>
                      {suggested.error}
                    </div>
                  )}

                  {/* Suggested empty */}
                  {!suggested.loading && suggested.searched && !suggested.error && suggested.physicians.length === 0 && (
                    <div style={{ padding: "14px 0", textAlign: "center", fontSize: 12, color: "#94a3b8" }}>
                      No additional specialists found for this trial.
                    </div>
                  )}

                  {/* Suggested cards */}
                  {!suggested.loading && suggested.physicians.map((p) => (
                    <div
                      key={p.npi}
                      className="pp-suggested-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailPhys(p)}
                      onKeyDown={(e) => e.key === "Enter" && setDetailPhys(p)}
                    >
                      <div className="pp-suggested-tag">Suggested</div>
                      {/* Avatar + name row */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingRight: 70 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: "50%",
                          background: "linear-gradient(135deg, #f0fdfa, #99f6e4)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, color: "#0d9488", flexShrink: 0,
                          fontFamily: "'DM Mono', monospace",
                        }}>
                          {p.name.replace(/^Dr\.\s*/i, "").split(" ").filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join("")}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0d1117", lineHeight: 1.3 }}>
                            {p.name}
                          </div>
                          {p.taxonomy_desc && (
                            <div style={{ fontSize: 11, color: "#0d9488", marginTop: 1 }}>
                              {p.taxonomy_desc}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Meta */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                        fontSize: 11, color: "#8b95a1",
                        borderTop: "1px solid #ccfbf1", paddingTop: 7, marginTop: 7,
                      }}>
                        {p.address && <span>📍 {p.address.split(",").slice(0, 2).join(",")}</span>}
                        {p.phone   && <span>📞 {p.phone}</span>}
                        {p.distance_miles != null && (
                          <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 700, color: "#14b8a6" }}>
                            {p.distance_miles.toFixed(1)} mi
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: 7, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>View details →</span>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#cdd3e0" }}>
                          NPI: {p.npi}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Bottom Load More for suggested list */}
                  {!suggested.loading && suggested.hasMore && suggested.physicians.length > 0 && (
                    <div className="pp-load-more-bottom-wrap">
                      <button
                        className="pp-load-more-bottom pp-load-more-bottom-suggested"
                        onClick={() => setShowSuggestLoadMoreModal(true)}
                        disabled={suggested.loading}
                      >
                        <span>＋</span>
                        Load more suggested physicians
                      </button>
                      <span className="pp-load-more-bottom-sub">
                        Showing {suggested.physicians.length} of {suggested.total}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lead-gate modal — Main list Load More */}
      {showMainLoadMoreModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowMainLoadMoreModal(false)}
          onSuccess={() => {
            setShowMainLoadMoreModal(false);
            onLoadMore();
          }}
        />
      )}

      {/* Lead-gate modal — Suggested list Load More */}
      {showSuggestLoadMoreModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowSuggestLoadMoreModal(false)}
          onSuccess={() => {
            setShowSuggestLoadMoreModal(false);
            suggested.loadMore();
          }}
        />
      )}
    </>
  );
}