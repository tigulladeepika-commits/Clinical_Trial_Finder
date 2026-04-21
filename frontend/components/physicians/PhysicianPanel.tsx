// components/physicians/PhysicianPanel.tsx
// Full physician discovery panel — shown in the right detail column
// after a user clicks "Find physicians near this site".
// Contains: header with site info, radius + specialty filters,
// tab switcher (map / list), stats strip, results.

"use client";

import React, { useState, useCallback } from "react";
import PhysicianMap  from "./PhysicianMap";
import PhysicianCard from "./PhysicianCard";
import type { Physician }    from "@/types/physician";
import type { SelectedSite } from "@/types/physician";

type Props = {
  site:        SelectedSite;
  physicians:  Physician[];
  total:       number;
  loading:     boolean;
  error:       string | null;
  searched:    boolean;
  onSearch:    (radius: number, specialty: string) => void;
  onBack:      () => void;           // go back to trial site map
};

type Tab = "map" | "list";

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

export default function PhysicianPanel({
  site, physicians, total, loading, error, searched, onSearch, onBack,
}: Props) {
  const [tab,          setTab]         = useState<Tab>("map");
  const [radius,       setRadius]      = useState(25);
  const [specialty,    setSpecialty]   = useState("");
  const [selectedNpi,  setSelectedNpi] = useState<string | null>(null);

  const handleSearch = useCallback(() => {
    onSearch(radius, specialty.trim());
  }, [radius, specialty, onSearch]);

  const handleSelectPhysician = useCallback((p: Physician) => {
    setSelectedNpi((prev) => (prev === p.npi ? null : p.npi));
    setTab("list");
  }, []);

  const selectedPhysician = physicians.find((p) => p.npi === selectedNpi) ?? null;
  const siteLabel = [site.facility, site.city, site.state].filter(Boolean).join(", ") || "Selected site";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding:      "14px 24px",
        borderBottom: "1px solid var(--gray-100, #f1f5f9)",
        background:   "var(--white, #fff)",
        flexShrink:   0,
      }}>
        {/* Back button + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <button
            onClick={onBack}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 18, color: "var(--gray-400, #94a3b8)", padding: 0, lineHeight: 1,
            }}
            title="Back to trial sites"
          >←</button>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gray-800, #1e293b)" }}>
            Physicians near site
          </div>
        </div>

        {/* Site context chip */}
        <div style={{
          display:      "inline-flex",
          alignItems:   "center",
          gap:          6,
          padding:      "4px 10px",
          borderRadius: 20,
          background:   "var(--blue-50, #eff6ff)",
          border:       "1px solid var(--blue-100, #dbeafe)",
          fontSize:     11,
          color:        "var(--blue-600, #2563eb)",
          fontWeight:   600,
          marginBottom: 12,
          maxWidth:     "100%",
        }}>
          <span style={{ fontSize: 13 }}>📍</span>
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{siteLabel}</span>
        </div>

        {/* Filter row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Radius selector */}
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            style={{
              padding:      "7px 10px",
              borderRadius: 8,
              border:       "1px solid var(--gray-200, #e2e8f0)",
              fontSize:     13,
              color:        "var(--gray-700, #334155)",
              background:   "var(--gray-50, #f8fafc)",
              cursor:       "pointer",
            }}
          >
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>{r} miles</option>
            ))}
          </select>

          {/* Specialty input */}
          <input
            type="text"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Specialty (optional)"
            style={{
              flex:         1,
              minWidth:     120,
              padding:      "7px 12px",
              borderRadius: 8,
              border:       "1px solid var(--gray-200, #e2e8f0)",
              fontSize:     13,
              color:        "var(--gray-700, #334155)",
              background:   "var(--gray-50, #f8fafc)",
              outline:      "none",
            }}
          />

          {/* Search button */}
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              padding:      "7px 18px",
              borderRadius: 8,
              border:       "none",
              background:   loading ? "var(--gray-300, #cbd5e1)" : "var(--blue-600, #2563eb)",
              color:        "#fff",
              fontSize:     13,
              fontWeight:   700,
              cursor:       loading ? "not-allowed" : "pointer",
              whiteSpace:   "nowrap",
              transition:   "background 0.15s",
            }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {/* ── Stats strip (only when results exist) ───────────────────────────── */}
      {searched && !loading && physicians.length > 0 && (
        <div style={{
          display:      "flex",
          borderBottom: "1px solid var(--gray-100, #f1f5f9)",
          flexShrink:   0,
        }}>
          {[
            { label: "Found",    value: total },
            { label: "Showing",  value: physicians.length },
            { label: "Radius",   value: `${radius} mi` },
          ].map((s, i, arr) => (
            <div key={i} style={{
              flex: 1, padding: "12px 0", textAlign: "center",
              borderRight: i < arr.length - 1 ? "1px solid var(--gray-100, #f1f5f9)" : "none",
            }}>
              <div style={{
                fontSize: 20, fontWeight: 700, lineHeight: 1,
                color: "var(--gray-800, #1e293b)",
              }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "var(--gray-400, #94a3b8)", marginTop: 3, fontWeight: 500 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      {searched && !loading && physicians.length > 0 && (
        <div style={{
          display: "flex", borderBottom: "1px solid var(--gray-100, #f1f5f9)",
          background: "var(--white, #fff)", flexShrink: 0,
        }}>
          {(["map", "list"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "10px 0",
                border: "none", borderBottom: tab === t ? "2px solid var(--blue-600, #2563eb)" : "2px solid transparent",
                background: "transparent",
                fontSize: 13, fontWeight: tab === t ? 700 : 500,
                color: tab === t ? "var(--blue-600, #2563eb)" : "var(--gray-400, #94a3b8)",
                cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s",
              }}
            >
              {t === "map" ? "🗺 Map" : "☰ List"}
            </button>
          ))}
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>

        {/* Loading */}
        {loading && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 12, paddingTop: 48,
            color: "var(--gray-400, #94a3b8)",
          }}>
            <div className="spinner" />
            <p style={{ fontSize: 14 }}>Searching physicians…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            padding: "14px 16px", borderRadius: 10,
            background: "#fee2e2", color: "#dc2626",
            fontSize: 13, border: "1px solid #fecaca",
          }}>{error}</div>
        )}

        {/* Empty prompt (before first search) */}
        {!loading && !error && !searched && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 10, paddingTop: 48, textAlign: "center",
            color: "var(--gray-400, #94a3b8)",
          }}>
            <div style={{ fontSize: 40 }}>🩺</div>
            <p style={{ fontSize: 14, fontWeight: 500 }}>
              Set your radius and press Search<br />to find physicians near this site
            </p>
          </div>
        )}

        {/* No results */}
        {!loading && !error && searched && physicians.length === 0 && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 10, paddingTop: 48, textAlign: "center",
            color: "var(--gray-400, #94a3b8)",
          }}>
            <div style={{ fontSize: 40 }}>🔍</div>
            <p style={{ fontSize: 14, fontWeight: 500 }}>
              No physicians found within {radius} miles.
            </p>
            <p style={{ fontSize: 13 }}>Try increasing the radius or broadening the specialty.</p>
          </div>
        )}

        {/* Map view */}
        {!loading && !error && physicians.length > 0 && tab === "map" && (
          <PhysicianMap
            physicians={physicians}
            selectedSite={site}
            selectedNpi={selectedNpi}
            onSelect={handleSelectPhysician}
          />
        )}

        {/* List view */}
        {!loading && !error && physicians.length > 0 && tab === "list" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {physicians.map((p, i) => (
              <PhysicianCard
                key={p.npi}
                physician={p}
                index={i}
                nctId={site.nct_id}
                siteName={site.facility}
                isSelected={p.npi === selectedNpi}
                onSelect={handleSelectPhysician}
              />
            ))}
            {total > physicians.length && (
              <p style={{
                textAlign: "center", fontSize: 12,
                color: "var(--gray-400, #94a3b8)", paddingTop: 8,
              }}>
                Showing {physicians.length} of {total} physicians within {radius} miles
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}