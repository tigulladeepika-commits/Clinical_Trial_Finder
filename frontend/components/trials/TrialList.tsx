"use client";

import { useMemo } from "react";
import type { Trial } from "@/types/trial";

type Props = {
  trials:     Trial[];
  totalCount: number;
  selectedId: string | null;
  onSelect:   (trial: Trial) => void;
  hasMore:    boolean;
  onLoadMore: () => void;
  loading:    boolean;
};

// ── Status ordering & color system ──────────────────────────────────────────
type StatusGroup =
  | "Recruiting"
  | "Active"
  | "Not Actively Recruiting"
  | "Completed"
  | "Terminated"
  | "Other";

const STATUS_GROUP_ORDER: StatusGroup[] = [
  "Recruiting",
  "Active",
  "Not Actively Recruiting",
  "Completed",
  "Terminated",
  "Other",
];

const STATUS_CONFIG: Record<
  StatusGroup,
  { color: string; bg: string; border: string; dot: string; label: string }
> = {
  Recruiting: {
    color:  "#15803d",
    bg:     "#f0fdf4",
    border: "#bbf7d0",
    dot:    "#22c55e",
    label:  "Recruiting",
  },
  Active: {
    color:  "#1d4ed8",
    bg:     "#eff6ff",
    border: "#bfdbfe",
    dot:    "#3b82f6",
    label:  "Active",
  },
  "Not Actively Recruiting": {
    color:  "#92400e",
    bg:     "#fffbeb",
    border: "#fde68a",
    dot:    "#f59e0b",
    label:  "Not Recruiting",
  },
  Completed: {
    color:  "#334155",
    bg:     "#f8fafc",
    border: "#e2e8f0",
    dot:    "#64748b",
    label:  "Completed",
  },
  Terminated: {
    color:  "#b91c1c",
    bg:     "#fef2f2",
    border: "#fecaca",
    dot:    "#ef4444",
    label:  "Terminated",
  },
  Other: {
    color:  "#4b5563",
    bg:     "#f9fafb",
    border: "#e5e7eb",
    dot:    "#9ca3af",
    label:  "Other",
  },
};

function classifyStatus(status: string | null): StatusGroup {
  const s = (status || "").toLowerCase().trim();
  if (s === "recruiting" || s === "enrolling by invitation") return "Recruiting";
  if (s.includes("active") && !s.includes("not"))           return "Active";
  if (s === "not yet recruiting" || s === "suspended" || s === "available")
    return "Not Actively Recruiting";
  if (s === "completed")                                     return "Completed";
  if (s === "terminated" || s === "withdrawn")               return "Terminated";
  return "Other";
}

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span style={{
      display:       "inline-flex",
      alignItems:    "center",
      padding:       "2px 7px",
      borderRadius:  4,
      fontSize:      10,
      fontWeight:    700,
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      background:    "#f1f5f9",
      color:         "#475569",
      border:        "1px solid #e2e8f0",
      fontFamily:    "'IBM Plex Mono', monospace",
    }}>
      {phase}
    </span>
  );
}

function StatusDot({ group }: { group: StatusGroup }) {
  const cfg = STATUS_CONFIG[group];
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      gap:          5,
      padding:      "2px 8px 2px 5px",
      borderRadius: 20,
      fontSize:     10,
      fontWeight:   600,
      background:   cfg.bg,
      color:        cfg.color,
      border:       `1px solid ${cfg.border}`,
      whiteSpace:   "nowrap",
    }}>
      <span style={{
        width:        6,
        height:       6,
        borderRadius: "50%",
        background:   cfg.dot,
        flexShrink:   0,
        display:      "inline-block",
        animation:    group === "Recruiting"
          ? "trialPulse 2s ease-in-out infinite"
          : "none",
      }} />
      {cfg.label}
    </span>
  );
}

