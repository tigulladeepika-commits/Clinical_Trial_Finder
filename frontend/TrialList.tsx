"use client";

import { Trial } from "./types";

type Props = {
  trials: Trial[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (trial: Trial) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loading: boolean;
};

function statusBadgeClass(status: string | undefined) {
  const s = (status || "").toUpperCase();
  if (s === "RECRUITING") return "badge badge-status-recruiting";
  if (s.includes("ACTIVE")) return "badge badge-status-active";
  if (s === "COMPLETED") return "badge badge-status-completed";
  return "badge badge-status-default";
}

export default function TrialList({
  trials, totalCount, selectedId, onSelect, hasMore, onLoadMore, loading,
}: Props) {
  return (
    <div>
      <div className="trials-panel-header">
        <div className="trials-count">
          Showing <strong>{trials.length}</strong> of <strong>{totalCount}</strong> trials
        </div>
      </div>

      {trials.map((trial) => (
        <div
          key={trial.nctId}
          className={`trial-card${selectedId === trial.nctId ? " active" : ""}`}
          onClick={() => onSelect(trial)}
        >
          <div className="trial-nct">{trial.nctId}</div>
          <div className="trial-title">{trial.title}</div>
          <div className="trial-meta">
            <span className={statusBadgeClass(trial.status)}>
              {trial.status || "Unknown"}
            </span>
            {trial.phases?.length > 0 && (
              <span className="badge badge-phase">{trial.phases.join(", ")}</span>
            )}
            {trial.locations?.length > 0 && (
              <span className="badge badge-sites">📍 {trial.locations.length} sites</span>
            )}
          </div>
        </div>
      ))}

      {hasMore && (
        <button className="load-more-btn" onClick={onLoadMore} disabled={loading}>
          {loading ? "Loading…" : `Load more trials`}
        </button>
      )}
    </div>
  );
}