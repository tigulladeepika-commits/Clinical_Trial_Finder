"use client";

import React from "react";

interface Props {
  status?: string | null;
}

export default function StatusBadge({ status }: Props) {
  if (!status) return null;

  const s = status.trim();

  if (s === "N/A" || s === "NA" || s.toLowerCase() === "n/a") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center",
        padding: "2px 8px", borderRadius: 20,
        fontSize: 10, fontWeight: 500,
        background: "var(--surface-2)", color: "var(--muted)",
        border: "1px solid var(--border)",
        letterSpacing: "0.2px", whiteSpace: "nowrap",
      }}>
        Not applicable
      </span>
    );
  }

  const lower = s.toLowerCase();

  let bg     = "var(--surface-2)";
  let color  = "var(--muted)";
  let border = "var(--border)";
  let dot: string | null = null;

  if (lower === "recruiting") {
    bg = "var(--green-50)"; color = "#065f46"; border = "var(--green-100)";
    dot = "#059669";
  } else if (lower.includes("active") && !lower.includes("not")) {
    bg = "var(--blue-50)"; color = "#1e40af"; border = "#bfdbfe";
    dot = "#2563eb";
  } else if (lower === "completed") {
    bg = "var(--surface-2)"; color = "var(--ink-3)"; border = "var(--border)";
  } else if (lower === "terminated" || lower === "withdrawn") {
    bg = "var(--coral-50)"; color = "#991b1b"; border = "#fecaca";
  } else if (lower.includes("not yet") || lower.includes("invitation") || lower === "suspended") {
    bg = "var(--amber-50)"; color = "#92400e"; border = "#fde68a";
    dot = "#d97706";
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.2px",
      textTransform: "uppercase", whiteSpace: "nowrap",
      background: bg, color, border: `1px solid ${border}`,
    }}>
      {dot && (
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: dot, flexShrink: 0,
        }} />
      )}
      {s}
    </span>
  );
}