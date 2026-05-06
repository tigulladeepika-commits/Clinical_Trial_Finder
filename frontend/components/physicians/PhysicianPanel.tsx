"use client";

// components/physicians/PhysicianPanel.tsx
//
// Changes vs previous version:
//
// FIX 1 — getConditionSpecialties() is now called on mount (and when the
//   site changes) to pre-resolve the raw CT.gov condition string into NUCC
//   specialty names BEFORE any physician search runs.
//
//   Why this matters: the specialty input was pre-filled with the raw
//   CT.gov string e.g. "Recurrent High-Grade Glioma That Cannot Be Removed
//   by Surgery". This long string was sent directly as the `specialty` param
//   and the backend's resolve_with_broader() resolved it inconsistently —
//   sometimes to "Medical Oncology", sometimes to "Internal Medicine" or
//   nothing. By resolving first via the /api/trials/condition endpoint,
//   we get the definitive NUCC names ("Medical Oncology", "Neurosurgery")
//   and:
//     a) pre-fill the input with the clean resolved name instead of the raw
//        CT.gov string — so the chip bar shows the right specialty immediately
//     b) pass the resolved name as initial_specialty, not the raw string —
//        so the backend NPPES query uses precise NUCC taxonomy codes
//     c) show a "Resolving specialty..." state so the user knows what's
//        happening before clicking Search
//
// FIX 2 — initialSpecialty ownership moved entirely to this component.
//   The hook no longer pins it. This panel sets resolvedSpecialty from
//   getConditionSpecialties() and passes it as initial_specialty on every
//   search. When the user types something different, their input becomes
//   user_specialty (additive on top of the resolved base specialty).
//   When the user explicitly clears the input, we do a fresh search with
//   only the condition-resolved specialties, not the user's previous text.
//
// FIX 3 — Suggested physicians useEffect uses a stable memoised NPI key
//   string (sorted + joined) as the dep, not the physicians array reference.
//   This prevents the effect from re-firing on every parent re-render when
//   the actual physicians haven't changed.
//
// FIX 4 — RADIUS_OPTIONS now exactly matches usePhysicians RADIUS_STEPS
//   [5, 10, 25, 50, 100]. The hook's loadMore() will always expand to the
//   correct next step regardless of what the user picked as starting radius.

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import PhysicianCard              from "@/components/physicians/PhysicianCard";
import PhysicianDetailPanel       from "@/components/physicians/PhysicianDetailPanel";
import PhysicianMap               from "@/components/physicians/PhysicianMap";
import LeadCaptureModal           from "@/components/shared/LeadCaptureModal";
import { useSuggestedPhysicians } from "@/hooks/usePhysicians";
import { getConditionSpecialties } from "@/lib/api";
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
  onSearch:   (radius: number, specialty: string, userSpecialty: string, initialSpecialty: string) => void;
  onLoadMore: () => void;
  onBack:     () => void;
}

// Must match RADIUS_STEPS in usePhysicians exactly
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

