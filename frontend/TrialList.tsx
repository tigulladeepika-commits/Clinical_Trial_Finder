"use client";

import { Trial } from "./types";

type TrialListProps = {
  trials: Trial[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (trial: Trial) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
};

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  RECRUITING: { bg: "#052e16", color: "#4ade80" },
  NOT_YET_RECRUITING: { bg: "#422006", color: "#fb923c" },
  ACTIVE_NOT_RECRUITING: { bg: "#0c1a4f", color: "#60a5fa" },
  COMPLETED: { bg: "#1c1c1c", color: "#9ca3af" },
  TERMINATED: { bg: "#2d0f0f", color: "#f87171" },
  WITHDRAWN: { bg: "#2d0f0f", color: "#f87171" },
};

function StatusBadge({ status }: { status: string }) {
  const key = (status || "").toUpperCase().replace(/\s+/g, "_");
  const style = STATUS_BADGE[key] ?? { bg: "#1e1b4b", color: "#a78bfa" };

  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "2px 8px",
        borderRadius: "999px",
        textTransform: "uppercase",
        border: `1px solid ${style.color}22`,
      }}
    >
      {status?.replace(/_/g, " ") ?? "Unknown"}
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
}: TrialListProps) {
  return (
    <div className="trial-list-container">
      <div className="trial-list-header">
        <span className="trial-list-count">
          <strong>{totalCount.toLocaleString()}</strong> trials found
        </span>
        <span className="trial-list-sub">Showing {trials.length}</span>
      </div>

      <div className="trial-list">
        {trials.map((trial) => {
          const isSelected = trial.nctId === selectedId;
          const siteCount = trial.locations?.length ?? 0;
          const phases = trial.phases?.join(", ") ?? "";

          return (
            <div
              key={trial.nctId}
              className={`trial-card ${isSelected ? "trial-card--selected" : ""}`}
              onClick={() => onSelect(trial)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => event.key === "Enter" && onSelect(trial)}
            >
              <div className="trial-card-top">
                <div className="trial-card-id">{trial.nctId}</div>
                <StatusBadge status={trial.status} />
              </div>

              <div className="trial-card-title">{trial.title}</div>

              <div className="trial-card-meta">
                {trial.sponsor && (
                  <span className="meta-item">
                    <span className="meta-icon">Sponsor</span> {trial.sponsor}
                  </span>
                )}
                {phases && (
                  <span className="meta-item">
                    <span className="meta-icon">Phase</span> {phases.replace(/PHASE/gi, "Phase ")}
                  </span>
                )}
                {siteCount > 0 && (
                  <span className="meta-item">
                    <span className="meta-icon">Sites</span> {siteCount} site{siteCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {isSelected && (
                <div className="trial-card-selected-hint">
                  View site locations on the map below
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          className="btn-load-more"
          onClick={onLoadMore}
          disabled={loading}
        >
          {loading ? "Loading..." : "Load More Trials"}
        </button>
      )}
    </div>
  );
}
