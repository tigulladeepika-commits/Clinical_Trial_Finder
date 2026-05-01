"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import PhysicianCard              from "@/components/physicians/PhysicianCard";
import PhysicianDetailPanel       from "@/components/physicians/PhysicianDetailPanel";
import PhysicianMap               from "@/components/physicians/PhysicianMap";
import LeadCaptureModal           from "@/components/shared/LeadCaptureModal";
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
  const [radius,           setRadius]           = useState<number>(25);
  const [specialty,        setSpecialty]        = useState(site.condition ?? "");
  const [selectedNpi,      setSelectedNpi]      = useState<string | null>(null);
  const [detailPhys,       setDetailPhys]       = useState<Physician | null>(null);
  const [showMainModal,    setShowMainModal]    = useState(false);
  const [showSuggestModal, setShowSuggestModal] = useState(false);

  const initialSpecialtyRef = useRef<string>("");
  const suggested = useSuggestedPhysicians();

  useEffect(() => {
    if (!searched || loading || physicians.length === 0) return;
    suggested.fetch(site, radius, site.condition ?? undefined, physicians.map(p => p.npi));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, loading, physicians]);

  const handleSearch = useCallback(() => {
    if (!initialSpecialtyRef.current) initialSpecialtyRef.current = specialty.trim();
    const trialCondition = site.condition?.trim() ?? "";
    const currentInput   = specialty.trim();
    const userSpecialty  = currentInput.toLowerCase() !== trialCondition.toLowerCase() ? currentInput : "";
    onSearch(radius, trialCondition, userSpecialty, initialSpecialtyRef.current);
  }, [radius, specialty, site.condition, onSearch]);

  // Physician detail view — no scroll trap, parent scrolls
  if (detailPhys) {
    return (
      <div>
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

  return (
    <>
      <style>{`
        /* ── Shell: no overflow — Salesforce / parent provides scroll ── */
        .pp-shell { display: flex; flex-direction: column; font-family: var(--font-sans); }

        /* ── Sticky toolbar ── */
        .pp-toolbar {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 14px; background: #fff;
          border-bottom: 1px solid var(--border);
          position: sticky; top: 0; z-index: 20;
          flex-wrap: wrap;
        }
        .pp-back-btn {
          display: flex; align-items: center; justify-content: center;
          height: 32px; width: 32px; background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--radius-md);
          cursor: pointer; font-size: 15px; color: var(--ink-3);
          flex-shrink: 0; transition: all 0.15s;
        }
        .pp-back-btn:hover { background: var(--surface-2); border-color: var(--border-mid); color: var(--ink); }
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
          border-color: var(--blue-500);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.10);
          background: #fff;
        }
        .pp-specialty-input::placeholder { color: var(--muted-light); }
        .pp-radius-select {
          flex: 0 0 86px; height: 32px; padding: 0 7px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 12px; color: var(--ink); background: var(--surface);
          outline: none; cursor: pointer; font-family: var(--font-sans);
        }
        .pp-search-btn {
          height: 32px; padding: 0 14px;
          background: var(--blue-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); flex-shrink: 0;
          transition: all 0.15s;
        }
        .pp-search-btn:hover:not(:disabled) { background: var(--blue-700); }
        .pp-search-btn:disabled { background: var(--muted-light); cursor: not-allowed; }

        /* ── Specialty chips ── */
        .pp-chips-bar {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 14px; background: var(--blue-50);
          border-bottom: 1px solid var(--blue-200); flex-wrap: wrap;
        }
        .pp-chips-label {
          font-size: 10px; font-weight: 700; color: #1d4ed8;
          letter-spacing: 0.5px; text-transform: uppercase; flex-shrink: 0;
        }
        .pp-chip {
          display: inline-flex; align-items: center;
          background: var(--blue-600); color: #fff;
          border-radius: 20px; padding: 2px 9px;
          font-size: 10px; font-weight: 600;
        }

        /* ── Map ── */
        .pp-map-wrap {
          height: 260px; position: relative;
          background: var(--surface-2);
          border-bottom: 1px solid var(--border);
        }
        .pp-map-empty {
          display: flex; align-items: center; justify-content: center;
          height: 100%; font-size: 12px; color: var(--muted);
          font-weight: 500; flex-direction: column; gap: 10px;
        }

        /* ── Count bar ── */
        .pp-count-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 14px; border-bottom: 1px solid var(--border);
          background: #fff; font-size: 11px; color: var(--muted); font-weight: 600;
        }
        .pp-count-bar strong { color: var(--ink); }

        /* ── Cards list — no overflow, flows naturally ── */
        .pp-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }

        /* ── Load more button — no "+" prefix ── */
        .pp-load-more-top {
          height: 28px; padding: 0 12px;
          background: var(--blue-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 11px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans); transition: all 0.15s;
        }
        .pp-load-more-top:hover:not(:disabled) { background: var(--blue-700); }
        .pp-load-more-top:disabled { opacity: 0.55; cursor: not-allowed; }
        .pp-load-more-bottom {
          width: 100%; padding: 11px 0; background: #fff;
          border-radius: var(--radius-md); font-size: 12px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans);
          border: 1.5px dashed var(--border); color: var(--blue-600);
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 0.15s;
        }
        .pp-load-more-bottom:hover:not(:disabled) {
          background: var(--blue-50); border-color: var(--blue-500);
        }
        .pp-load-more-bottom:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── State helpers ── */
        .pp-center {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px;
          padding: 36px 20px; color: var(--muted); text-align: center;
        }
        .pp-empty-icon  { font-size: 30px; opacity: 0.5; }
        .pp-empty-title { font-size: 13px; font-weight: 600; color: var(--ink-3); }
        .pp-empty-sub   { font-size: 11px; max-width: 200px; line-height: 1.6; }
        .pp-error {
          margin: 8px 14px; padding: 10px 12px; border-radius: var(--radius-md);
          background: var(--coral-50); border: 1px solid #fecaca;
          color: var(--coral-600); font-size: 12px;
        }
        .pp-error-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }

        /* ── Suggested section header — same card styles come from PhysicianCard ── */
        .pp-section-hdr {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px 8px;
          border-top: 2px solid var(--border);
          background: var(--surface);
        }
        .pp-section-title {
          font-size: 12px; font-weight: 700; color: var(--ink);
          display: flex; align-items: center; gap: 6px;
        }
        .pp-section-badge {
          background: var(--blue-600); color: #fff;
          font-size: 9px; font-weight: 700; padding: 2px 7px;
          border-radius: 20px; letter-spacing: 0.5px; text-transform: uppercase;
        }
        .pp-section-sub { font-size: 10px; color: var(--muted); margin-top: 2px; }
        .pp-spinner-sm {
          width: 16px; height: 16px;
          border: 2px solid var(--border);
          border-top-color: var(--blue-600); border-radius: 50%;
          animation: spinAnim 0.7s linear infinite;
          flex-shrink: 0;
        }
        .pp-load-more-wrap {
          margin-top: 4px; padding: 10px 14px 4px;
          border-top: 1px solid var(--border);
          display: flex; flex-direction: column; align-items: center; gap: 5px;
        }
        .pp-count-sub { font-size: 10px; color: var(--muted); }
      `}</style>

      <div className="pp-shell">
        {kpiBar}

        {/* Sticky toolbar */}
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
            {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
          </select>
          <button className="pp-search-btn" onClick={handleSearch} disabled={loading}>
            {loading ? "…" : "Search"}
          </button>
        </div>

        {/* Specialty chips */}
        {searchSpecialties.length > 0 && (
          <div className="pp-chips-bar">
            <span className="pp-chips-label">Matching</span>
            {searchSpecialties.map(s => <span key={s} className="pp-chip">{s}</span>)}
          </div>
        )}

        {/* Map */}
        <div className="pp-map-wrap">
          {(searched && physicians.length > 0) || suggested.physicians.length > 0 ? (
            <PhysicianMap
              physicians={physicians}
              suggestedPhysicians={suggested.physicians}
              selectedSite={site}
              selectedNpi={selectedNpi}
              onSelect={(p) => setSelectedNpi(p.npi)}
            />
          ) : (
            <div className="pp-map-empty">
              <span style={{ fontSize: 28, opacity: 0.35 }}>🗺️</span>
              <span>{loading ? "Finding physicians…" : "Run a search to see physicians on the map"}</span>
            </div>
          )}
        </div>

        {/* ── Retrieved Physicians section ── */}
        {!loading && physicians.length > 0 && (
          <div className="pp-count-bar">
            <span><strong>{physicians.length}</strong> of <strong>{total}</strong> physicians</span>
            {hasMore && (
              <button className="pp-load-more-top" onClick={() => setShowMainModal(true)} disabled={loading}>
                Load More
              </button>
            )}
          </div>
        )}

        <div className="pp-list">
          {loading && (
            <div className="pp-center">
              <div className="spinner" />
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>Finding physicians…</p>
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
              <span className="pp-empty-sub">Try increasing the radius or changing the specialty.</span>
            </div>
          )}

          {/* Main physician cards — same PhysicianCard used for both sections */}
          {!loading && physicians.map((p, i) => (
            <div key={p.npi} className={`card-anim-${Math.min(i + 1, 5)}`}>
              <PhysicianCard
                physician={p}
                nctId={site.nct_id}
                siteName={site.facility}
                onClick={(phys) => setDetailPhys(phys)}
              />
            </div>
          ))}

          {/* Bottom load more — no "+" symbol */}
          {!loading && hasMore && physicians.length > 0 && (
            <div className="pp-load-more-wrap">
              <button className="pp-load-more-bottom" onClick={() => setShowMainModal(true)} disabled={loading}>
                Load more physicians
              </button>
              <span className="pp-count-sub">Showing {physicians.length} of {total}</span>
            </div>
          )}
        </div>

        {/* ── Suggested Physicians section — same PhysicianCard component ── */}
        {(suggested.searched || suggested.loading) && (
          <>
            <div className="pp-section-hdr">
              <div>
                <div className="pp-section-title">
                  ⭐ Suggested Physicians
                  <span className="pp-section-badge">Trial-related</span>
                </div>
                <div className="pp-section-sub">
                  Related to <strong style={{ color: "var(--ink-2)" }}>{site.condition || "this trial"}</strong>
                </div>
              </div>
              {suggested.hasMore && !suggested.loading && (
                <button className="pp-load-more-top" onClick={() => setShowSuggestModal(true)} disabled={suggested.loading}>
                  Load More
                </button>
              )}
            </div>

            <div className="pp-list">
              {suggested.loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                  <div className="pp-spinner-sm" />
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
                <div style={{ padding: "12px 0", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                  No additional specialists found for this trial.
                </div>
              )}

              {/* Suggested cards — identical PhysicianCard component, same layout */}
              {!suggested.loading && suggested.physicians.map((p, i) => (
                <div key={p.npi} className={`card-anim-${Math.min(i + 1, 5)}`}>
                  <PhysicianCard
                    physician={p}
                    nctId={site.nct_id}
                    siteName={site.facility}
                    onClick={(phys) => setDetailPhys(phys)}
                  />
                </div>
              ))}

              {/* Bottom load more for suggested — no "+" symbol */}
              {!suggested.loading && suggested.hasMore && suggested.physicians.length > 0 && (
                <div className="pp-load-more-wrap">
                  <button className="pp-load-more-bottom" onClick={() => setShowSuggestModal(true)} disabled={suggested.loading}>
                    Load more suggested
                  </button>
                  <span className="pp-count-sub">Showing {suggested.physicians.length} of {suggested.total}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Lead-gate modal — main list */}
      {showMainModal && (
        <LeadCaptureModal
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={() => setShowMainModal(false)}
          onSuccess={() => { setShowMainModal(false); onLoadMore(); }}
        />
      )}

      {/* Lead-gate modal — suggested list */}
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