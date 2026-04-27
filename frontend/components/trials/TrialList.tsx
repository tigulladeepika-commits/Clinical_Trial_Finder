// components/trials/TrialList.tsx
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

// CRITICAL FIX for issue #3: Wrap with memo to prevent rerenders
// when parent state changes (e.g., right panel site/physician updates).
// TrialList only depends on its props, so memoization prevents unnecessary
// list redraws after several load-more clicks (when list is no longer virtualized).
function TrialList({
  trials,
  totalCount,
  selectedId,
  onSelect,
  hasMore,
  onLoadMore,
  loading,
}: Props) {
  const shown = trials.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>

      {/* ── Coloured header ── */}
      <div style={{
        padding:      "12px 16px",
        borderBottom: "1px solid #1e40af",
        flexShrink:   0,
        background:   "linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)",
      }}>
        <div style={{
          fontSize:      10,
          fontWeight:    700,
          color:         "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          marginBottom:  4,
        }}>
          Clinical Trials
        </div>

        {/* x of y trials */}
        <div style={{
          fontSize:   13,
          fontWeight: 500,
          color:      "rgba(255,255,255,0.9)",
          fontFamily: "'DM Mono', monospace",
        }}>
          {shown.toLocaleString()} of {totalCount.toLocaleString()} trials
        </div>
      </div>

      {/* ── List ── */}
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        {trials.map((trial) => {
          const isActive = selectedId === trial.nctId;
          return (
            <div
              key={trial.nctId}
              onClick={() => onSelect(trial)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelect(trial)}
              style={{
                padding:      "12px 16px",
                borderBottom: "1px solid #f0f2f7",
                cursor:       "pointer",
                background:   isActive ? "#eff6ff" : "#fff",
                borderLeft:   isActive ? "3px solid #2563eb" : "3px solid transparent",
                transition:   "background 0.12s",
                outline:      "none",
                minWidth:     0,
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#f6f7fb";
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#fff";
              }}
            >
              {/* NCT ID + badges */}
              <div style={{
                display:      "flex",
                alignItems:   "center",
                gap:          5,
                marginBottom: 5,
                flexWrap:     "wrap",
                minWidth:     0,
              }}>
                <span style={{
                  fontSize:      10,
                  fontWeight:    700,
                  color:         isActive ? "#2563eb" : "#8b95a1",
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  fontFamily:    "'DM Mono', monospace",
                  flexShrink:    0,
                }}>
                  {trial.nctId}
                </span>

                <StatusBadge status={trial.status} />

                {trial.phases.map((p) =>
                  p === "N/A" || p === "NA" ? (
                    <span key={p} style={{
                      display:      "inline-flex",
                      padding:      "2px 7px",
                      borderRadius: 20,
                      fontSize:     10,
                      fontWeight:   500,
                      background:   "#f1f5f9",
                      color:        "#64748b",
                      border:       "1px solid #e2e8f0",
                      flexShrink:   0,
                    }}>
                      Not applicable
                    </span>
                  ) : (
                    <span key={p} style={{
                      display:      "inline-flex",
                      padding:      "2px 8px",
                      borderRadius: 20,
                      fontSize:     10,
                      fontWeight:   700,
                      background:   "#f1f5f9",
                      color:        "#475569",
                      border:       "1px solid #e2e8f0",
                      fontFamily:   "'DM Mono', monospace",
                      flexShrink:   0,
                    }}>
                      {p}
                    </span>
                  )
                )}
              </div>

              {/* Title — 2-line clamp */}
              <div style={{
                fontSize:        13,
                fontWeight:      500,
                color:           "#0d1117",
                lineHeight:      1.45,
                marginBottom:    5,
                display:         "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical" as React.CSSProperties["WebkitBoxOrient"],
                overflow:        "hidden",
                wordBreak:       "break-word",
              }}>
                {trial.title}
              </div>

              {/* Sponsor · sites */}
              <div style={{
                fontSize:   11,
                color:      "#8b95a1",
                display:    "flex",
                alignItems: "center",
                gap:        4,
                minWidth:   0,
              }}>
                {trial.sponsor && (
                  <strong style={{
                    color:        "#4b5563",
                    fontWeight:   500,
                    overflow:     "hidden",
                    whiteSpace:   "nowrap",
                    textOverflow: "ellipsis",
                    flexShrink:   1,
                    minWidth:     0,
                  }}>
                    {trial.sponsor}
                  </strong>
                )}
                <span style={{ flexShrink: 0 }}>
                  {trial.sponsor ? "· " : ""}
                  {trial.locations.length} site{trial.locations.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          );
        })}

        {/* Load more */}
        {hasMore && (
          <button
            onClick={onLoadMore}
            disabled={loading}
            style={{
              display:      "block",
              width:        "calc(100% - 32px)",
              margin:       "12px 16px",
              padding:      10,
              border:       "1px dashed #cdd3e0",
              borderRadius: 8,
              background:   "transparent",
              fontSize:     13,
              fontWeight:   500,
              color:        "#4b5563",
              cursor:       loading ? "not-allowed" : "pointer",
              fontFamily:   "inherit",
              transition:   "all 0.15s",
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget;
              btn.style.background  = "#f6f7fb";
              btn.style.borderColor = "#2563eb";
              btn.style.color       = "#2563eb";
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget;
              btn.style.background  = "transparent";
              btn.style.borderColor = "#cdd3e0";
              btn.style.color       = "#4b5563";
            }}
          >
            {loading ? "Loading…" : "Load more trials"}
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(TrialList);