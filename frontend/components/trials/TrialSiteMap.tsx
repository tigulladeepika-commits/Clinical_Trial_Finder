// components/trials/TrialSiteMap.tsx
"use client";

import { useState }         from "react";
import StatusBadge          from "@/components/shared/StatusBadge";
import type { TrialSite }   from "@/types/trial";
import type { SelectedSite } from "@/types/physician";

interface Props {
  sites:              TrialSite[];
  trialTitle:         string;
  nctId:              string;
  description:        string | null;
  condition:          string | null;
  inclusionCriteria?: string | null;
  exclusionCriteria?: string | null;
  onFindPhysicians:   (site: SelectedSite) => void;
}

export default function TrialSiteMap({
  sites,
  nctId,
  description,
  condition,
  inclusionCriteria,
  exclusionCriteria,
  onFindPhysicians,
}: Props) {
  const [showCriteria, setShowCriteria] = useState(false);

  const handleSiteClick = (site: TrialSite) => {
    if (!site.lat || !site.lon) return;
    onFindPhysicians({
      lat:       site.lat,
      lng:       site.lon,
      facility:  site.facility,
      city:      site.city,
      state:     site.state,
      nct_id:    nctId,
      condition: condition,
    });
  };

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Description */}
      {description && (
        <div>
          <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6 }}>{description}</p>
        </div>
      )}

      {/* Eligibility criteria toggle */}
      {(inclusionCriteria || exclusionCriteria) && (
        <div
          style={{
            background:   "#f8fafc",
            border:       "1px solid #e4e8f0",
            borderRadius: 10,
            overflow:     "hidden",
          }}
        >
          <button
            onClick={() => setShowCriteria((v) => !v)}
            style={{
              width:      "100%",
              padding:    "10px 14px",
              background: "transparent",
              border:     "none",
              textAlign:  "left",
              display:    "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor:     "pointer",
              fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#4b5563" }}>
              Eligibility Criteria
            </span>
            <span style={{ fontSize: 12, color: "#8b95a1" }}>
              {showCriteria ? "▲ Hide" : "▼ Show"}
            </span>
          </button>

          {showCriteria && (
            <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {inclusionCriteria && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    Inclusion
                  </div>
                  <p style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.6 }}>{inclusionCriteria}</p>
                </div>
              )}
              {exclusionCriteria && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                    Exclusion
                  </div>
                  <p style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.6 }}>{exclusionCriteria}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sites section header */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#8b95a1", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
          Trial Sites — {sites.length} location{sites.length !== 1 ? "s" : ""}
        </div>

        {sites.length === 0 ? (
          <p style={{ fontSize: 13, color: "#8b95a1" }}>No site data available for this trial.</p>
        ) : (
          <div
            style={{
              display:             "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap:                 8,
            }}
          >
            {sites.map((site, i) => {
              const hasCoords = site.lat != null && site.lon != null;
              return (
                <div
                  key={i}
                  onClick={() => hasCoords && handleSiteClick(site)}
                  role={hasCoords ? "button" : undefined}
                  tabIndex={hasCoords ? 0 : undefined}
                  onKeyDown={(e) => e.key === "Enter" && hasCoords && handleSiteClick(site)}
                  style={{
                    background:   "#fff",
                    border:       "1px solid #e4e8f0",
                    borderRadius: 10,
                    padding:      "12px 14px",
                    cursor:       hasCoords ? "pointer" : "default",
                    transition:   "border-color 0.15s, box-shadow 0.15s",
                    outline:      "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!hasCoords) return;
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.borderColor = "#2563eb";
                    el.style.boxShadow   = "0 2px 8px rgba(37,99,235,0.1)";
                    const cta = el.querySelector<HTMLElement>(".site-cta");
                    if (cta) cta.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.borderColor = "#e4e8f0";
                    el.style.boxShadow   = "none";
                    const cta = el.querySelector<HTMLElement>(".site-cta");
                    if (cta) cta.style.opacity = "0";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#0d1117", flex: 1 }}>
                      {site.facility || "Unnamed Site"}
                    </div>
                    <StatusBadge status={site.status} />
                  </div>

                  <div style={{ fontSize: 12, color: "#8b95a1", marginBottom: 6 }}>
                    {[site.city, site.state, site.country].filter(Boolean).join(", ")}
                  </div>

                  {hasCoords ? (
                    <div
                      className="site-cta"
                      style={{ opacity: 0, transition: "opacity 0.15s", fontSize: 11, fontWeight: 600, color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.5px" }}
                    >
                      → Find nearby physicians
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#cdd3e0" }}>No coordinates available</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}