export default function TrialList({
  trials,
  totalCount,
  selectedId,
  onSelect,
  hasMore,
  onLoadMore,
  loading,
}: Props) {
  // Sort flat list by status order — no grouping headers (change #7)
  const sorted = useMemo(() => {
    return [...trials].sort((a, b) => {
      const orderA = STATUS_GROUP_ORDER.indexOf(classifyStatus(a.status ?? null));
      const orderB = STATUS_GROUP_ORDER.indexOf(classifyStatus(b.status ?? null));
      return orderA - orderB;
    });
  }, [trials]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Sora:wght@400;500;600;700&display=swap');

        @keyframes trialPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(1.4); }
        }
        @keyframes trialFadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .trial-list-wrap { font-family: 'Sora', sans-serif; }

        .trial-list-header {
          padding: 12px 16px 10px;
          border-bottom: 1px solid #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          background: #fff;
          z-index: 3;
        }
        .trial-list-count {
          font-size: 12px;
          color: #64748b;
          font-weight: 500;
        }
        .trial-list-count strong {
          color: #0f172a;
          font-weight: 700;
        }

        .trial-card-item {
          padding: 12px 16px;
          border-bottom: 1px solid #f8fafc;
          cursor: pointer;
          transition: background 0.12s, border-left-color 0.12s;
          border-left: 3px solid transparent;
          animation: trialFadeIn 0.22s ease both;
          position: relative;
        }
        .trial-card-item:hover {
          background: #f8fafc;
          border-left-color: #94a3b8;
        }
        .trial-card-item.active {
          background: #eff6ff;
          border-left-color: #2563eb;
        }
        .trial-card-item.active .trial-card-nct {
          color: #2563eb;
        }
        .trial-card-nct {
          font-size: 10px;
          font-weight: 700;
          color: #94a3b8;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          font-family: 'IBM Plex Mono', monospace;
          margin-bottom: 3px;
        }
        .trial-card-title {
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          line-height: 1.45;
          margin-bottom: 7px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .trial-card-meta {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .trial-card-sponsor {
          font-size: 11px;
          color: #94a3b8;
          margin-top: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .trial-load-more {
          margin: 14px 16px 18px;
          width: calc(100% - 32px);
          padding: 10px 0;
          border-radius: 10px;
          border: 1.5px dashed #cbd5e1;
          background: transparent;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          font-family: 'Sora', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .trial-load-more:hover:not(:disabled) {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
        }
        .trial-load-more:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .trial-end-note {
          text-align: center;
          padding: 14px 16px;
          font-size: 11px;
          color: #cbd5e1;
          font-style: italic;
        }
      `}</style>

      <div className="trial-list-wrap">

        {/* Header — count only, no "Grouped by status" label */}
        <div className="trial-list-header">
          <span className="trial-list-count">
            Showing <strong>{trials.length}</strong> of{" "}
            <strong>{totalCount.toLocaleString()}</strong> trials
          </span>
        </div>

        {/* Flat sorted list */}
        {sorted.map((trial, idx) => {
          const group = classifyStatus(trial.status ?? null);
          return (
            <div
              key={trial.nctId}
              className={`trial-card-item${selectedId === trial.nctId ? " active" : ""}`}
              onClick={() => onSelect(trial)}
              style={{ animationDelay: `${idx * 0.025}s` }}
            >
              <div className="trial-card-nct">{trial.nctId}</div>
              <div className="trial-card-title">{trial.title}</div>
              <div className="trial-card-meta">
                <StatusDot group={group} />
                {(trial.phases?.length ?? 0) > 0 &&
                  trial.phases!.map((p) => (
                    <PhaseBadge key={p} phase={p} />
                  ))}
              </div>
              {trial.sponsor && (
                <div className="trial-card-sponsor" title={trial.sponsor}>
                  {trial.sponsor}
                </div>
              )}
            </div>
          );
        })}

        {/* Load More */}
        {hasMore && (
          <button
            className="trial-load-more"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? (
              <>
                <span style={{
                  width: 12, height: 12,
                  border: "2px solid #cbd5e1",
                  borderTopColor: "#2563eb",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "trialPulse 0.8s linear infinite",
                }} />
                Loading…
              </>
            ) : (
              <>↓ Load next 10 trials</>
            )}
          </button>
        )}

        {!hasMore && trials.length > 0 && (
          <div className="trial-end-note">All {trials.length} trials shown</div>
        )}
      </div>
    </>
  );
}