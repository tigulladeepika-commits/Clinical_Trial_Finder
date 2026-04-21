// components/shared/StatusBadge.tsx
// Provides the statusDotColor() helper used by TrialSiteMap to colour
// map markers, and a StatusBadge component for inline use.

"use client";

import React from "react";

/**
 * Maps a raw ClinicalTrials.gov status string to a hex colour.
 * Used by TrialSiteMap for marker colours and by StatusBadge for pill colours.
 */
export function statusDotColor(status: string | null | undefined): string {
  const s = (status ?? "").toUpperCase().trim();

  if (s === "RECRUITING" || s === "ENROLLING_BY_INVITATION") return "#16a34a"; // green
  if (s === "NOT_YET_RECRUITING")                             return "#4ade80"; // light green
  if (s.includes("ACTIVE") && !s.includes("NOT"))            return "#2563eb"; // blue
  if (s === "COMPLETED")                                      return "#94a3b8"; // grey
  if (s === "TERMINATED")                                     return "#ef4444"; // red
  if (s === "WITHDRAWN" || s === "SUSPENDED")                 return "#f59e0b"; // amber

  return "#94a3b8"; // default grey
}

type Props = {
  status:    string | null | undefined;
  className?: string;
};

/**
 * Small coloured pill badge. Pass className to override styles.
 */
export default function StatusBadge({ status, className }: Props) {
  if (!status) return null;

  const color = statusDotColor(status);
  const label = status.replace(/_/g, " ");

  return (
    <span
      className={className}
      style={{
        display:       "inline-block",
        padding:       "3px 10px",
        borderRadius:  20,
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        background:    `${color}18`,
        color,
        border:        `1px solid ${color}50`,
      }}
    >
      {label}
    </span>
  );
}