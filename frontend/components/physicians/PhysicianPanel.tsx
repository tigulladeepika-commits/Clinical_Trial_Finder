// components/physicians/PhysicianPanel.tsx
"use client";

import React, { useState, useCallback, useRef } from "react";
import PhysicianCard        from "@/components/physicians/PhysicianCard";
import PhysicianDetailPanel from "@/components/physicians/PhysicianDetailPanel";
import PhysicianMap         from "@/components/physicians/PhysicianMap";
import LeadCaptureModal     from "@/components/shared/LeadCaptureModal";
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
  const [radius,      setRadius]      = useState<number>(25);
  const [specialty,   setSpecialty]   = useState(site.condition ?? "");
  const [leadPhys,    setLeadPhys]    = useState<Physician | null>(null);
  const [selectedNpi, setSelectedNpi] = useState<string | null>(null);
  const [detailPhys,  setDetailPhys]  = useState<Physician | null>(null);
  // Controls whether the modal was triggered by "Load More" (true) or "Add as Lead" (false)
  const [loadMoreModal, setLoadMoreModal] = useState(false);

  const initialSpecialtyRef = useRef<string>("");

  const handleSearch = useCallback(() => {
    if (!initialSpecialtyRef.current) {
      initialSpecialtyRef.current = specialty.trim();
    }

    const trialCondition = site.condition?.trim() ?? "";
    const currentInput   = specialty.trim();

    const userSpecialty = currentInput.toLowerCase() !== trialCondition.toLowerCase()
      ? currentInput
      : "";

    onSearch(
      radius,
      trialCondition,
      userSpecialty,
      initialSpecialtyRef.current,
    );
  }, [radius, specialty, site.condition, onSearch]);

  // "Load More" button opens the lead form;
  // on close it triggers the actual onLoadMore data fetch.
  const handleLoadMoreClick = useCallback(() => {
    setLoadMoreModal(true);
    setLeadPhys(physicians[0] ?? null);
  }, [physicians]);

  const handleLeadClose = useCallback(() => {
    setLeadPhys(null);
    if (loadMoreModal) {
      setLoadMoreModal(false);
      onLoadMore();
    }
  }, [onLoadMore, loadMoreModal]);

  // ── Physician detail view ────────────────────────────────────────────────
  if (detailPhys) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {kpiBar}
        <PhysicianDetailPanel
          physician={detailPhys}
          site={site}
          onBack={() => setDetailPhys(null)}
          onAddAsLead={(phys: Physician) => {
            setLoadMoreModal(false);
            setLeadPhys(phys);
          }}
        />
        {leadPhys && (
          <LeadCaptureModal
            npi={leadPhys.npi}
            nctId={site.nct_id}
            siteName={site.facility}
            onClose={() => setLeadPhys(null)}
          />
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
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

        /* Map wrapper — fixed height, no scrollbar */
        .pp-map-wrap {
          flex: 0 0 auto;
          height: 300px;
          position: relative; overflow: hidden; background: #e2e8f0;
        }
        .pp-map-empty {
          display: flex; align-items: center; justify-content: center;
          height: 100%; font-size: 12px; color: #94a3b8;
          font-weight: 500; flex-direction: column; gap: 8px;
        }
        .pp-map-empty-icon { font-size: 28px; opacity: 0.4; }

        /* List section — takes remaining height, single scroll zone */
        .pp-list-section {
          flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
        }

        /* Count bar row — sticky inside list section, never scrolls */
        .pp-count-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 12px 4px; flex-shrink: 0;
          border-bottom: 1px solid #f1f5f9;
          background: #fff;
        }
        .pp-count-bar {
          font-size: 11px; color: #64748b; font-weight: 600;
        }
        .pp-count-bar strong { color: #0d1117; }

        /* "Load More" button — top-right of count row (compact) */
        .pp-load-more-top {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px;
          background: #2563eb; color: #fff;
          border: none; border-radius: 7px;
          font-size: 11px; font-weight: 700;
          cursor: pointer; font-family: inherit;
          transition: background 0.15s, opacity 0.15s;
          white-space: nowrap; flex-shrink: 0;
        }
        .pp-load-more-top:hover { background: #1d4ed8; }
        .pp-load-more-top:disabled { opacity: 0.55; cursor: not-allowed; }

        /* Scrollable cards area — the ONE scroll zone for the list */
        .pp-list {
          flex: 1; overflow-y: auto; padding: 8px 12px 12px;
          display: flex; flex-direction: column; gap: 7px;
        }

        /* "Load More" button — bottom of card list, full width, prominent */
        .pp-load-more-bottom-wrap {
          margin-top: 4px;
          padding: 10px 2px 4px;
          border-top: 1px solid #e4e8f0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .pp-load-more-bottom {
          width: 100%;
          padding: 11px 0;
          background: #fff;
          color: #2563eb;
          border: 1.5px dashed #93c5fd;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          letter-spacing: 0.2px;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .pp-load-more-bottom:hover:not(:disabled) {
          background: #eff6ff;
          border-color: #2563eb;
          color: #1d4ed8;
        }
        .pp-load-more-bottom:disabled { opacity: 0.5; cursor: not-allowed; }
        .pp-load-more-bottom-sub {
          font-size: 10px;
          color: #94a3b8;
          font-weight: 500;
        }

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

        {/* ── Map (fixed height, no scroll) ── */}
        <div className="pp-map-wrap">
          {searched && physicians.length > 0 ? (
            <PhysicianMap
              physicians={physicians}
              selectedSite={site}
              selectedNpi={selectedNpi}
              onSelect={(p) => setSelectedNpi(p.npi)}
            />
          ) : (
            <div className="pp-map-empty">
              <span className="pp-map-empty-icon">🗺️</span>
              <span>
                {loading
                  ? "Finding physicians…"
                  : "Run a search to see physicians on the map"}
              </span>
            </div>
          )}
        </div>

        {/* ── List section (flex column, single scroll zone) ── */}
        <div className="pp-list-section">

          {/* Count bar row with compact "Load More" pinned top-right */}
          {!loading && physicians.length > 0 && (
            <div className="pp-count-row">
              <span className="pp-count-bar">
                Showing <strong>{physicians.length}</strong> of{" "}
                <strong>{total}</strong> physicians
              </span>
              {hasMore && (
                <button
                  className="pp-load-more-top"
                  onClick={handleLoadMoreClick}
                  disabled={loading}
                  title="Load more physicians"
                >
                  + Load More
                </button>
              )}
            </div>
          )}

          {/* Scrollable card list — the single scroll zone */}
          <div className="pp-list">
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
                onClick={(phys: Physician) => setDetailPhys(phys)}
              />
            ))}

            {/* ── Bottom "Load More" — appears after all cards when more exist ── */}
            {!loading && hasMore && physicians.length > 0 && (
              <div className="pp-load-more-bottom-wrap">
                <button
                  className="pp-load-more-bottom"
                  onClick={handleLoadMoreClick}
                  disabled={loading}
                >
                  <span>＋</span>
                  Load more physicians
                </button>
                <span className="pp-load-more-bottom-sub">
                  Showing {physicians.length} of {total} · scroll up to see all
                </span>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Lead capture modal (triggered by either Load More button) ── */}
      {leadPhys && (
        <LeadCaptureModal
          npi={leadPhys.npi}
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={handleLeadClose}
        />
      )}
    </>
  );
}