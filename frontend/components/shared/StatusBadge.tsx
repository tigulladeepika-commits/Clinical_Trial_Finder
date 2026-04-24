// components/shared/StatusBadge.tsx
"use client";

import { getStatusColors } from "@/types/physician";

interface Props {
  status: string | null | undefined;
  size?: "sm" | "md";
}

export default function StatusBadge({ status, size = "sm" }: Props) {
  if (!status) return null;

  const { bg, fg, border } = getStatusColors(status);

  const dotColor = (() => {
    const s = status.toLowerCase();
    if (s === "recruiting") return fg;
    return "transparent";
  })();

  return (
    <span
      style={{
        display:       "inline-flex",
        alignItems:    "center",
        gap:           4,
        padding:       size === "sm" ? "2px 8px" : "3px 10px",
        borderRadius:  20,
        fontSize:      size === "sm" ? 10 : 11,
        fontWeight:    700,
        letterSpacing: "0.2px",
        textTransform: "uppercase",
        whiteSpace:    "nowrap",
        background:    bg,
        color:         fg,
        border:        `1px solid ${border}`,
      }}
    >
      {status.toLowerCase() === "recruiting" && (
        <span
          style={{
            width:        5,
            height:       5,
            borderRadius: "50%",
            background:   dotColor,
            flexShrink:   0,
          }}
        />
      )}
      {status}
    </span>
  );
}