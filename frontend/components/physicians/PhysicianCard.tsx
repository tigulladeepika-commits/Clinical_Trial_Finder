// components/physicians/PhysicianCard.tsx
// Updated: improved design with universal color conventions, better layout.

"use client";

import React, { useState } from "react";
import LeadCaptureModal    from "@/components/shared/LeadCaptureModal";
import type { Physician }  from "@/types/physician";

type Props = {
  physician:  Physician;
  index:      number;
  nctId:      string;
  siteName:   string | null;
  isSelected: boolean;
  onSelect:   (p: Physician) => void;
};

export default function PhysicianCard({
  physician, index, nctId, siteName, isSelected, onSelect,
}: Props) {
  const [showLead, setShowLead] = useState(false);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        .phys-card {
          background: #fff;
          border: 1px solid #f1f5f9;
          border-radius: 12px;
          padding: 14px 16px;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-family: 'Sora', sans-serif;
          border-left: 3px solid transparent;
        }
        .phys-card:hover {
          border-color: #bfdbfe;
          border-left-color: #2563eb;
          background: #f0f9ff;
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(37,99,235,0.08);
        }
        .phys-card.selected {
          background: #eff6ff;
          border-color: #bfdbfe;
          border-left-color: #2563eb;
          box-shadow: 0 2px 10px rgba(37,99,235,0.12);
        }
        .phys-capture-btn {
          padding: 5px 13px;
          border-radius: 7px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #2563eb;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.12s;
          font-family: 'Sora', sans-serif;
        }
        .phys-capture-btn:hover {
          background: #2563eb;
          color: #fff;
          border-color: #2563eb;
        }
      `}</style>

      <div
        className={`phys-card${isSelected ? " selected" : ""}`}
        onClick={() => onSelect(physician)}
      >
        {/* Row 1: index + name + distance */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {/* Number badge */}
          <div style={{
            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
            background: isSelected ? "#2563eb" : "#f1f5f9",
            color:      isSelected ? "#fff" : "#64748b",
            fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'IBM Plex Mono', monospace",
            transition: "all 0.15s",
          }}>{index + 1}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: "#0f172a",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {physician.name}
            </div>
            {physician.taxonomy_desc && (
              <div style={{ fontSize: 11, color: "#2563eb", marginTop: 1, fontWeight: 600 }}>
                {physician.taxonomy_desc}
              </div>
            )}
          </div>

          {physician.distance_miles != null && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "flex-end",
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: 13, fontWeight: 700, color: "#0f172a",
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                {physician.distance_miles}
              </span>
              <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.3px" }}>
                MI
              </span>
            </div>
          )}
        </div>

        {/* Row 2: address */}
        {physician.address && (
          <div style={{
            fontSize: 12, color: "#64748b",
            paddingLeft: 36, lineHeight: 1.45,
            display: "flex", alignItems: "flex-start", gap: 4,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1.5 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {physician.address}
          </div>
        )}

        {/* Row 3: phone + NPI + capture button */}
        <div style={{
          display: "flex", alignItems: "center",
          gap: 8, paddingLeft: 36, flexWrap: "wrap",
        }}>
          {physician.phone && (
            <a
              href={`tel:${physician.phone}`}
              style={{
                fontSize: 12, color: "#2563eb",
                textDecoration: "none", fontWeight: 600,
                display: "flex", alignItems: "center", gap: 3,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.5 2 2 0 0 1 3.6 1.3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2z"/>
              </svg>
              {physician.phone}
            </a>
          )}
          <span style={{
            fontSize: 10, color: "#94a3b8",
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            NPI {physician.npi}
          </span>

          <div style={{ flex: 1 }} />

          <button
            className="phys-capture-btn"
            onClick={(e) => { e.stopPropagation(); setShowLead(true); }}
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