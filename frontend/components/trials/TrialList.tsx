"use client";

import { memo } from "react";
import StatusBadge from "@/components/shared/StatusBadge";
import type { Trial } from "@/types/trial";

interface Props {
  trials:     Trial[];
  totalCount: number;
  selectedId: string | null;
  onSelect:   (trial: Trial) => void;
  hasMore:    boolean;
  onLoadMore: () => void;
  loading:    boolean;
}

function TrialList({ trials, totalCount, selectedId, onSelect, hasMore, onLoadMore, loading }: Props) {
  const shown = trials.length;

  return (
    <>
      <style>{`
        .tl-header {
          padding: 14px 16px 12px;
          border-bottom: 1px solid var(--border);
          background: var(--forest);
          flex-shrink: 0;
          position: sticky; top: 0; z-index: 10;
        }
        .tl-header-label {
          font-size: 9px; font-weight: 700;
          color: rgba(255,255,255,0.45);
          text-transform: uppercase; letter-spacing: 1px;
          margin-bottom: 5px;
        }
        .tl-header-count {
          font-size: 13px; font-weight: 600;
          color: rgba(255,255,255,0.9);
          font-family: var(--font-mono);
          display: flex; align-items: center; gap: 8px;
        }
        .tl-count-badge {
          background: rgba(255,255,255,0.12);
          border-radius: 20px; padding: 2px 9px;
          font-size: 11px; font-weight: 600;
          color: var(--green-400);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .tl-list { flex: 1; overflow-y: auto; }
        .tl-item {
          padding: 13px 16px;
          border-bottom: 1px solid var(--border);
          cursor: pointer; outline: none;
          position: relative; overflow: hidden;
          transition: background 0.14s;
        }
        .tl-item::before {
          content: '';
          position: absolute; left: 0; top: 0; bottom: 0;
          width: 3px;
          background: transparent;
          transition: background 0.14s;
        }
        .tl-item.active {
          background: var(--green-50);
        }
        .tl-item.active::before { background: var(--green-600); }
        .tl-item:not(.active):hover { background: var(--surface); }
        .tl-item:not(.active):hover::before { background: var(--border); }
        .tl-item-badges {
          display: flex; align-items: center; gap: 5px;
          margin-bottom: 6px; flex-wrap: wrap; min-width: 0;
        }
        .tl-nct {
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.6px; text-transform: uppercase;
          font-family: var(--font-mono); flex-shrink: 0;
        }
        .tl-title {
          font-size: 13px; font-weight: 500; color: var(--ink);
          line-height: 1.5; margin-bottom: 6px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden; word-break: break-word;
        }
        .tl-meta {
          display: flex; align-items: center; gap: 5px;
          font-size: 11px; color: var(--muted); min-width: 0;
          flex-wrap: wrap;
        }
        .tl-sponsor {
          color: var(--ink-3); font-weight: 500;
          overflow: hidden; white-space: nowrap;
          text-overflow: ellipsis; flex-shrink: 1; min-width: 0;
        }
        .tl-load-more {
          display: block; width: calc(100% - 28px);
          margin: 12px 14px 14px;
          padding: 11px;
          border: 1.5px dashed var(--border);
          border-radius: var(--radius-md);
          background: transparent;
          font-size: 13px; font-weight: 500; color: var(--muted);
          cursor: pointer; font-family: var(--font-sans);
          transition: all 0.16s cubic-bezier(.22,1,.36,1);
        }
        .tl-load-more:hover:not(:disabled) {
          background: var(--surface);
          border-color: var(--green-500);
          color: var(--forest-mid);
        }
        .tl-load-more:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
        <div className="tl-header">
          <div className="tl-header-label">Clinical Trials</div>
          <div className="tl-header-count">
            <span>{shown.toLocaleString()} shown</span>
            <span className="tl-count-badge">{totalCount.toLocaleString()} total</span>
          </div>
        </div>

        <div className="tl-list">
          {trials.map((trial, i) => {
            const isActive = selectedId === trial.nctId;
            const animClass = i < 5 ? `card-anim-${i + 1}` : "";
            return (
              <div
                key={trial.nctId}
                className={`tl-item ${isActive ? "active" : ""} ${animClass}`}
                onClick={() => onSelect(trial)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onSelect(trial)}
              >
                <div className="tl-item-badges">
                  <span
                    className="tl-nct"
                    style={{ color: isActive ? "var(--forest-mid)" : "var(--muted)" }}
                  >
                    {trial.nctId}
                  </span>
                  <StatusBadge status={trial.status} />
                  {trial.phases.map((p) =>
                    p === "N/A" || p === "NA" ? (
                      <span key={p} style={{
                        display: "inline-flex", padding: "2px 7px",
                        borderRadius: 20, fontSize: 10, fontWeight: 500,
                        background: "var(--surface-2)", color: "var(--muted)",
                        border: "1px solid var(--border)", flexShrink: 0,
                      }}>Not applicable</span>
                    ) : (
                      <span key={p} style={{
                        display: "inline-flex", padding: "2px 8px",
                        borderRadius: 20, fontSize: 10, fontWeight: 700,
                        background: "var(--surface-2)", color: "var(--ink-3)",
                        border: "1px solid var(--border)",
                        fontFamily: "var(--font-mono)", flexShrink: 0,
                      }}>{p}</span>
                    )
                  )}
                </div>

                <div className="tl-title">{trial.title}</div>

                <div className="tl-meta">
                  {trial.sponsor && (
                    <span className="tl-sponsor">{trial.sponsor}</span>
                  )}
                  <span style={{ flexShrink: 0 }}>
                    {trial.sponsor ? "· " : ""}
                    {trial.locations.length} site{trial.locations.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            );
          })}

          {hasMore && (
            <button
              className="tl-load-more"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? "Loading…" : `Load more trials`}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default memo(TrialList);