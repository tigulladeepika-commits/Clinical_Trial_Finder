// components/shared/StatusBadge.tsx
"use client";

import React from "react";

interface Props {
  status?: string | null;
}

/**
 * Renders a coloured status pill for any trial / site status string.
 *
 * FIX: "N/A" and "NA" are no longer rendered as a raw grey "NA" string —
 * they get their own intentional "Not applicable" pill with neutral styling.
 */
export default function StatusBadge({ status }: Props) {
  if (!status) return null;

  const s = status.trim();

  // ── FIX: treat N/A variants as a proper "Not applicable" pill ────────────
  if (s === "N/A" || s === "NA" || s.toLowerCase() === "n/a") {
    return (
      <span
        style={{
          display:       "inline-flex",
          alignItems:    "center",
          padding:       "2px 7px",
          borderRadius:  20,
          fontSize:      10,
          fontWeight:    500,
          background:    "#f1f5f9",
          color:         "#64748b",
          border:        "1px solid #e2e8f0",
          letterSpacing: "0.2px",
          whiteSpace:    "nowrap",
        }}
      >
        Not applicable
      </span>
    );
  }

  // ── Map status string → colour scheme ────────────────────────────────────
  const lower = s.toLowerCase();

  let bg     = "#f1f5f9";
  let color  = "#475569";
  let border = "#e2e8f0";
  let dot: string | null = null;

  if (lower === "recruiting") {
    bg     = "#f0fdf4";
    color  = "#15803d";
    border = "#bbf7d0";
    dot    = "#15803d";
  } else if (lower.includes("active") && !lower.includes("not")) {
    bg     = "#eff6ff";
    color  = "#1d4ed8";
    border = "#bfdbfe";
    dot    = "#1d4ed8";
  } else if (lower === "completed") {
    bg     = "#f8fafc";
    color  = "#334155";
    border = "#e2e8f0";
  } else if (lower === "terminated" || lower === "withdrawn") {
    bg     = "#fef2f2";
    color  = "#b91c1c";
    border = "#fecaca";
  } else if (
    lower.includes("not yet") ||
    lower.includes("invitation") ||
    lower === "suspended"
  ) {
    bg     = "#fffbeb";
    color  = "#92400e";
    border = "#fde68a";
  }

  return (
    <span
      style={{
        display:       "inline-flex",
        alignItems:    "center",
        gap:           4,
        padding:       "2px 8px",
        borderRadius:  20,
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: "0.2px",
        textTransform: "uppercase",
        whiteSpace:    "nowrap",
        background:    bg,
        color:         color,
        border:        `1px solid ${border}`,
      }}
    >
      {/* Dot indicator for active statuses */}
      {dot && (
        <span
          style={{
            width:        5,
            height:       5,
            borderRadius: "50%",
            background:   dot,
            flexShrink:   0,
          }}
        />
      )}
      {s}
    </span>
  );
}
