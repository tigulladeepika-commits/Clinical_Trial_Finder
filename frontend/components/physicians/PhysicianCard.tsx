// components/physicians/PhysicianCard.tsx
// Single physician list item — shows name, specialty, address,
// distance, phone and a "Capture Lead" button.

"use client";

import React, { useState }    from "react";
import LeadCaptureModal        from "@/components/shared/LeadCaptureModal";
import type { Physician }      from "@/types/physician";

type Props = {
  physician:  Physician;
  index:      number;
  nctId:      string;
  siteName:   string | null;
  isSelected: boolean;
  onSelect:   (p: Physician) => void;
};

export default function PhysicianCard({
  physician,
  index,
  nctId,
  siteName,
  isSelected,
  onSelect,
}: Props) {
  const [showLead, setShowLead] = useState(false);

  const cardStyle: React.CSSProperties = {
    background:   isSelected ? "var(--blue-50, #eff6ff)" : "var(--white, #fff)",
    border:       `1px solid ${isSelected ? "var(--blue-200, #bfdbfe)" : "var(--gray-100, #f1f5f9)"}`,
    borderRadius: 12,
    padding:      "14px 16px",
    cursor:       "pointer",
    transition:   "all 0.15s",
    display:      "flex",
    flexDirection:"column",
    gap:          8,
  };

  return (
    <>
      <div
        style={cardStyle}
        onClick={() => onSelect(physician)}
        onMouseEnter={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLDivElement).style.borderColor = "var(--blue-200, #bfdbfe)";
            (e.currentTarget as HTMLDivElement).style.background  = "var(--gray-50, #f8fafc)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLDivElement).style.borderColor = "var(--gray-100, #f1f5f9)";
            (e.currentTarget as HTMLDivElement).style.background  = "var(--white, #fff)";
          }
        }}
      >
        {/* Row 1: index + name + distance */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {/* Number badge */}
          <div style={{
            width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
            background: isSelected ? "var(--blue-600, #2563eb)" : "var(--gray-200, #e2e8f0)",
            color:      isSelected ? "#fff" : "var(--gray-600, #475569)",
            fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{index + 1}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700,
              color: "var(--gray-800, #1e293b)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {physician.name}
            </div>
            {physician.taxonomy_desc && (
              <div style={{ fontSize: 12, color: "var(--blue-500, #3b82f6)", marginTop: 1, fontWeight: 500 }}>
                {physician.taxonomy_desc}
              </div>
            )}
          </div>

          {physician.distance_miles != null && (
            <div style={{
              fontSize: 11, fontWeight: 700, color: "var(--gray-500, #64748b)",
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {physician.distance_miles} mi
            </div>
          )}
        </div>

        {/* Row 2: address */}
        {physician.address && (
          <div style={{
            fontSize: 12, color: "var(--gray-500, #64748b)",
            paddingLeft: 34, lineHeight: 1.45,
          }}>
            📍 {physician.address}
          </div>
        )}

        {/* Row 3: phone + NPI + lead button */}
        <div style={{
          display: "flex", alignItems: "center",
          gap: 10, paddingLeft: 34, flexWrap: "wrap",
        }}>
          {physician.phone && (
            <a
              href={`tel:${physician.phone}`}
              style={{ fontSize: 12, color: "var(--blue-500, #3b82f6)", textDecoration: "none", fontWeight: 500 }}
              onClick={(e) => e.stopPropagation()}
            >
              📞 {physician.phone}
            </a>
          )}
          <span style={{ fontSize: 11, color: "var(--gray-400, #94a3b8)" }}>
            NPI {physician.npi}
          </span>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          <button
            onClick={(e) => { e.stopPropagation(); setShowLead(true); }}
            style={{
              padding:      "5px 12px",
              borderRadius: 6,
              border:       "1px solid var(--blue-200, #bfdbfe)",
              background:   "var(--blue-50, #eff6ff)",
              color:        "var(--blue-600, #2563eb)",
              fontSize:     11,
              fontWeight:   700,
              cursor:       "pointer",
              whiteSpace:   "nowrap",
              transition:   "all 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--blue-600, #2563eb)";
              (e.currentTarget as HTMLButtonElement).style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--blue-50, #eff6ff)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--blue-600, #2563eb)";
            }}
          >
            + Capture Lead
          </button>
        </div>
      </div>

      {showLead && (
        <LeadCaptureModal
          physician={physician}
          nctId={nctId}
          siteName={siteName}
          onClose={() => setShowLead(false)}
        />
      )}
    </>
  );
}