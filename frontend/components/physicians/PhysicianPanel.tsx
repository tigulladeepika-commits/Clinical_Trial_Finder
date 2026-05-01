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
  onSearch: (radius: number, specialty: string, userSpecialty: string, initialSpecialty: string) => void;
  onLoadMore: () => void;
  onBack:     () => void;
}

const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

export default function PhysicianPanel({
  site, physicians, total, loading, error, searched, hasMore,
  searchSpecialties, kpiBar, onSearch, onLoadMore, onBack,
}: Props) {
  const [radius,                   setRadius]                   = useState<number>(25);
  const [specialty,                setSpecialty]                = useState(site.condition ?? "");
  const [selectedNpi,              setSelectedNpi]              = useState<string | null>(null);
  const [detailPhys,               setDetailPhys]               = useState<Physician | null>(null);
  const [showMainModal,            setShowMainModal]            = useState(false);
  const [showSuggestModal,         setShowSuggestModal]         = useState(false);

  const initialSpecialtyRef = useRef<string>("");
  const suggested = useSuggestedPhysicians();

  useEffect(() => {
    if (!searched || loading || physicians.length === 0) return;
    const mainNpis = physicians.map((p) => p.npi);
    suggested.fetch(site, radius, site.condition ?? undefined, mainNpis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, loading, physicians]);

  const handleSearch = useCallback(() => {
    if (!initialSpecialtyRef.current) initialSpecialtyRef.current = specialty.trim();
    const trialCondition = site.condition?.trim() ?? "";
    const currentInput   = specialty.trim();
    const userSpecialty  = currentInput.toLowerCase() !== trialCondition.toLowerCase() ? currentInput : "";
    onSearch(radius, trialCondition, userSpecialty, initialSpecialtyRef.current);
  }, [radius, specialty, site.condition, onSearch]);

  if (detailPhys) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {kpiBar}
        <PhysicianDetailPanel
          physician={detailPhys}
          site={site}
          onBack={() => setDetailPhys(null)}
          onAddAsLead={() => {}}
        />
      </div>
    );
  }

  const allForMap       = physicians;
  const suggestedForMap = suggested.physicians;

  return (
    <>
      <style>{`
        .pp-shell {
          display: flex; flex-direction: column; height: 100%;
          overflow: hidden; font-family: var(--font-sans);
        }
        .pp-toolbar {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 14px; background: #fff;
          border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap;
        }
        .pp-back-btn {
          display: flex; align-items: center; justify-content: center;
          height: 32px; width: 32px; background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--radius-md);
          cursor: pointer; font-size: 15px; color: var(--ink-3);
          flex-shrink: 0; transition: all 0.15s;
        }
        .pp-back-btn:hover {
          background: var(--surface-2); border-color: var(--border-mid); color: var(--ink);
        }
        .pp-site-label { flex: 1; min-width: 0; }
        .pp-site-name {
          font-size: 12px; font-weight: 700; color: var(--ink);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pp-site-sub { font-size: 10px; color: var(--muted); font-weight: 500; }
        .pp-specialty-input {
          flex: 2 1 120px; height: 32px; padding: 0 11px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 12px; color: var(--ink); background: var(--surface);
          outline: none; font-family: var(--font-sans); min-width: 0;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .pp-specialty-input:focus {
          border-color: var(--green-500);
          box-shadow: 0 0 0 3px rgba(16,185,129,0.10);
          background: #fff;
        }
        .pp-specialty-input::placeholder { color: var(--muted-light); }
        .pp-radius-select {
          flex: 0 0 86px; height: 32px; padding: 0 7px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 12px; color: var(--ink); background: var(--surface);
          outline: none; cursor: pointer; font-family: var(--font-sans);
          transition: border-color 0.15s;
        }
        .pp-search-btn {
          height: 32px; padding: 0 14px;
          background: var(--forest-mid); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); flex-shrink: 0;
          transition: all 0.15s;
        }
        .pp-search-btn:hover:not(:disabled) {
          background: var(--forest);
          box-shadow: 0 3px 10px rgba(6,95,70,0.3);
        }
        .pp-search-btn:disabled { background: var(--muted-light); cursor: not-allowed; }
        .pp-chips-bar {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 14px; background: var(--green-50);
          border-bottom: 1px solid var(--green-100); flex-shrink: 0; flex-wrap: wrap;
        }
        .pp-chips-label {
          font-size: 10px; font-weight: 700; color: var(--forest-mid);
          letter-spacing: 0.5px; text-transform: uppercase; flex-shrink: 0;
        }
        .pp-chip {
          display: inline-flex; align-items: center;
          background: var(--forest-mid); color: #fff;
          border-radius: 20px; padding: 2px 9px;
          font-size: 10px; font-weight: 600;
        }
        .pp-map-wrap {
          flex: 0 0 auto; height: 280px;
          position: relative; overflow: hidden; background: var(--surface-2);
          border-bottom: 1px solid var(--border);
        }
        .pp-map-empty {
          display: flex; align-items: center; justify-content: center;
          height: 100%; font-size: 12px; color: var(--muted);
          font-weight: 500; flex-direction: column; gap: 10px;
        }
        .pp-list-section {
          flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
        }
        .pp-count-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 14px 6px; flex-shrink: 0;
          border-bottom: 1px solid var(--border); background: #fff;
          font-size: 11px; color: var(--muted); font-weight: 600;
        }
        .pp-count-bar strong { color: var(--ink); }
        .pp-list {
          flex: 1; overflow-y: auto; padding: 10px 14px 14px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .pp-center {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px;
          padding: 40px 20px; color: var(--muted); text-align: center;
        }
        .pp-empty-icon { font-size: 32px; opacity: 0.5; }
        .pp-empty-title { font-size: 13px; font-weight: 600; color: var(--ink-3); }
        .pp-empty-sub   { font-size: 11px; max-width: 200px; line-height: 1.6; }
        .pp-error {
          margin: 4px 0; padding: 10px 12px; border-radius: var(--radius-md);
          background: var(--coral-50); border: 1px solid #fecaca;
          color: var(--coral-600); font-size: 12px;
        }
        .pp-error-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
        /* Load more */
        .pp-load-more-inline {
          height: 28px; padding: 0 12px;
          background: var(--forest-mid); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 11px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans); transition: all 0.15s;
          display: flex; align-items: center; gap: 4px;
        }
        .pp-load-more-inline:hover:not(:disabled) { background: var(--forest); }
        .pp-load-more-inline:disabled { opacity: 0.55; cursor: not-allowed; }
        .pp-load-more-bottom {
          width: 100%; padding: 11px 0; background: #fff;
          border-radius: var(--radius-md); font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans);
          transition: all 0.15s; display: flex;
          align-items: center; justify-content: center; gap: 7px;
          border: 1.5px dashed var(--border); color: var(--forest-mid);
        }
        .pp-load-more-bottom:hover:not(:disabled) {
          background: var(--green-50); border-color: var(--green-400);
        }
        .pp-load-more-bottom:disabled { opacity: 0.5; cursor: not-allowed; }
        /* Suggested section */
        .pp-suggested-section {
          flex-shrink: 0; border-top: 2px solid var(--green-100);
          background: var(--green-50); border-radius: var(--radius-lg);
          margin-top: 6px; overflow: hidden;
        }
        .pp-suggested-hdr {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px 8px; border-bottom: 1px solid var(--green-100);
        }
        .pp-suggested-title {
          font-size: 12px; font-weight: 700; color: var(--forest);
          display: flex; align-items: center; gap: 7px;
        }
        .pp-suggested-badge {
          background: var(--green-600); color: #fff; font-size: 9px;
          font-weight: 700; padding: 2px 7px; border-radius: 20px;
          letter-spacing: 0.5px; text-transform: uppercase;
        }
        .pp-suggested-sub { font-size: 10px; color: var(--green-700); margin-top: 2px; }
        .pp-suggested-list {
          padding: 8px 14px 12px;
          display: flex; flex-direction: column; gap: 7px;
          max-height: 380px; overflow-y: auto;
        }
        .pp-suggest-card {
          background: #fff; border: 1px solid var(--green-100);
          border-radius: var(--radius-lg); padding: 11px 13px;
          cursor: pointer; transition: all 0.15s; outline: none;
          position: relative;
        }
        .pp-suggest-card:hover {
          border-color: var(--green-500);
          box-shadow: 0 3px 12px rgba(6,95,70,0.10);
          transform: translateY(-1px);
        }
        .pp-suggest-tag {
          position: absolute; top: 8px; right: 10px;
          background: var(--green-50); border: 1px solid var(--green-100);
          color: var(--forest-mid); font-size: 9px; font-weight: 700;
          padding: 1px 6px; border-radius: 10px; letter-spacing: 0.4px;
        }
        .pp-suggest-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: var(--green-100); color: var(--forest);
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; flex-shrink: 0;
          font-family: var(--font-mono);
        }
        .pp-suggest-name { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.3; }
        .pp-suggest-spec { font-size: 11px; color: var(--green-700); margin-top: 1px; }
        .pp-suggest-meta {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          font-size: 11px; color: var(--muted);
          border-top: 1px solid var(--green-100); padding-top: 7px; margin-top: 7px;
        }
        .pp-suggest-dist {
          margin-left: auto; font-family: var(--font-mono);
          font-size: 10px; font-weight: 700; color: var(--forest-mid);
        }
        .pp-suggest-footer {
          display: flex; justify-content: space-between; align-items: center; margin-top: 7px;
        }
        .pp-spinner-green {
          width: 18px; height: 18px; border: 2px solid var(--green-100);
          border-top-color: var(--green-500); border-radius: 50%;
          animation: spinAnim 0.7s linear infinite;
        }
      `}</style>

      <div className="pp-shell">
        {kpiBar}

        {/* Toolbar */}
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
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <select
            className="pp-radius-select"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} mi</option>)}
          </select>
          <button className="pp-search-btn" onClick={handleSearch} disabled={loading}>
            {loading ? "…" : "Search"}
          </button>
        </div>

        {/* Specialty chips */}
        {searchSpecialties.length > 0 && (
          <div className="pp-chips-bar">
            <span className="pp-chips-label">Matching</span>
            {searchSpecialties.map((s) => (
              <span key={s} className="pp-chip">{s}</span>
            ))}
          </div>
        )}

        {/* Map */}
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
              <span style={{ fontSize: 30, opacity: 0.35 }}>🗺️</span>
              <span>
                {loading ? "Finding physicians…" : "Run a search to see physicians on the map"}
              </span>
            </div>
          )}
        </div>

        {/* List section */}
        <div className="pp-list-section">
          {!loading && physicians.length > 0 && (
            <div className="pp-count-bar">
              <span>
                <strong>{physicians.length}</strong> of <strong>{total}</strong> physicians
              </span>
              {hasMore && (
                <button
                  className="pp-load-more-inline"
                  onClick={() => setShowMainModal(true)}
                  disabled={loading}
                >
                  + Load More
                </button>
              )}
            </div>
          )}

          <div className="pp-list">
            {loading && (
              <div className="pp-center">
                <div className="spinner" />
                <p style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
                  Finding physicians…
                </p>
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

            {!loading && physicians.length > 0 && physicians.map((p, i) => (
              <div key={p.npi} className={`card-anim-${Math.min(i + 1, 5)}`}>
                <PhysicianCard
                  physician={p}
                  nctId={site.nct_id}
                  siteName={site.facility}
                  onClick={(phys: Physician) => setDetailPhys(phys)}
                />
              </div>
            ))}

            {/* Bottom load more */}
            {!loading && hasMore && physicians.length > 0 && (
              <div style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <button
                  className="pp-load-more-bottom"
                  onClick={() => setShowMainModal(true)}
                  disabled={loading}
                >
                  ＋ Load more physicians
                </button>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>
                  Showing {physicians.length} of {total}
                </span>
              </div>
            )}

            {/* Suggested physicians */}
            {(suggested.searched || suggested.loading) && (
              <div className="pp-suggested-section">
                <div className="pp-suggested-hdr">
                  <div>
                    <div className="pp-suggested-title">
                      <span>⭐</span>
                      Suggested Physicians
                      <span className="pp-suggested-badge">Trial-related</span>
                    </div>
                    <div className="pp-suggested-sub">
                      Related to{" "}
                      <strong style={{ color: "var(--forest)" }}>
                        {site.condition || "this trial"}
                      </strong>
                    </div>
                  </div>
                  {suggested.hasMore && !suggested.loading && (
                    <button
                      className="pp-load-more-inline"
                      style={{ background: "var(--green-600)" }}
                      onClick={() => setShowSuggestModal(true)}
                      disabled={suggested.loading}
                    >
                      + More
                    </button>
                  )}
                </div>

                <div className="pp-suggested-list">
                  {suggested.loading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", color: "var(--forest-mid)", fontSize: 12, fontWeight: 600 }}>
                      <div className="pp-spinner-green" />
                      Finding suggested physicians…
                    </div>
                  )}
                  {!suggested.loading && suggested.error && (
                    <div className="pp-error">
                      <div className="pp-error-label">Error</div>
                      {suggested.error}
                    </div>
                  )}
                  {!suggested.loading && suggested.searched && !suggested.error && suggested.physicians.length === 0 && (
                    <div style={{ padding: "14px 0", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                      No additional specialists found for this trial.
                    </div>
                  )}

                  {!suggested.loading && suggested.physicians.map((p, i) => (
                    <div
                      key={p.npi}
                      className={`pp-suggest-card card-anim-${Math.min(i + 1, 5)}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailPhys(p)}
                      onKeyDown={(e) => e.key === "Enter" && setDetailPhys(p)}
                    >
                      <div className="pp-suggest-tag">Suggested</div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingRight: 72 }}>
                        <div className="pp-suggest-avatar">
                          {p.name.replace(/^Dr\.\s*/i, "").split(" ").filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join("")}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="pp-suggest-name">{p.name}</div>
                          {p.taxonomy_desc && <div className="pp-suggest-spec">{p.taxonomy_desc}</div>}
                        </div>
                      </div>
                      <div className="pp-suggest-meta">
                        {p.address && <span>📍 {p.address.split(",").slice(0, 2).join(",")}</span>}
                        {p.phone   && <span>📞 {p.phone}</span>}
                        {p.distance_miles != null && (
                          <span className="pp-suggest-dist">{p.distance_miles.toFixed(1)} mi</span>
                        )}
                      </div>
                      <div className="pp-suggest-footer">
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>View details →</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-light)" }}>
                          NPI: {p.npi}
                        </span>
                      </div>
                    </div>
                  ))}

                  {!suggested.loading && suggested.hasMore && suggested.physicians.length > 0 && (
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                      <button
                        className="pp-load-more-bottom"
                        style={{ borderColor: "var(--green-200)", color: "var(--forest-mid)" }}
                        onClick={() => setShowSuggestModal(true)}
                        disabled={suggested.loading}
                      >
                        ＋ Load more suggested
                      </button>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>
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

      {showMainModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowMainModal(false)}
          onSuccess={() => { setShowMainModal(false); onLoadMore(); }}
        />
      )}

      {showSuggestModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowSuggestModal(false)}
          onSuccess={() => { setShowSuggestModal(false); suggested.loadMore(); }}
        />
      )}
    </>
  );
}