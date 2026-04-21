// components/trials/TrialSiteMap.tsx
// V2 TrialSiteMap — moved to components/trials/ and extended with
// a "Find physicians near this site" button on each site popup.
// All V2 map / tooltip / legend logic is preserved exactly.

"use client";

import { useEffect, useRef, useState } from "react";
import { statusDotColor }              from "@/components/shared/StatusBadge";
import type { TrialSite }              from "@/types/trial";
import type { SelectedSite }           from "@/types/physician";

type Props = {
  sites:       TrialSite[];
  trialTitle:  string;
  nctId:       string;
  description?: string | null;
  onFindPhysicians: (site: SelectedSite) => void;   // NEW — triggers physician panel
};

function siteBadgeClass(status: string | null) {
  const s = (status || "").toUpperCase().trim();
  if (s === "RECRUITING" || s === "ENROLLING_BY_INVITATION") return "badge badge-status-recruiting";
  if (s === "NOT_YET_RECRUITING")             return "badge badge-status-soon";
  if (s.includes("ACTIVE"))                   return "badge badge-status-active";
  if (s === "TERMINATED")                     return "badge badge-status-terminated";
  if (s === "WITHDRAWN" || s === "SUSPENDED") return "badge badge-status-warning";
  return "badge badge-status-default";
}

declare global {
  interface Window { L: any; }
}

