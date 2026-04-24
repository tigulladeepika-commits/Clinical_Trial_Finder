// components/physicians/PhysicianPanel.tsx
"use client";

import { useState, useCallback }  from "react";
import PhysicianCard              from "@/components/physicians/PhysicianCard";
import LeadCaptureModal           from "@/components/shared/LeadCaptureModal";
import type { Physician, SelectedSite } from "@/types/physician";

interface Props {
  site:       SelectedSite;
  physicians: Physician[];
  total:      number;
  loading:    boolean;
  error:      string | null;
  searched:   boolean;
  hasMore:    boolean;
  onSearch:   (radius: number, specialty: string) => void;
  onLoadMore: () => void;
  onBack:     () => void;
}

const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

export default function PhysicianPanel({
  site,
  physicians,
  total,
  loading,
  error,
  searched,
  hasMore,
  onSearch,
  onLoadMore,
  onBack,
}: Props) {
  const [radius,    setRadius]    = useState<number>(25);
  const [specialty, setSpecialty] = useState(site.condition ?? "");
  const [leadPhys,  setLeadPhys]  = useState<Physician | null>(null);

  // Trigger a new search when the user changes radius / specialty
  const handleSearch = useCallback(() => {
    onSearch(radius, specialty);
  }, [radius, specialty, onSearch]);

  // Show lead modal before Load More (as per original spec)
  const handleLoadMore = useCallback(() => {
    if (!physicians.length) { onLoadMore(); return; }
    // Pick first physician as the "anchor" for the lead form
    setLeadPhys(physicians[0]);
  }, [physicians, onLoadMore]);

  const handleLeadClose = useCallback(() => {
    setLeadPhys(null);
    onLoadMore();   // proceed to show more cards after modal closes
  }, [onLoadMore]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div
        style={{
          padding:      "12px 20px",
          borderBottom: "1px solid #e4e8f0",
          background:   "#fff",
          flexShrink:   0,
          display:      "flex",
          alignItems:   "center",
          gap:          10,
        }}
      >
        <button
          onClick={onBack}
          style={{
            height:       32,
            padding:      "0 12px",
            background:   "transparent",
            border:       "1px solid #e4e8f0",
            borderRadius: 8,
            fontSize:     12,
            fontWeight:   500,
            color:        "#4b5563",
            cursor:       "pointer",
            fontFamily:   "inherit",
            display:      "flex",
            alignItems:   "center",
            gap:          4,
            flexShrink:   0,
            transition:   "all 0.15s",
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.background  = "#f6f7fb";
            btn.style.borderColor = "#cdd3e0";
            btn.style.color       = "#0d1117";
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.background  = "transparent";
            btn.style.borderColor = "#e4e8f0";
            btn.style.color       = "#4b5563";
          }}
        >
          ← Back to Sites
        </button>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0d1117", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {site.facility || "Site"}
          </div>
          <div style={{ fontSize: 11, color: "#8b95a1", marginTop: 1 }}>
            {[site.city, site.state].filter(Boolean).join(", ")} · Nearby physicians
          </div>
        </div>
      </div>

      {/* Filter controls */}
      <div
        style={{
          padding:      "10px 20px",
          borderBottom: "1px solid #e4e8f0",
          background:   "#fff",
          flexShrink:   0,
          display:      "flex",
          gap:          8,
          alignItems:   "center",
          flexWrap:     "wrap",
        }}
      >
        <input
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          placeholder="Specialty / condition"
          style={{
            flex:         "2 1 140px",
            height:       32,
            padding:      "0 10px",
            border:       "1px solid #e4e8f0",
            borderRadius: 8,
            fontSize:     12,
            color:        "#0d1117",
            background:   "#f6f7fb",
            outline:      "none",
            fontFamily:   "inherit",
          }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <select
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          style={{
            flex:         "0 0 100px",
            height:       32,
            padding:      "0 8px",
            border:       "1px solid #e4e8f0",
            borderRadius: 8,
            fontSize:     12,
            color:        "#0d1117",
            background:   "#f6f7fb",
            outline:      "none",
            cursor:       "pointer",
            fontFamily:   "inherit",
          }}
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>{r} mi radius</option>
          ))}
        </select>
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{
            height:       32,
            padding:      "0 14px",
            background:   loading ? "#cdd3e0" : "#2563eb",
            color:        "#fff",
            border:       "none",
            borderRadius: 8,
            fontSize:     12,
            fontWeight:   600,
            cursor:       loading ? "not-allowed" : "pointer",
            fontFamily:   "inherit",
            flexShrink:   0,
            transition:   "background 0.15s",
          }}
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "48px 20px", color: "#8b95a1" }}>
            <div style={{ width: 26, height: 26, border: "2.5px solid #e4e8f0", borderTopColor: "#2563eb", borderRadius: "50%", animation: "ppSpin 0.7s linear infinite" }} />
            <p style={{ fontSize: 13, fontWeight: 500 }}>Finding physicians…</p>
            <style>{`@keyframes ppSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {!loading && error && (
          <div style={{ margin: "4px 0", padding: "12px 14px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 13 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>Error</div>
            {error}
          </div>
        )}

        {!loading && searched && !error && physicians.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "48px 20px", textAlign: "center", color: "#8b95a1" }}>
            <div style={{ fontSize: 32 }}>👨‍⚕️</div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#4b5563" }}>No physicians found</h3>
            <p style={{ fontSize: 12 }}>Try increasing the search radius or changing the specialty.</p>
          </div>
        )}

        {!loading && physicians.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: "#8b95a1", fontWeight: 500, marginBottom: 4 }}>
              Showing {physicians.length} of {total} physicians
            </div>

            {physicians.map((p) => (
              <PhysicianCard
                key={p.npi}
                physician={p}
                onContact={(phys) => setLeadPhys(phys)}
              />
            ))}

            {hasMore && (
              <button
                onClick={handleLoadMore}
                style={{
                  width:        "100%",
                  padding:      10,
                  border:       "1px dashed #cdd3e0",
                  borderRadius: 8,
                  background:   "transparent",
                  fontSize:     13,
                  fontWeight:   500,
                  color:        "#4b5563",
                  cursor:       "pointer",
                  fontFamily:   "inherit",
                  marginTop:    4,
                  transition:   "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.background  = "#f6f7fb";
                  btn.style.borderColor = "#2563eb";
                  btn.style.color       = "#2563eb";
                }}
                onMouseLeave={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.background  = "transparent";
                  btn.style.borderColor = "#cdd3e0";
                  btn.style.color       = "#4b5563";
                }}
              >
                Load more physicians
              </button>
            )}
          </>
        )}
      </div>

      {/* Lead modal */}
      {leadPhys && (
        <LeadCaptureModal
          npi={leadPhys.npi}
          nctId={site.nct_id}
          siteName={site.facility}
          onClose={handleLeadClose}
        />
      )}
    </div>
  );
}