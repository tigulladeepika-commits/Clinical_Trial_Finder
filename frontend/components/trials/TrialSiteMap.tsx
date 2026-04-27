// components/trials/TrialSiteMap.tsx
"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { FixedSizeList as List } from "react-window";
import StatusBadge                      from "@/components/shared/StatusBadge";
import type { TrialSite }               from "@/types/trial";
import type { SelectedSite }            from "@/types/physician";

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

// ── Status → color ────────────────────────────────────────────────────────────
function statusColor(status: string | null): string {
  const s = (status || "").toUpperCase().trim();
  if (s === "RECRUITING" || s === "ENROLLING_BY_INVITATION") return "#16a34a";
  if (s === "NOT_YET_RECRUITING")             return "#f59e0b";
  if (s.includes("ACTIVE"))                   return "#2563eb";
  if (s === "TERMINATED")                     return "#ef4444";
  if (s === "WITHDRAWN" || s === "SUSPENDED") return "#f59e0b";
  if (s === "COMPLETED")                      return "#64748b";
  return "#9ca3af";
}

function statusLabel(status: string | null): string {
  return (status || "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

const LEGEND = [
  { color: "#16a34a", label: "Recruiting" },
  { color: "#f59e0b", label: "Not Yet Recruiting / Suspended" },
  { color: "#2563eb", label: "Active (not recruiting)" },
  { color: "#64748b", label: "Completed" },
  { color: "#ef4444", label: "Terminated / Withdrawn" },
  { color: "#9ca3af", label: "Other" },
];

export default function TrialSiteMap({
  sites,
  nctId,
  description,
  condition,
  inclusionCriteria,
  exclusionCriteria,
  onFindPhysicians,
}: Props) {
  const mapKey         = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef      = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  const [showCriteria, setShowCriteria] = useState(false);

  const mappableSites = sites.filter((s) => s.lat != null && s.lon != null);

  // ── MapQuest init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapKey || mappableSites.length === 0) return;

    const initMap = () => {
      if (!mapDivRef.current || mapInstanceRef.current) return;
      const L = window.L;
      if (!L?.mapquest) return;

      L.mapquest.key = mapKey;

      // Inject popup / tooltip styles once
      if (!document.getElementById("trial-map-style")) {
        const style = document.createElement("style");
        style.id = "trial-map-style";
        style.textContent = `
          .leaflet-map-pane    { z-index: 1 !important; }
          .leaflet-tile-pane   { z-index: 2 !important; }
          .leaflet-overlay-pane{ z-index: 3 !important; }
          .leaflet-marker-pane { z-index: 4 !important; }
          .leaflet-popup-pane  { z-index: 5 !important; }

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
          html:       hospitalMarkerHtml(color, 28),
          className:  "",
          iconSize:   [28, 28],
          iconAnchor: [14, 14],
        });

        const marker       = L.marker([site.lat, site.lon], { icon }).addTo(map);
        const locationLine = [site.city, site.state, site.country]
          .filter(Boolean)
          .join(", ");

        marker.bindTooltip(
          `<div style="font-weight:700;font-size:13px;color:#0f172a;">
             ${site.facility || "Unknown Facility"}
           </div>
           ${locationLine
             ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">📍 ${locationLine}</div>`
             : ""}`,
          { permanent: false, direction: "top", offset: [0, -16], className: "trial-tooltip" }
        );

        const findPhysBtn = `
          <button class="find-phys-btn" id="fp-btn-${site.lat}-${site.lon}">
            🩺 Find physicians near this site
          </button>`;

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
                    font-family:'Sora',sans-serif;">
                    <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;"></span>
                    ${statusLabel(site.status)}
                   </div>`
                : ""}
              ${findPhysBtn}
            </div>
          </div>`;

        marker.bindPopup(popupContent, {
          className:  "trial-popup",
          offset:     [0, -10],
          maxWidth:   300,
          closeButton: true,
        });

        marker.on("click", () => marker.openPopup());

        marker.on("popupopen", () => {
          const btnId = `fp-btn-${site.lat}-${site.lon}`;
          setTimeout(() => {
            const btn = document.getElementById(btnId);
            if (btn) {
              btn.addEventListener("click", () => {
                marker.closePopup();
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
      });

      if (mappableSites.length > 1) {
        const bounds = window.L.latLngBounds(
          mappableSites.map((s) => [s.lat, s.lon])
        );
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
      css.id     = "mq-css";
      css.rel    = "stylesheet";
      css.href   = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.css";
      document.head.appendChild(css);
    }
    if (!document.getElementById("mq-js")) {
      const script  = document.createElement("script");
      script.id     = "mq-js";
      script.src    = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
      script.onload = loadAndInit;
      document.head.appendChild(script);
    } else {
      loadAndInit();
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, sites, nctId]);

  const zoomIn  = () => mapInstanceRef.current?.zoomIn();
  const zoomOut = () => mapInstanceRef.current?.zoomOut();
  const fitAll  = () => {
    if (!mapInstanceRef.current || mappableSites.length === 0) return;
    const bounds = window.L.latLngBounds(
      mappableSites.map((s) => [s.lat, s.lon])
    );
    mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');

        .tsm-map-controls {
          position:absolute; top:12px; right:12px; z-index:1000;
          display:flex; flex-direction:column; gap:6px; pointer-events:auto;
        }
        .tsm-map-legend {
          position:absolute; bottom:12px; left:12px; z-index:1000;
          background:rgba(255,255,255,0.97); border:1px solid #e2e8f0;
          border-radius:10px; padding:10px 14px;
          box-shadow:0 2px 10px rgba(0,0,0,0.10);
          display:flex; flex-direction:column; gap:6px;
          pointer-events:none; max-width:220px;
        }
        .tsm-legend-title {
          font-size:9px; font-weight:700; letter-spacing:1px;
          text-transform:uppercase; color:#94a3b8; margin-bottom:2px;
          font-family:'IBM Plex Mono',monospace;
        }
        .tsm-legend-row   { display:flex; align-items:center; gap:7px; }
        .tsm-legend-label { font-size:11px; color:#475569; font-weight:500; line-height:1.3; white-space:normal; }

        .tsm-section-title {
          font-size:11px; font-weight:700; text-transform:uppercase;
          letter-spacing:0.8px; color:#94a3b8;
          padding:16px 20px 8px; border-bottom:1px solid #f8fafc;
        }
        .tsm-desc { font-size:13px; color:#4b5563; line-height:1.7; padding:12px 20px 16px; }

        .tsm-sites-grid {
          display:grid;
          grid-template-columns:repeat(auto-fill,minmax(260px,1fr));
          gap:8px; padding:16px 20px;
        }
        .tsm-site-card {
          background:#fff; border:1px solid #e4e8f0; border-radius:10px;
          padding:12px 14px; cursor:pointer; outline:none;
          transition:border-color 0.15s, box-shadow 0.15s;
        }
        .tsm-site-card:hover {
          border-color:#2563eb;
          box-shadow:0 2px 8px rgba(37,99,235,0.10);
        }
        .tsm-site-card:hover .site-cta { opacity:1 !important; }
        .tsm-site-facility { font-size:13px; font-weight:500; color:#0d1117; flex:1; }
        .tsm-site-location { font-size:12px; color:#8b95a1; margin-bottom:6px; }
        .site-cta {
          opacity:0; transition:opacity 0.15s;
          font-size:11px; font-weight:600; color:#2563eb;
          text-transform:uppercase; letter-spacing:0.5px;
        }
      `}</style>

      <div style={{ fontFamily: "'Sora', sans-serif" }}>

        {/* ── MapQuest map ── */}
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

              {/* Zoom / fit controls */}
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
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      transition: "all 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#eff6ff";
                      e.currentTarget.style.color      = "#2563eb";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "white";
                      e.currentTarget.style.color      = "#334155";
                    }}
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

        {/* ── Description ── */}
        {description && (
          <>
            <div className="tsm-section-title">About This Trial</div>
            <p className="tsm-desc">{description}</p>
          </>
        )}

        {/* ── Eligibility criteria (from current version) ── */}
        {(inclusionCriteria || exclusionCriteria) && (
          <div style={{ padding: "0 20px 16px" }}>
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
                  width: "100%", padding: "10px 14px",
                  background: "transparent", border: "none",
                  textAlign: "left", display: "flex",
                  alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer", fontFamily: "inherit",
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
          </div>
        )}

        {/* ── All locations grid ── */}
        <div className="tsm-section-title">All Locations ({sites.length})</div>
        {sites.length === 0 ? (
          <p style={{ fontSize: 13, color: "#8b95a1", padding: "12px 20px" }}>
            No site data available for this trial.
          </p>
        ) : (
          // CRITICAL FIX: Virtualize the sites list to only render visible items.
          // For trials with 50+ sites, this reduces DOM nodes from 50+ to ~5-10 visible,
          // dramatically improving scroll performance and initial render time.
          <VirtualizedSitesList
            sites={sites}
            mapInstanceRef={mapInstanceRef}
            mapDivRef={mapDivRef}
            nctId={nctId}
            condition={condition}
            onFindPhysicians={onFindPhysicians}
          />
        )}
      </div>
    </>
  );
}