export default function TrialSiteMap({ sites, trialTitle, nctId, description, onFindPhysicians }: Props) {
  const mapKey        = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef     = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  const mappableSites   = sites.filter((s) => s.lat != null && s.lon != null);
  const totalSites      = sites.length;
  const recruitingCount = sites.filter((s) => {
    const st = (s.status || "").toUpperCase().trim();
    return st === "RECRUITING" || st === "ENROLLING_BY_INVITATION";
  }).length;
  const countriesCount = [...new Set(sites.map((s) => s.country).filter(Boolean))].length;

  useEffect(() => {
    if (!mapKey || mappableSites.length === 0) return;

    const initMap = () => {
      if (!mapDivRef.current || mapInstanceRef.current) return;
      const L = window.L;
      if (!L?.mapquest) return;

      L.mapquest.key = mapKey;

      if (!document.getElementById("trial-map-style")) {
        const style = document.createElement("style");
        style.id = "trial-map-style";
        style.textContent = `
          .trial-tooltip {
            background: white !important; border: 1px solid #e2e8f0 !important;
            border-radius: 8px !important; padding: 8px 12px !important;
            font-size: 12px !important; font-weight: 500 !important;
            color: #1e293b !important; box-shadow: 0 4px 16px rgba(0,0,0,0.13) !important;
            white-space: nowrap !important; pointer-events: none !important;
          }
          .trial-tooltip.leaflet-tooltip-top::before { border-top-color: #e2e8f0 !important; }
          .trial-popup .leaflet-popup-content-wrapper {
            background: white !important; border: 1px solid #e2e8f0 !important;
            border-radius: 12px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.14) !important;
            padding: 0 !important; overflow: hidden !important;
            min-width: 220px !important; max-width: 300px !important;
          }
          .trial-popup .leaflet-popup-content { margin: 0 !important; line-height: 1.5 !important; }
          .trial-popup .leaflet-popup-close-button {
            top: 8px !important; right: 10px !important; font-size: 18px !important;
            color: #94a3b8 !important; font-weight: 400 !important;
          }
          .trial-popup .leaflet-popup-close-button:hover { color: #475569 !important; background: none !important; }
          .trial-marker-dot {
            border-radius: 50% !important; border: 2.5px solid white !important;
            box-shadow: 0 2px 6px rgba(0,0,0,0.28) !important;
            cursor: pointer !important; transition: transform 0.15s !important;
          }
          .trial-marker-dot:hover { transform: scale(1.5) !important; }
          .find-phys-btn {
            display: block; width: 100%; margin-top: 8px;
            padding: 7px 0; border-radius: 8px;
            border: none; background: #2563eb; color: white;
            font-size: 12px; font-weight: 700; cursor: pointer;
            text-align: center; letter-spacing: 0.2px;
          }
          .find-phys-btn:hover { background: #1d4ed8; }
        `;
        document.head.appendChild(style);
      }

      const lats    = mappableSites.map((s) => s.lat as number);
      const lons    = mappableSites.map((s) => s.lon as number);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

      const map = L.mapquest.map(mapDivRef.current, {
        center: [centerLat, centerLon],
        layers: L.mapquest.tileLayer("map"),
        zoom: 3,
        zoomControl: false,
      });
      mapInstanceRef.current = map;

      mappableSites.forEach((site) => {
        const color = statusDotColor(site.status);
        const icon  = L.divIcon({
          html: `<div class="trial-marker-dot" style="width:14px;height:14px;background:${color} !important;"></div>`,
          className: "", iconSize: [14, 14], iconAnchor: [7, 7],
        });

        const marker = L.marker([site.lat, site.lon], { icon }).addTo(map);
        const locationLine = [site.city, site.state, site.country].filter(Boolean).join(", ");

        // Hover tooltip
        marker.bindTooltip(
          `<div style="font-weight:600;font-size:12px;color:#0f172a;">${site.facility || "Unknown Facility"}</div>
           ${locationLine ? `<div style="font-size:11px;color:#64748b;margin-top:1px;">${locationLine}</div>` : ""}`,
          { permanent: false, direction: "top", offset: [0, -10], className: "trial-tooltip" }
        );

        const statusPill = site.status
          ? `<div style="
              display:inline-block; padding:3px 10px; border-radius:20px;
              font-size:10px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase;
              background:${color}18; color:${color}; border:1px solid ${color}50;
            ">${site.status.replace(/_/g, " ")}</div>`
          : "";

        // NEW: "Find physicians" button in popup
        const hasCoords = site.lat != null && site.lon != null;
        const findPhysBtn = hasCoords
          ? `<button class="find-phys-btn" id="fp-btn-${site.lat}-${site.lon}">
               🩺 Find physicians near this site
             </button>`
          : "";

        const popupContent = `
          <div>
            <div style="background:${color}12;border-bottom:1px solid ${color}25;padding:12px 14px 10px;">
              <div style="font-weight:700;font-size:13px;color:#0f172a;line-height:1.35;padding-right:16px;">
                ${site.facility || "Unknown Facility"}
              </div>
              ${locationLine ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">📍 ${locationLine}</div>` : ""}
            </div>
            <div style="padding:10px 14px;">
              ${statusPill}
              ${findPhysBtn}
            </div>
          </div>`;

        marker.bindPopup(popupContent, {
          className: "trial-popup", offset: [0, -8], maxWidth: 300, closeButton: true,
        });

        marker.on("click", () => { marker.openPopup(); });

        // Wire up the "Find physicians" button after popup opens
        if (hasCoords) {
          marker.on("popupopen", () => {
            const btnId = `fp-btn-${site.lat}-${site.lon}`;
            setTimeout(() => {
              const btn = document.getElementById(btnId);
              if (btn) {
                btn.addEventListener("click", () => {
                  marker.closePopup();
                  onFindPhysicians({
                    lat:      site.lat as number,
                    lng:      site.lon as number,
                    facility: site.facility,
                    city:     site.city,
                    state:    site.state,
                    nct_id:   nctId,
                  });
                });
              }
            }, 50);
          });
        }
      });
    };

    if (!document.getElementById("mq-css")) {
      const css = document.createElement("link");
      css.id = "mq-css"; css.rel = "stylesheet";
      css.href = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.css";
      document.head.appendChild(css);
    }
    if (!document.getElementById("mq-js")) {
      const script = document.createElement("script");
      script.id = "mq-js";
      script.src = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
      script.onload = initMap;
      document.head.appendChild(script);
    } else if (window.L?.mapquest) {
      initMap();
    } else {
      const iv = setInterval(() => { if (window.L?.mapquest) { clearInterval(iv); initMap(); } }, 100);
    }

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, sites, nctId]);

  const zoomIn  = () => mapInstanceRef.current?.zoomIn();
  const zoomOut = () => mapInstanceRef.current?.zoomOut();
  const fitAll  = () => {
    if (!mapInstanceRef.current || mappableSites.length === 0) return;
    const bounds = window.L.latLngBounds(mappableSites.map((s) => [s.lat, s.lon]));
    mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
  };

  return (
    <div className="detail-content" style={{ paddingTop: 0 }}>

      {/* Stats strip */}
      <div className="detail-section" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid var(--gray-100)" }}>
          {[
            { label: "Total Sites",  value: totalSites },
            { label: "Recruiting",   value: recruitingCount, accent: true },
            { label: "On Map",       value: mappableSites.length },
            { label: "Countries",    value: countriesCount },
          ].map((st, i, arr) => (
            <div key={i} style={{
              flex: 1, padding: "14px 0", textAlign: "center",
              borderRight: i < arr.length - 1 ? "1px solid var(--gray-100)" : "none",
            }}>
              <div style={{
                fontSize: 22, fontWeight: 700, lineHeight: 1,
                color: st.accent ? "var(--blue-600)" : "var(--gray-800)",
                fontFamily: "'DM Serif Display', serif",
              }}>{st.value}</div>
              <div style={{ fontSize: 11, color: "var(--gray-400)", marginTop: 4, fontWeight: 500 }}>
                {st.label}
              </div>
            </div>
          ))}
        </div>

        {/* Map */}
        <div style={{ position: "relative" }}>
          {!mapKey || mappableSites.length === 0 ? (
            <div style={{
              height: 420, display: "flex", alignItems: "center", justifyContent: "center",
              flexDirection: "column", gap: 12, background: "var(--gray-50)", color: "var(--gray-400)",
            }}>
              <div style={{ fontSize: 44 }}>🗺️</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {!mapKey ? "MapQuest API key not configured" : "No geocoded site locations"}
              </div>
            </div>
          ) : (
            <>
              <div ref={mapDivRef} style={{ height: 420, width: "100%", background: "#e8edf2" }} />

              {/* Zoom controls */}
              <div style={{ position: "absolute", top: 12, right: 12, zIndex: 1000, display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { icon: "+", title: "Zoom in",       fn: zoomIn  },
                  { icon: "−", title: "Zoom out",      fn: zoomOut },
                  { icon: "⊡", title: "Fit all sites", fn: fitAll  },
                ].map((b) => (
                  <button key={b.title} title={b.title} onClick={b.fn} style={{
                    width: 36, height: 36, background: "white",
                    border: "1px solid var(--gray-200)", borderRadius: 8,
                    fontSize: 18, fontWeight: 700, color: "var(--gray-700)",
                    cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
                    transition: "all 0.15s", lineHeight: 1,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--blue-50)"; e.currentTarget.style.color = "var(--blue-600)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.color = "var(--gray-700)"; }}
                  >{b.icon}</button>
                ))}
              </div>

              {/* Legend */}
              <div style={{
                position: "absolute", bottom: 12, left: 12, zIndex: 1000,
                background: "rgba(255,255,255,0.94)", backdropFilter: "blur(6px)",
                border: "1px solid var(--gray-200)", borderRadius: 10,
                padding: "8px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                display: "flex", flexDirection: "column", gap: 5,
              }}>
                {[
                  { color: "#16a34a", label: "Recruiting" },
                  { color: "#4ade80", label: "Opening Soon" },
                  { color: "#2563eb", label: "Active" },
                  { color: "#f59e0b", label: "Suspended" },
                  { color: "#ef4444", label: "Terminated" },
                  { color: "#94a3b8", label: "Completed / Other" },  // grey per V2 feedback
                ].map((l) => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: l.color, border: "2px solid white",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)", flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--gray-600)" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      {description && (
        <div className="detail-section">
          <div className="section-title">About This Trial</div>
          <p className="description-text">{description}</p>
        </div>
      )}

      {/* All locations list */}
      <div className="detail-section">
        <div className="section-title">All Locations</div>
        {sites.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--gray-400)" }}>No location data available.</p>
        ) : (
          <div className="sites-grid">
            {sites.map((site, i) => (
              <div key={i} className="site-card"
                style={{ cursor: site.lat != null ? "pointer" : "default" }}
                onClick={() => {
                  if (site.lat != null && mapInstanceRef.current) {
                    mapInstanceRef.current.setView([site.lat, site.lon], 10);
                    mapDivRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                }}
              >
                <div className="site-facility">{site.facility || "Unknown Facility"}</div>
                <div className="site-location">
                  {[site.city, site.state, site.country].filter(Boolean).join(", ") || "Location unknown"}
                </div>
                {site.status && (
                  <span className={`site-status ${siteBadgeClass(site.status)}`}>
                    {site.status.replace(/_/g, " ")}
                  </span>
                )}
                {/* Find physicians shortcut on list card */}
                {site.lat != null && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFindPhysicians({
                        lat:      site.lat as number,
                        lng:      site.lon as number,
                        facility: site.facility,
                        city:     site.city,
                        state:    site.state,
                        nct_id:   nctId,
                      });
                    }}
                    style={{
                      marginTop: 8, padding: "5px 10px", borderRadius: 6,
                      border: "1px solid var(--blue-200, #bfdbfe)",
                      background: "var(--blue-50, #eff6ff)",
                      color: "var(--blue-600, #2563eb)",
                      fontSize: 11, fontWeight: 700, cursor: "pointer", width: "100%",
                    }}
                  >
                    🩺 Find physicians nearby
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}