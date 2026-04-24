// components/physicians/PhysicianCard.tsx
"use client";

import type { Physician } from "@/types/physician";

interface Props {
  physician: Physician;
  onContact: (physician: Physician) => void;
}

function initials(name: string): string {
  return name
    .replace(/^Dr\.\s*/i, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

export default function PhysicianCard({ physician, onContact }: Props) {
  return (
    <div
      style={{
        background:   "#fff",
        border:       "1px solid #e4e8f0",
        borderRadius: 10,
        padding:      "12px 14px",
        transition:   "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      {/* Top row: avatar + name + distance */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width:           36,
            height:          36,
            borderRadius:    "50%",
            background:      "linear-gradient(135deg, #eff6ff, #bfdbfe)",
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
            fontSize:        12,
            fontWeight:      700,
            color:           "#2563eb",
            flexShrink:      0,
            fontFamily:      "'DM Mono', monospace",
          }}
        >
          {initials(physician.name)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0d1117", lineHeight: 1.3 }}>
            {physician.name}
          </div>
          {physician.taxonomy_desc && (
            <div style={{ fontSize: 11, color: "#8b95a1", marginTop: 1 }}>
              {physician.taxonomy_desc}
            </div>
          )}
        </div>
        {physician.distance_miles != null && (
          <div
            style={{
              fontSize:    11,
              fontWeight:  600,
              color:       "#2563eb",
              fontFamily:  "'DM Mono', monospace",
              flexShrink:  0,
            }}
          >
            {physician.distance_miles.toFixed(1)} mi
          </div>
        )}
      </div>

      {/* Meta row */}
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          10,
          flexWrap:     "wrap",
          fontSize:     11,
          color:        "#8b95a1",
          borderTop:    "1px solid #e4e8f0",
          paddingTop:   8,
          marginTop:    2,
        }}
      >
        {physician.address && (
          <span>📍 {physician.address.split(",").slice(0, 2).join(",")}</span>
        )}
        {physician.phone && (
          <span>📞 {physician.phone}</span>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#cdd3e0" }}>
          NPI: {physician.npi}
        </span>
      </div>

      {/* Contact button */}
      <button
        onClick={() => onContact(physician)}
        style={{
          marginTop:    10,
          padding:      "7px 14px",
          background:   "#2563eb",
          color:        "#fff",
          border:       "none",
          borderRadius: 8,
          fontSize:     11,
          fontWeight:   700,
          cursor:       "pointer",
          fontFamily:   "inherit",
          letterSpacing:"0.3px",
          textTransform:"uppercase",
          transition:   "background 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#1d4ed8"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#2563eb"; }}
      >
        Contact Physician
      </button>
    </div>
  );
}