/**
 * VirtualizedSitesList: Renders trial sites in a virtualized grid.
 * Only renders visible items + buffer, reducing DOM nodes from 50+ to ~5-10.
 * CRITICAL FIX for issue #2: eliminates performance cliff when trials have many sites.
 */
interface VirtualizedSitesListProps {
  sites:             TrialSite[];
  mapInstanceRef:    React.MutableRefObject<any>;
  mapDivRef:         React.MutableRefObject<HTMLDivElement | null>;
  nctId:             string;
  condition:         string | null;
  onFindPhysicians:  (site: SelectedSite) => void;
}

function VirtualizedSitesList({
  sites,
  mapInstanceRef,
  mapDivRef,
  nctId,
  condition,
  onFindPhysicians,
}: VirtualizedSitesListProps) {
  const COLS = 1; // Single column for vertical scroll (simpler than 2D grid)
  const ITEM_HEIGHT = 160; // Approximate height per card
  
  // Memoize the row renderer to prevent recreation on every render
  const Row = useMemo(
    () => ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const site = sites[index];
      const hasCoords = site.lat != null && site.lon != null;

      return (
        <div style={style} className="virtualized-site-wrapper">
          <div
            className="tsm-site-card"
            role={hasCoords ? "button" : undefined}
            tabIndex={hasCoords ? 0 : undefined}
            onClick={() => {
              if (!hasCoords) return;
              if (mapInstanceRef.current) {
                mapInstanceRef.current.setView([site.lat, site.lon], 11);
                mapDivRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasCoords && mapInstanceRef.current) {
                mapInstanceRef.current.setView([site.lat, site.lon], 11);
                mapDivRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <div className="tsm-site-facility">{site.facility || "Unnamed Site"}</div>
              <StatusBadge status={site.status} />
            </div>

            <div className="tsm-site-location">
              {[site.city, site.state, site.country].filter(Boolean).join(", ") || "Location unknown"}
            </div>

            {hasCoords ? (
              <>
                <div className="site-cta">→ Find nearby physicians</div>
                <button
                  style={{
                    display: "block", width: "100%", marginTop: 8,
                    padding: "6px 0", borderRadius: 7,
                    border: "1px solid #bfdbfe", background: "#eff6ff",
                    color: "#2563eb", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "all 0.12s", textAlign: "center",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background   = "#2563eb";
                    e.currentTarget.style.color        = "white";
                    e.currentTarget.style.borderColor  = "#2563eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background   = "#eff6ff";
                    e.currentTarget.style.color        = "#2563eb";
                    e.currentTarget.style.borderColor  = "#bfdbfe";
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
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
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#cdd3e0" }}>No coordinates available</div>
            )}
          </div>
        </div>
      );
    },
    [sites, mapInstanceRef, mapDivRef, nctId, condition, onFindPhysicians]
  );

  return (
    <div style={{ padding: "16px 20px" }}>
      <List
        height={Math.min(600, sites.length * ITEM_HEIGHT)} // Max 600px, scales down for small lists
        itemCount={sites.length}
        itemSize={ITEM_HEIGHT}
        width="100%"
      >
        {Row}
      </List>
    </div>
  );
}