export default function PhysicianPanel({
  site, physicians, total, loading, error, searched, hasMore,
  searchSpecialties, kpiBar, onSearch, onLoadMore, onBack,
}: Props) {
  const [radius,            setRadius]            = useState<number>(25);
  const [userInput,         setUserInput]         = useState("");
  const [selectedNpi,       setSelectedNpi]       = useState<string | null>(null);
  const [detailPhys,        setDetailPhys]        = useState<Physician | null>(null);
  const [showMainModal,     setShowMainModal]     = useState(false);
  const [showSuggestModal,  setShowSuggestModal]  = useState(false);

  // Resolved NUCC specialty names for this site's condition
  const [resolvedSpecialty, setResolvedSpecialty] = useState<string>("");
  const [resolving,         setResolving]         = useState(false);

  const suggested          = useSuggestedPhysicians();
  const siteConditionRef   = useRef<string>("");

  // ── FIX 1: resolve specialty on mount + when site condition changes ─────────
  useEffect(() => {
    const condition = site.condition?.trim() ?? "";

    // No change — skip
    if (!condition || condition === siteConditionRef.current) return;
    siteConditionRef.current = condition;

    setResolving(true);
    setResolvedSpecialty("");
    setUserInput("");

    getConditionSpecialties(condition)
      .then((specialties) => {
        // Take the first resolved specialty as the canonical input value
        // e.g. ["Medical Oncology", "Hematology & Oncology"] → "Medical Oncology"
        const primary = specialties[0] ?? condition;
        setResolvedSpecialty(primary);
        setUserInput(primary);
      })
      .catch(() => {
        // Fall back to raw condition string if resolution fails
        setResolvedSpecialty(condition);
        setUserInput(condition);
      })
      .finally(() => setResolving(false));
  }, [site.condition]);

  // ── FIX 3: stable NPI key to prevent suggested from re-firing every render ──
  const npis    = physicians.map((p) => p.npi);
  const npiKey  = useMemo(
    () => [...npis].sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [npis.join(",")]
  );

  useEffect(() => {
    if (!searched || loading || physicians.length === 0) return;
    // Pass the current npis array (reconstructed from the stable key) to avoid
    // holding a stale closure over the physicians prop
    const currentNpis = npiKey ? npiKey.split(",") : [];
    suggested.fetch(site, radius, site.condition ?? undefined, currentNpis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, loading, npiKey]);

  // ── FIX 2: handleSearch owns initialSpecialty using the resolved value ──────
  const handleSearch = useCallback(() => {
    const input = userInput.trim();

    // Determine what to send:
    // - initial_specialty: always the pre-resolved NUCC name from the condition
    // - user_specialty:    only if the user changed the input away from the
    //                      resolved value (they want to add/override)
    const isResolved = input.toLowerCase() === resolvedSpecialty.toLowerCase();
    const userSpecialty = (!isResolved && input) ? input : "";

    onSearch(
      radius,
      site.condition?.trim() ?? "",  // raw condition — backend fallback only
      userSpecialty,
      resolvedSpecialty,             // pre-resolved NUCC name — primary signal
    );
  }, [radius, userInput, resolvedSpecialty, site.condition, onSearch]);

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
        .pp-shell { display: flex; flex-direction: column; font-family: var(--font-sans); }
        .pp-toolbar {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 14px; background: #fff;
          border-bottom: 1px solid var(--border);
          position: sticky; top: 0; z-index: 20; flex-wrap: wrap;
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
        .pp-specialty-wrap { flex: 2 1 120px; position: relative; min-width: 0; }
        .pp-specialty-input {
          width: 100%; height: 32px; padding: 0 28px 0 11px;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 12px; color: var(--ink); background: var(--surface);
          outline: none; font-family: var(--font-sans);
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
        }
        .pp-specialty-input:focus {
          border-color: var(--blue-500);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.10);
          background: #fff;
        }
        .pp-specialty-input:disabled { opacity: 0.55; cursor: not-allowed; }
        .pp-specialty-input::placeholder { color: var(--muted-light); }
        .pp-specialty-clear {
          position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: var(--muted); font-size: 14px; padding: 2px; line-height: 1;
        }
        .pp-specialty-clear:hover { color: var(--ink); }
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

        /* Resolving indicator */
        .pp-resolving {
          padding: 5px 14px; background: var(--blue-50);
          border-bottom: 1px solid var(--blue-100);
          font-size: 11px; color: var(--blue-600); font-weight: 600;
          display: flex; align-items: center; gap: 7px;
        }
        .pp-resolving-spinner {
          width: 12px; height: 12px;
          border: 1.5px solid rgba(37,99,235,0.3);
          border-top-color: var(--blue-600); border-radius: 50%;
          animation: spinAnim 0.65s linear infinite; flex-shrink: 0;
        }

        /* Specialty chips */
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

        /* Map */
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
        .pp-count-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 14px; border-bottom: 1px solid var(--border);
          background: #fff; font-size: 11px; color: var(--muted); font-weight: 600;
        }
        .pp-count-bar strong { color: var(--ink); }
        .pp-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
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
        .pp-center {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px;
          padding: 36px 20px; color: var(--muted); text-align: center;
        }
        .pp-empty-icon  { font-size: 30px; opacity: 0.5; }
        .pp-empty-title { font-size: 13px; font-weight: 600; color: var(--ink-3); }
        .pp-empty-sub   { font-size: 11px; max-width: 220px; line-height: 1.6; }
        .pp-error {
          margin: 8px 14px; padding: 10px 12px; border-radius: var(--radius-md);
          background: var(--coral-50); border: 1px solid #fecaca;
          color: var(--coral-600); font-size: 12px;
        }
        .pp-error-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
        .pp-section-hdr {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px 8px; border-top: 2px solid var(--border);
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
          animation: spinAnim 0.7s linear infinite; flex-shrink: 0;
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

          {/* FIX 1: input shows resolved NUCC name, not raw CT.gov condition */}
          <div className="pp-specialty-wrap">
            <input
              className="pp-specialty-input"
              value={userInput}
              disabled={resolving}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={resolving ? "Resolving specialty…" : "Specialty / condition"}
              onKeyDown={(e) => e.key === "Enter" && !resolving && handleSearch()}
            />
            {userInput && !resolving && (
              <button
                className="pp-specialty-clear"
                onClick={() => setUserInput(resolvedSpecialty)}
                title="Reset to resolved specialty"
              >×</button>
            )}
          </div>

          <select
            className="pp-radius-select"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} mi</option>)}
          </select>
          <button
            className="pp-search-btn"
            onClick={handleSearch}
            disabled={loading || resolving}
          >
            {loading ? "…" : "Search"}
          </button>
        </div>

        {/* FIX 1: resolving indicator */}
        {resolving && (
          <div className="pp-resolving">
            <div className="pp-resolving-spinner" />
            Resolving specialty for "{site.condition}"…
          </div>
        )}

        {/* Specialty chips — shown after search, reflect actual NPPES query */}
        {searchSpecialties.length > 0 && !resolving && (
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
              <span>
                {resolving
                  ? "Resolving specialty…"
                  : loading
                  ? "Finding physicians…"
                  : "Run a search to see physicians on the map"}
              </span>
            </div>
          )}
        </div>

        {/* Count bar */}
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
              <span className="pp-empty-sub">
                {resolvedSpecialty
                  ? `No ${resolvedSpecialty} physicians found within ${radius} miles. Try increasing the radius.`
                  : "Try increasing the radius or changing the specialty."}
              </span>
            </div>
          )}

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

          {!loading && hasMore && physicians.length > 0 && (
            <div className="pp-load-more-wrap">
              <button className="pp-load-more-bottom" onClick={() => setShowMainModal(true)} disabled={loading}>
                Load more physicians
              </button>
              <span className="pp-count-sub">Showing {physicians.length} of {total}</span>
            </div>
          )}
        </div>

        {/* Suggested Physicians section */}
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