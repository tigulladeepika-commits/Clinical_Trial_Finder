// components/shared/StatusBadge.tsx
// Provides the statusDotColor() helper used by TrialSiteMap to colour
// map markers, and a StatusBadge component for inline use.

"use client";

import React from "react";

/**
 * Maps a raw ClinicalTrials.gov status string to a hex colour.
 *
 * The API returns human-readable strings like:
 *   "Recruiting", "Not yet recruiting", "Active, not recruiting",
 *   "Completed", "Terminated", "Withdrawn", "Suspended",
 *   "Enrolling by invitation"
 *
 * We uppercase + normalise underscores → spaces so both snake_case
 * variants (if they ever appear) and space-separated variants are handled.
 *
 * Used by TrialSiteMap for marker colours and by StatusBadge for pill colours.
 *
 * FIX: previous version compared against UPPER_SNAKE_CASE strings
 * ("NOT_YET_RECRUITING") but the API returns space-separated strings
 * ("Not yet recruiting"). All comparisons now use the uppercased,
 * underscore-normalised form so both variants match correctly.
 */
export function statusDotColor(status: string | null | undefined): string {
  // Uppercase and replace underscores with spaces so "NOT_YET_RECRUITING"
  // and "Not yet recruiting" both become "NOT YET RECRUITING".
  const s = (status ?? "").toUpperCase().replace(/_/g, " ").trim();

  if (s === "RECRUITING" || s === "ENROLLING BY INVITATION")  return "#16a34a"; // green
  if (s === "NOT YET RECRUITING")                             return "#4ade80"; // light green
  if (s === "ACTIVE, NOT RECRUITING")                         return "#2563eb"; // blue
  if (s === "COMPLETED")                                      return "#94a3b8"; // grey
  if (s === "TERMINATED")                                     return "#ef4444"; // red
  if (s === "WITHDRAWN" || s === "SUSPENDED")                 return "#f59e0b"; // amber

  return "#94a3b8"; // default grey for unknown / null
}

type Props = {
  status:     string | null | undefined;
  className?: string;
};

/**
 * Small coloured pill badge. Pass className to override styles.
 */
export default function StatusBadge({ status, className }: Props) {
  if (!status) return null;

  const color = statusDotColor(status);
  // Replace underscores with spaces for the display label
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