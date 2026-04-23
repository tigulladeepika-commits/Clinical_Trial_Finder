// components/trials/TrialSiteMap.tsx
"use client";

import { useEffect, useRef } from "react";
import type { TrialSite }    from "@/types/trial";
import type { SelectedSite } from "@/types/physician";

type Props = {
  sites:        TrialSite[];
  trialTitle:   string;
  nctId:        string;
  description?: string | null;
  // NEW: first condition of the trial so it can be forwarded to the
  // physician search as the primary specialty anchor.
  condition?:   string | null;
  onFindPhysicians: (site: SelectedSite) => void;
};

// ── Status → universal color ─────────────────────────────────────────────────
function statusColor(status: string | null): string {
  const s = (status || "").toUpperCase().trim();
  if (s === "RECRUITING" || s === "ENROLLING_BY_INVITATION") return "#16a34a";
  if (s === "NOT_YET_RECRUITING")              return "#f59e0b";
  if (s.includes("ACTIVE"))                    return "#2563eb";
  if (s === "TERMINATED")                      return "#ef4444";
  if (s === "WITHDRAWN" || s === "SUSPENDED")  return "#f59e0b";
  if (s === "COMPLETED")                       return "#64748b";
  return "#9ca3af";
}

function statusLabel(status: string | null): string {
  return (status || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hospitalMarkerHtml(color: string, size = 28): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="13" fill="${color}" stroke="white" stroke-width="2.5"/>
      <rect x="11" y="7" width="6" height="14" rx="1.5" fill="white"/>
      <rect x="7" y="11" width="14" height="6" rx="1.5" fill="white"/>
    </svg>`.trim();
  return `<div style="filter:drop-shadow(0 2px 6px rgba(0,0,0,0.28));cursor:pointer;">${svg}</div>`;
}

declare global { interface Window { L: any; } }

export default function TrialSiteMap({
  sites,
  trialTitle,
  nctId,
  description,
  condition,        // NEW prop
  onFindPhysicians,
}: Props) {
  const mapKey         = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef      = useRef<HTMLDivElement>(null);
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
          .leaflet-map-pane   { z-index: 1 !important; }
          .leaflet-tile-pane  { z-index: 2 !important; }
          .leaflet-overlay-pane { z-index: 3 !important; }
          .leaflet-marker-pane  { z-index: 4 !important; }
          .leaflet-popup-pane   { z-index: 5 !important; }

          .trial-tooltip {
            background: white !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 10px !important;
            padding: 8px 12px !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            color: #1e293b !important;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12) !important;
            white-space: nowrap !important;
            pointer-events: none !important;
            font-family: 'Sora', sans-serif !important;
          }
          .trial-popup .leaflet-popup-content-wrapper {
            background: white !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 14px !important;
            box-shadow: 0 12px 32px rgba(0,0,0,0.14) !important;
            padding: 0 !important;
            overflow: hidden !important;
            min-width: 240px !important;
            max-width: 300px !important;
          }
          .trial-popup .leaflet-popup-content { margin: 0 !important; line-height: 1.5 !important; }
          .trial-popup .leaflet-popup-close-button {
            top: 10px !important; right: 12px !important;
            font-size: 20px !important; color: #94a3b8 !important;
            font-weight: 300 !important; width: 24px !important; height: 24px !important;
          }
          .trial-popup .leaflet-popup-close-button:hover { color: #475569 !important; background: none !important; }
          .find-phys-btn {
            display: block; width: 100%; margin-top: 10px;
            padding: 8px 0; border-radius: 8px;
            border: none; background: #2563eb; color: white;
            font-size: 12px; font-weight: 700; cursor: pointer;
            text-align: center; letter-spacing: 0.2px;
            font-family: 'Sora', sans-serif;
            transition: background 0.12s;
          }
          .find-phys-btn:hover { background: #1d4ed8; }
        `;
        document.head.appendChild(style);
      }

      const lats      = mappableSites.map((s) => s.lat as number);
      const lons      = mappableSites.map((s) => s.lon as number);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

      const map = L.mapquest.map(mapDivRef.current, {
        center:      [centerLat, centerLon],
        layers:      L.mapquest.tileLayer("map"),
        zoom:        3,
        zoomControl: false,
      });
      mapInstanceRef.current = map;

      mappableSites.forEach((site) => {
        const color = statusColor(site.status);
        const icon  = L.divIcon({
          html:      hospitalMarkerHtml(color, 28),
          className: "",
          iconSize:  [28, 28],
          iconAnchor:[14, 14],
        });

        const marker       = L.marker([site.lat, site.lon], { icon }).addTo(map);
        const locationLine = [site.city, site.state, site.country].filter(Boolean).join(", ");

        marker.bindTooltip(
          `<div style="font-weight:700;font-size:13px;color:#0f172a;">
            ${site.facility || "Unknown Facility"}
           </div>
           ${locationLine
             ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">📍 ${locationLine}</div>`
             : ""}`,
          { permanent: false, direction: "top", offset: [0, -16], className: "trial-tooltip" }
        );

        const hasCoords   = site.lat != null && site.lon != null;
        const findPhysBtn = hasCoords
          ? `<button class="find-phys-btn" id="fp-btn-${site.lat}-${site.lon}">
               🩺 Find physicians near this site
             </button>`
          : "";

        const popupContent = `
          <div>
            <div style="background:${color}12;border-bottom:1px solid ${color}30;padding:14px 16px 12px;">
              <div style="font-weight:700;font-size:13px;color:#0f172a;line-height:1.35;padding-right:20px;font-family:'Sora',sans-serif;">
                ${site.facility || "Unknown Facility"}
              </div>
              ${locationLine
                ? `<div style="font-size:11px;color:#64748b;margin-top:4px;font-family:'Sora',sans-serif;">📍 ${locationLine}</div>`
                : ""}
            </div>
            <div style="padding:12px 16px 14px;">
              ${site.status
                ? `<div style="
                    display:inline-flex;align-items:center;gap:6px;
                    padding:3px 10px;border-radius:20px;
                    font-size:11px;font-weight:700;
                    background:${color}18;color:${color};border:1px solid ${color}40;
                    font-family:'Sora',sans-serif;
                   ">
                    <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;"></span>
                    ${statusLabel(site.status)}
                   </div>`
                : ""}
              ${findPhysBtn}
            </div>
          </div>`;

        marker.bindPopup(popupContent, {
          className: "trial-popup", offset: [0, -10], maxWidth: 300, closeButton: true,
        });

        marker.on("click", () => { marker.openPopup(); });

        if (hasCoords) {
          marker.on("popupopen", () => {
            const btnId = `fp-btn-${site.lat}-${site.lon}`;
            setTimeout(() => {
              const btn = document.getElementById(btnId);
              if (btn) {
                btn.addEventListener("click", () => {
                  marker.closePopup();
                  // NEW: condition forwarded so PhysicianPanel can pre-fill
                  // the specialty field and pass it to the backend.
                  onFindPhysicians({
                    lat:       site.lat as number,
                    lng:       site.lon as number,
                    facility:  site.facility,
                    city:      site.city,
                    state:     site.state,
                    nct_id:    nctId,
                    condition: condition ?? null,
                  });
                });
              }
            }, 50);
          });
        }
      });

      if (mappableSites.length > 1) {
        const bounds = L.latLngBounds(mappableSites.map((s) => [s.lat, s.lon]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    };

    const loadAndInit = () => {
      if (window.L?.mapquest) { initMap(); return; }
      const iv = setInterval(() => {
        if (window.L?.mapquest) { clearInterval(iv); initMap(); }
      }, 100);
    };

    if (!document.getElementById("mq-css")) {
      const css  = document.createElement("link");
      css.id     = "mq-css"; css.rel = "stylesheet";
      css.href   = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.css";
      document.head.appendChild(css);
    }
    if (!document.getElementById("mq-js")) {
      const script    = document.createElement("script");
      script.id       = "mq-js";
      script.src      = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
      script.onload   = loadAndInit;
      document.head.appendChild(script);
    } else {
      loadAndInit();
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

  const LEGEND = [
    { color: "#16a34a", label: "Recruiting" },
    { color: "#f59e0b", label: "Not Yet Recruiting / Suspended" },
    { color: "#2563eb", label: "Active (not recruiting)" },
    { color: "#64748b", label: "Completed" },
    { color: "#ef4444", label: "Terminated / Withdrawn" },
    { color: "#9ca3af", label: "Other" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        .tsm-stats-strip {
          display: flex;
          border-bottom: 1px solid #f1f5f9;
        }
        .tsm-stat {
          flex: 1;
          padding: 14px 0;
          text-align: center;
        }
        .tsm-stat + .tsm-stat { border-left: 1px solid #f1f5f9; }
        .tsm-stat-val {
          font-size: 22px;
          font-weight: 700;
          line-height: 1;
          color: #0f172a;
          font-family: 'IBM Plex Mono', monospace;
        }
        .tsm-stat-val.accent { color: #16a34a; }
        .tsm-stat-lbl {
          font-size: 10px;
          color: #94a3b8;
          margin-top: 4px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .tsm-sites-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 10px;
          padding: 16px 20px;
        }
        .tsm-site-card {
          border-radius: 10px;
          border: 1px solid #f1f5f9;
          padding: 12px 14px;
          background: #fff;
          transition: all 0.15s;
          cursor: pointer;
        }
        .tsm-site-card:hover {
          border-color: #bfdbfe;
          background: #f0f9ff;
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(37,99,235,0.08);
        }
        .tsm-site-facility {
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.35;
          margin-bottom: 3px;
        }
        .tsm-site-location {
          font-size: 11px;
          color: #64748b;
          margin-bottom: 6px;
        }
        .tsm-section-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #94a3b8;
          padding: 16px 20px 8px;
          border-bottom: 1px solid #f8fafc;
        }
        .tsm-desc {
          font-size: 13px;
          color: #475569;
          line-height: 1.7;
          padding: 12px 20px 16px;
        }
        .tsm-find-btn {
          display: block;
          width: 100%;
          margin-top: 8px;
          padding: 6px 0;
          border-radius: 7px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #2563eb;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Sora', sans-serif;
          transition: all 0.12s;
          text-align: center;
        }
        .tsm-find-btn:hover { background: #2563eb; color: white; border-color: #2563eb; }
        .tsm-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .tsm-map-controls {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          gap: 6px;
          pointer-events: auto;
        }
        .tsm-map-legend {
          position: absolute;
          bottom: 12px;
          left: 12px;
          z-index: 1000;
          background: rgba(255,255,255,0.97);
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.10);
          display: flex;
          flex-direction: column;
          gap: 6px;
          pointer-events: none;
          max-width: 220px;
        }
        .tsm-legend-title {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: #94a3b8;
          margin-bottom: 2px;
          font-family: 'IBM Plex Mono', monospace;
        }
        .tsm-legend-row {
          display: flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
        }
        .tsm-legend-label {
          font-size: 11px;
          color: #475569;
          font-weight: 500;
          white-space: normal;
          line-height: 1.3;
        }
      `}</style>

      <div style={{ fontFamily: "'Sora', sans-serif" }}>

        {/* Stats strip */}
        <div className="tsm-stats-strip">
          {[
            { label: "Total Sites",  value: totalSites,           accent: false },
            { label: "Recruiting",   value: recruitingCount,      accent: true  },
            { label: "On Map",       value: mappableSites.length, accent: false },
            { label: "Countries",    value: countriesCount,       accent: false },
          ].map((st, i) => (
            <div key={i} className="tsm-stat">
              <div className={`tsm-stat-val${st.accent ? " accent" : ""}`}>{st.value}</div>
              <div className="tsm-stat-lbl">{st.label}</div>
            </div>
          ))}
        </div>

        {/* Map */}
        <div style={{ position: "relative" }}>
          {!mapKey || mappableSites.length === 0 ? (
            <div style={{
              height: 420, display: "flex", alignItems: "center",
              justifyContent: "center", flexDirection: "column", gap: 12,
              background: "#f8fafc", color: "#94a3b8",
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {!mapKey ? "MapQuest API key not configured" : "No geocoded site locations available"}
              </div>
            </div>
          ) : (
            <>
              <div ref={mapDivRef} style={{ height: 420, width: "100%", background: "#e8edf2" }} />

              {/* Zoom controls */}
              <div className="tsm-map-controls">
                {[
                  { icon: "+", title: "Zoom in",  fn: zoomIn  },
                  { icon: "−", title: "Zoom out", fn: zoomOut },
                  { icon: "⊡", title: "Fit all",  fn: fitAll  },
                ].map((b) => (
                  <button
                    key={b.title}
                    title={b.title}
                    onClick={b.fn}
                    style={{
                      width: 34, height: 34, background: "white",
                      border: "1px solid #e2e8f0", borderRadius: 8,
                      fontSize: 17, fontWeight: 700, color: "#334155",
                      cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#eff6ff"; e.currentTarget.style.color = "#2563eb"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "white";   e.currentTarget.style.color = "#334155"; }}
                  >{b.icon}</button>
                ))}
              </div>

              {/* Legend */}
              <div className="tsm-map-legend">
                <div className="tsm-legend-title">Status Legend</div>
                {LEGEND.map((l) => (
                  <div key={l.label} className="tsm-legend-row">
                    <svg width="14" height="14" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                      <circle cx="14" cy="14" r="13" fill={l.color}/>
                      <rect x="11" y="7" width="6" height="14" rx="1.5" fill="white"/>
                      <rect x="7" y="11" width="14" height="6" rx="1.5" fill="white"/>
                    </svg>
                    <span className="tsm-legend-label">{l.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Description */}
        {description && (
          <>
            <div className="tsm-section-title">About This Trial</div>
            <p className="tsm-desc">{description}</p>
          </>
        )}

        {/* All locations */}
        <div className="tsm-section-title">All Locations ({sites.length})</div>
        {sites.length === 0 ? (
          <p style={{ fontSize: 14, color: "#94a3b8", padding: "12px 20px" }}>No location data available.</p>
        ) : (
          <div className="tsm-sites-grid">
            {sites.map((site, i) => {
              const color = statusColor(site.status);
              const loc   = [site.city, site.state, site.country].filter(Boolean).join(", ");
              return (
                <div
                  key={i}
                  className="tsm-site-card"
                  onClick={() => {
                    if (site.lat != null && mapInstanceRef.current) {
                      mapInstanceRef.current.setView([site.lat, site.lon], 11);
                      mapDivRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                    <svg width="16" height="16" viewBox="0 0 28 28" style={{ flexShrink: 0, marginTop: 1 }}>
                      <circle cx="14" cy="14" r="13" fill={color}/>
                      <rect x="11" y="7" width="6" height="14" rx="1.5" fill="white"/>
                      <rect x="7" y="11" width="14" height="6" rx="1.5" fill="white"/>
                    </svg>
                    <div className="tsm-site-facility">{site.facility || "Unknown Facility"}</div>
                  </div>
                  <div className="tsm-site-location">{loc || "Location unknown"}</div>
                  {site.status && (
                    <div className="tsm-status-pill" style={{
                      background: `${color}15`,
                      color,
                      border: `1px solid ${color}40`,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
                      {statusLabel(site.status)}
                    </div>
                  )}
                  {site.lat != null && (
                    <button
                      className="tsm-find-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        // NEW: condition forwarded alongside lat/lng
                        onFindPhysicians({
                          lat:       site.lat as number,
                          lng:       site.lon as number,
                          facility:  site.facility,
                          city:      site.city,
                          state:     site.state,
                          nct_id:    nctId,
                          condition: condition ?? null,
                        });
                      }}
                    >
                      🩺 Find physicians nearby
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}