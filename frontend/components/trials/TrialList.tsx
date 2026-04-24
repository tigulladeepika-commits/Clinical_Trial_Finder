// components/trials/TrialList.tsx
"use client";

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

export default function TrialList({
  trials,
  totalCount,
  selectedId,
  onSelect,
  hasMore,
  onLoadMore,
  loading,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding:      "14px 16px 10px",
          borderBottom: "1px solid #e4e8f0",
          flexShrink:   0,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: "#8b95a1", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Clinical Trials
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#0d1117", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
          {totalCount.toLocaleString()}
          <span style={{ fontSize: 13, fontWeight: 400, color: "#8b95a1", marginLeft: 6 }}>results</span>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
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
                borderBottom: "1px solid #e4e8f0",
                cursor:       "pointer",
                background:   isActive ? "#eff6ff" : "#fff",
                borderLeft:   isActive ? "3px solid #2563eb" : "3px solid transparent",
                transition:   "background 0.12s",
                outline:      "none",
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#f6f7fb";
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "#fff";
              }}
            >
              {/* Badges row */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
                <span style={{
                  fontSize:      10,
                  fontWeight:    700,
                  color:         isActive ? "#2563eb" : "#8b95a1",
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                  fontFamily:    "'DM Mono', monospace",
                }}>
                  {trial.nctId}
                </span>
                <StatusBadge status={trial.status} />
                {trial.phases.map((p) => (
                  <span
                    key={p}
                    style={{
                      display:       "inline-flex",
                      padding:       "2px 8px",
                      borderRadius:  20,
                      fontSize:      10,
                      fontWeight:    700,
                      background:    "#f1f5f9",
                      color:         "#475569",
                      border:        "1px solid #e2e8f0",
                      fontFamily:    "'DM Mono', monospace",
                      letterSpacing: "0.2px",
                    }}
                  >
                    {p}
                  </span>
                ))}
              </div>

              {/* Title */}
              <div style={{
                fontSize:         12,
                fontWeight:       500,
                color:            "#0d1117",
                lineHeight:       1.45,
                marginBottom:     4,
                display:          "-webkit-box",
                WebkitLineClamp:  2,
                WebkitBoxOrient:  "vertical",
                overflow:         "hidden",
              }}>
                {trial.title}
              </div>

              {/* Sponsor + location count */}
              <div style={{ fontSize: 11, color: "#8b95a1" }}>
                {trial.sponsor && (
                  <strong style={{ color: "#4b5563", fontWeight: 500 }}>{trial.sponsor}</strong>
                )}
                {trial.sponsor && " · "}
                {trial.locations.length} site{trial.locations.length !== 1 ? "s" : ""}
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
              btn.style.background    = "#f6f7fb";
              btn.style.borderColor   = "#2563eb";
              btn.style.color         = "#2563eb";
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget;
              btn.style.background    = "transparent";
              btn.style.borderColor   = "#cdd3e0";
              btn.style.color         = "#4b5563";
            }}
          >
            {loading ? "Loading…" : "Load more trials"}
          </button>
        )}
      </div>
    </div>
  );
}