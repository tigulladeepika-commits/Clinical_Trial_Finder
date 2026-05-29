// components/trials/TrialSiteMap.tsx
// v4 fix: removed layer.bringToBack() — not available on MapQuest tile layers

"use client";

import { useEffect, useRef, useState } from "react";
import StatusBadge         from "@/components/shared/StatusBadge";
import type { TrialSite }  from "@/types/trial";
import type { SelectedSite } from "@/types/physician";

// ── Types ─────────────────────────────────────────────────────────────────────

type MapType = "map" | "satellite" | "light" | "dark";
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

const MAP_TYPES: { id: MapType; label: string; icon: string }[] = [
  { id: "map",       label: "Standard",  icon: "🗺" },
  { id: "satellite", label: "Satellite", icon: "🌍" },
  { id: "light",     label: "Light",     icon: "☀️" },
  { id: "dark",      label: "Dark",      icon: "🌙" },
];

const MIN_ZOOM = 0;
const MAX_ZOOM = 20;

interface Props {
  sites:              TrialSite[];
  trialTitle:         string;
  nctId:              string;
  description:        string | null;
  condition:          string | null;
  inclusionCriteria?: string | null;
  exclusionCriteria?: string | null;
  onFindPhysicians:   (site: SelectedSite, radius: number) => void;
}

declare global { interface Window { L: any; } }

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: string | null): string {
  const s = (status || "").toUpperCase().trim();
  if (s === "RECRUITING" || s === "ENROLLING_BY_INVITATION") return "#059669";
  if (s === "NOT_YET_RECRUITING")             return "#d97706";
  if (s.includes("ACTIVE"))                   return "#2563eb";
  if (s === "TERMINATED")                     return "#dc2626";
  if (s === "WITHDRAWN" || s === "SUSPENDED") return "#d97706";
  if (s === "COMPLETED")                      return "#64748b";
  return "#94a3b8";
}

function statusLabel(status: string | null): string {
  return (status || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hospitalMarkerHtml(color: string, size = 28): string {
  return `
    <div style="filter:drop-shadow(0 3px 8px rgba(0,0,0,0.28));cursor:pointer;animation:pinDrop 0.4s cubic-bezier(.34,1.56,.64,1) both;">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="13" fill="${color}" stroke="white" stroke-width="2.5"/>
        <rect x="11" y="7" width="6" height="14" rx="1.5" fill="white"/>
        <rect x="7" y="11" width="14" height="6" rx="1.5" fill="white"/>
      </svg>
    </div>`.trim();
}

const LEGEND = [
  { color: "#059669", label: "Recruiting"                   },
  { color: "#d97706", label: "Not Yet / Suspended"          },
  { color: "#2563eb", label: "Active (not recruiting)"      },
  { color: "#64748b", label: "Completed"                    },
  { color: "#dc2626", label: "Terminated / Withdrawn"       },
  { color: "#94a3b8", label: "Other / Unknown"              },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function TrialSiteMap({
  sites, nctId, description, condition,
  inclusionCriteria, exclusionCriteria, onFindPhysicians,
}: Props) {
  const mapKey         = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef      = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const tileLayerRef   = useRef<any>(null);

  const [showCriteria, setShowCriteria] = useState(false);
  const [showLegend,   setShowLegend]   = useState(false);
  const [mapType,      setMapType]      = useState<MapType>("map");
  const [currentZoom,  setCurrentZoom]  = useState(3);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const mappableSites = sites.filter((s) => s.lat != null && s.lon != null);

  // ── Switch tile layer without destroying the map ──────────────────────────
  const switchMapType = (type: MapType) => {
    if (!mapInstanceRef.current || !window.L?.mapquest) return;
    const L = window.L;
    if (tileLayerRef.current) mapInstanceRef.current.removeLayer(tileLayerRef.current);
    const layer = L.mapquest.tileLayer(type);
    layer.addTo(mapInstanceRef.current);
    // NOTE: layer.bringToBack() removed — not available on MapQuest tile layers
    tileLayerRef.current = layer;
    setMapType(type);
    setShowTypeMenu(false);
  };

  // ── Zoom helpers (clamped 0–20) ───────────────────────────────────────────
  const zoomIn = () => {
    if (!mapInstanceRef.current) return;
    const z = mapInstanceRef.current.getZoom();
    if (z < MAX_ZOOM) { mapInstanceRef.current.setZoom(z + 1); setCurrentZoom(z + 1); }
  };
  const zoomOut = () => {
    if (!mapInstanceRef.current) return;
    const z = mapInstanceRef.current.getZoom();
    if (z > MIN_ZOOM) { mapInstanceRef.current.setZoom(z - 1); setCurrentZoom(z - 1); }
  };
  const fitAll = () => {
    if (!mapInstanceRef.current || mappableSites.length === 0) return;
    mapInstanceRef.current.fitBounds(
      window.L.latLngBounds(mappableSites.map((s) => [s.lat, s.lon])),
      { padding: [44, 44] }
    );
  };

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapKey || mappableSites.length === 0) return;

    let handleMapClick: ((event: MouseEvent) => void) | null = null;

    const initMap = () => {
      if (!mapDivRef.current || mapInstanceRef.current) return;
      const L = window.L;
      if (!L?.mapquest) return;

      L.mapquest.key = mapKey;

      if (!document.getElementById("trial-map-style-v4")) {
        const style = document.createElement("style");
        style.id = "trial-map-style-v4";
        style.textContent = `
          @keyframes pinDrop {
            0%  { transform: translateY(-14px) scale(0.6); opacity: 0; }
            70% { transform: translateY(2px) scale(1.1); opacity: 1; }
            100%{ transform: translateY(0) scale(1); opacity: 1; }
          }
          .trial-tooltip {
            background: white !important; border: 1px solid #e4e7f0 !important;
            border-radius: 10px !important; padding: 8px 12px !important;
            font-size: 12px !important; font-weight: 500 !important;
            color: #0a0f1e !important; box-shadow: 0 6px 20px rgba(0,0,0,0.12) !important;
            white-space: nowrap !important; pointer-events: none !important;
            font-family: 'Sora', sans-serif !important;
          }
          .trial-popup .leaflet-popup-content-wrapper {
            background: white !important; border: 1px solid #e4e7f0 !important;
            border-radius: 16px !important; box-shadow: 0 16px 48px rgba(0,0,0,0.16) !important;
            padding: 0 !important; overflow: hidden !important;
            min-width: 250px !important; max-width: 310px !important;
          }
          .trial-popup .leaflet-popup-content { margin: 0 !important; line-height: 1.5 !important; }
          .trial-popup .leaflet-popup-close-button {
            top: 10px !important; right: 12px !important;
            font-size: 20px !important; color: #94a3b8 !important; font-weight: 300 !important;
          }
          .find-phys-btn {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            width: 100%; margin-top: 10px; padding: 9px 0; border-radius: 10px;
            border: none; background: #047857; color: white;
            font-size: 12px; font-weight: 700; cursor: pointer;
            text-align: center; transition: background 0.14s;
            font-family: 'Sora', sans-serif;
          }
          .find-phys-btn:hover { background: #065f46; }
          .trial-radius-field {
            margin-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 11px;
            color: #475569;
          }
          .trial-radius-field label {
            font-weight: 700;
          }
          .trial-radius-select {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            background: #fff;
            color: #0f172a;
            padding: 8px 10px;
            font-size: 12px;
          }
        `;
        document.head.appendChild(style);
      }

      const lats = mappableSites.map((s) => s.lat as number);
      const lons = mappableSites.map((s) => s.lon as number);

      const initialLayer = L.mapquest.tileLayer("map");
      tileLayerRef.current = initialLayer;

      const map = L.mapquest.map(mapDivRef.current, {
        center:      [(Math.min(...lats) + Math.max(...lons)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2],
        layers:      initialLayer,
        zoom:        3,
        minZoom:     MIN_ZOOM,
        maxZoom:     MAX_ZOOM,
        zoomControl: false,
      });
      mapInstanceRef.current = map;

      map.on("zoomend", () => setCurrentZoom(map.getZoom()));

      handleMapClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest?.(".find-phys-btn") as HTMLButtonElement | null;
        if (!button) return;
        event.preventDefault();
        const indexValue = button.dataset.siteIndex;
        if (indexValue == null) return;
        const siteIndex = Number(indexValue);
        const clickedSite = mappableSites[siteIndex];
        if (!clickedSite) return;
        const popup = button.closest(".leaflet-popup-content");
        const select = popup?.querySelector<HTMLSelectElement>(".trial-radius-select");
        const radius = select ? Number(select.value) : 25;
        onFindPhysicians({
          lat: clickedSite.lat as number,
          lng: clickedSite.lon as number,
          facility: clickedSite.facility,
          city: clickedSite.city,
          state: clickedSite.state,
          nct_id: nctId,
          condition: condition ?? null,
        }, radius);
      };

      if (mapDivRef.current) {
        mapDivRef.current.addEventListener("click", handleMapClick);
      }

      mappableSites.forEach((site, index) => {
        const color  = statusColor(site.status);
        const icon   = L.divIcon({
          html: hospitalMarkerHtml(color, 28),
          className: "", iconSize: [28, 28], iconAnchor: [14, 14],
        });
        const marker = L.marker([site.lat, site.lon], { icon }).addTo(map);
        const loc    = [site.city, site.state, site.country].filter(Boolean).join(", ");

        const radiusOptionsHtml = RADIUS_OPTIONS.map((r) => `<option value="${r}"${r === 25 ? " selected" : ""}>${r} mi</option>`).join("");
        const popupContent = `
          <div>
            <div style="background:${color}10;border-bottom:1px solid ${color}25;padding:14px 16px 12px;">
              <div style="font-weight:700;font-size:13px;color:#0a0f1e;line-height:1.35;padding-right:22px;font-family:'Sora',sans-serif;">
                ${site.facility || "Unknown Facility"}
              </div>
              ${loc ? `<div style="font-size:11px;color:#64748b;margin-top:5px;">📍 ${loc}</div>` : ""}
            </div>
            <div style="padding:12px 16px 14px;">
              ${site.status ? `
                <div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;
                  font-size:11px;font-weight:700;background:${color}14;color:${color};border:1px solid ${color}35;">
                  <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;"></span>
                  ${statusLabel(site.status)}
                </div>` : ""}
              <div class="trial-radius-field">
                <label for="radius-${index}">Radius</label>
                <select id="radius-${index}" class="trial-radius-select" data-site-index="${index}">
                  ${radiusOptionsHtml}
                </select>
              </div>
              <button class="find-phys-btn" data-site-index="${index}" type="button">
                🩺 Find physicians nearby
              </button>
            </div>
          </div>`;

        marker.bindPopup(popupContent, {
          className: "trial-popup",
          offset: [0, -10],
          maxWidth: 310,
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          keepInView: true,
          interactive: true,
        });
        // Close any open popup before opening this one so hover switches cleanly
        marker.on("mouseover", () => { map.closePopup(); marker.openPopup(); });
        marker.on("click",     () => marker.openPopup());
      });

      if (mappableSites.length > 1) {
        map.fitBounds(
          window.L.latLngBounds(mappableSites.map((s) => [s.lat, s.lon])),
          { padding: [44, 44] }
        );
      }
    };

    const loadAndInit = () => {
      if (window.L?.mapquest) { initMap(); return; }
      const iv = setInterval(() => { if (window.L?.mapquest) { clearInterval(iv); initMap(); } }, 100);
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
      script.onload = loadAndInit;
      document.head.appendChild(script);
    } else {
      loadAndInit();
    }

    return () => {
      if (handleMapClick && mapDivRef.current) {
        mapDivRef.current.removeEventListener("click", handleMapClick);
      }
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
      tileLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, sites, nctId]);

  const activeType = MAP_TYPES.find((t) => t.id === mapType)!;

  return (
    <>
      <style>{`
        .tsm-map-wrap { position: relative; flex-shrink: 0; }
        .tsm-map-controls {
          position: absolute; top: 12px; right: 12px; z-index: 1000;
          display: flex; flex-direction: column; gap: 4px; align-items: center;
        }
        .tsm-zoom-badge {
          width: 36px; height: 20px; background: white;
          border: 1px solid var(--border); border-radius: 6px;
          font-size: 10px; font-weight: 700; color: var(--ink-3);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
          font-family: 'IBM Plex Mono', monospace;
        }
        .tsm-map-btn {
          width: 36px; height: 36px; background: white;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          font-size: 17px; font-weight: 700; color: var(--ink-3);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-md); transition: all 0.15s;
        }
        .tsm-map-btn:disabled {
          background: #f8fafc; color: #cbd5e1; cursor: default;
          box-shadow: none;
        }
        .tsm-map-btn:not(:disabled):hover {
          background: var(--blue-50); color: var(--blue-600);
          border-color: var(--blue-200);
          box-shadow: 0 4px 14px rgba(37,99,235,0.15);
        }
        .tsm-type-wrap {
          position: absolute; bottom: 12px; right: 12px; z-index: 1000;
        }
        .tsm-type-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 6px 10px; background: white;
          border: 1px solid var(--border); border-radius: var(--radius-md);
          cursor: pointer; font-size: 11px; font-weight: 600; color: var(--ink-3);
          box-shadow: var(--shadow-md); font-family: var(--font-sans);
          transition: all 0.15s;
        }
        .tsm-type-btn:hover { border-color: var(--blue-400); }
        .tsm-type-menu {
          position: absolute; bottom: calc(100% + 6px); right: 0;
          background: white; border: 1px solid var(--border);
          border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.12);
          overflow: hidden; min-width: 140px;
        }
        .tsm-type-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 8px 14px;
          border: none; cursor: pointer;
          font-size: 12px; font-family: var(--font-sans);
          transition: background 0.1s;
        }
        .tsm-type-item:hover { background: var(--surface); }
        .tsm-legend-toggle {
          position: absolute; top: 12px; left: 12px; z-index: 1000;
          background: white; border: 1px solid var(--border);
          border-radius: var(--radius-md); padding: 7px 12px;
          box-shadow: var(--shadow-md); cursor: pointer;
          font-size: 11px; font-weight: 600; color: var(--ink-3);
          display: flex; align-items: center; gap: 5px;
          transition: all 0.15s; font-family: var(--font-sans);
        }
        .tsm-legend-toggle:hover { background: var(--surface); border-color: var(--border-mid); }
        .tsm-legend-panel {
          position: absolute; top: 46px; left: 12px; z-index: 1000;
          background: rgba(255,255,255,0.97); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 12px 16px;
          box-shadow: var(--shadow-lg);
          display: flex; flex-direction: column; gap: 8px;
          pointer-events: none; max-width: 230px;
          animation: fadeUp 0.18s ease both;
        }
        .tsm-legend-title {
          font-size: 9px; font-weight: 700; letter-spacing: 1px;
          text-transform: uppercase; color: var(--muted); margin-bottom: 3px;
        }
        .tsm-legend-row   { display: flex; align-items: center; gap: 8px; }
        .tsm-legend-label { font-size: 11px; color: var(--ink-3); font-weight: 500; line-height: 1.3; }
        .tsm-section-hdr {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 1px; color: var(--muted);
          padding: 18px 20px 8px; border-bottom: 1px solid var(--border);
          background: #fff; position: sticky; top: 0; z-index: 5;
        }
        .tsm-desc { font-size: 13px; color: var(--ink-3); line-height: 1.75; padding: 14px 20px 18px; }
        .tsm-criteria-wrap { padding: 0 20px 18px; }
        .tsm-criteria-toggle {
          width: 100%; padding: 11px 16px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          display: flex; align-items: center; justify-content: space-between;
          cursor: pointer; font-family: var(--font-sans);
          font-size: 13px; font-weight: 600; color: var(--ink-2);
          transition: all 0.15s;
        }
        .tsm-criteria-toggle:hover { background: var(--surface-2); border-color: var(--border-mid); }
        .tsm-criteria-body {
          padding: 14px 16px; background: var(--surface);
          border: 1px solid var(--border); border-top: none;
          border-radius: 0 0 var(--radius-lg) var(--radius-lg);
          display: flex; flex-direction: column; gap: 14px;
          animation: fadeIn 0.18s ease both;
        }
        .tsm-crit-label {
          font-size: 10px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.6px; margin-bottom: 5px;
        }
        .tsm-crit-text { font-size: 12px; color: var(--ink-3); line-height: 1.7; }
        .tsm-site-card {
          background: #fff; border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 13px 15px;
          cursor: pointer; outline: none;
          transition: all 0.16s cubic-bezier(.22,1,.36,1);
          margin-bottom: 8px; position: relative; overflow: hidden;
        }
        .tsm-site-card::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: transparent; transition: background 0.14s;
        }
        .tsm-site-card:hover { border-color: var(--blue-400); box-shadow: 0 4px 16px rgba(37,99,235,0.10); transform: translateY(-1px); }
        .tsm-site-card:hover::before { background: var(--green-500); }
        .tsm-site-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
        .tsm-facility { font-size: 13px; font-weight: 500; color: var(--ink); flex: 1; }
        .tsm-location { font-size: 11px; color: var(--muted); margin-bottom: 8px; }
        .tsm-site-focus { opacity: 0; transition: opacity 0.15s; font-size: 11px; font-weight: 600; color: var(--blue-600); letter-spacing: 0.3px; }
        .tsm-site-card:hover .tsm-site-focus { opacity: 1; }
        .tsm-find-btn {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          width: 100%; margin-top: 9px; padding: 8px 0; border-radius: var(--radius-md);
          border: 1px solid var(--blue-200); background: var(--blue-50);
          color: var(--blue-600); font-size: 11px; font-weight: 700;
          cursor: pointer; font-family: var(--font-sans); transition: all 0.15s;
        }
        .tsm-find-btn:hover { background: var(--blue-600); color: #fff; border-color: var(--blue-600); box-shadow: 0 3px 10px rgba(37,99,235,0.25); }
        .tsm-no-coords { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted-light); margin-top: 5px; }
        .tsm-sites-list { padding: 12px 20px 24px; }
        .tsm-empty-map { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: var(--surface-2); color: var(--muted); }
      `}</style>

      {/* ── Map ──────────────────────────────────────────────────────────── */}
      <div className="tsm-map-wrap">
        {!mapKey || mappableSites.length === 0 ? (
          <div className="tsm-empty-map" style={{ height: 420 }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.35 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-3)" }}>
              {!mapKey ? "MapQuest key not configured" : "No geocoded sites available"}
            </div>
            <div style={{ fontSize: 12, maxWidth: 240, textAlign: "center", lineHeight: 1.6 }}>
              {!mapKey
                ? "Set NEXT_PUBLIC_MAPQUEST_KEY in your environment"
                : "Site location data was not returned from ClinicalTrials.gov"}
            </div>
          </div>
        ) : (
          <>
            <div ref={mapDivRef} style={{ height: 420, width: "100%", background: "#e8edf2" }} />

            {/* Zoom controls + badge — top-right */}
            <div className="tsm-map-controls">
              <div className="tsm-zoom-badge">{currentZoom}</div>
              {[
                { icon: "+", title: "Zoom in",  fn: zoomIn,  disabled: currentZoom >= MAX_ZOOM },
                { icon: "−", title: "Zoom out", fn: zoomOut, disabled: currentZoom <= MIN_ZOOM },
                { icon: "⊡", title: "Fit all",  fn: fitAll,  disabled: false },
              ].map((b) => (
                <button
                  key={b.title} title={b.title} onClick={b.fn}
                  disabled={b.disabled} className="tsm-map-btn"
                >
                  {b.icon}
                </button>
              ))}
            </div>

            {/* Map type switcher — bottom-right */}
            <div className="tsm-type-wrap">
              {showTypeMenu && (
                <div className="tsm-type-menu">
                  {MAP_TYPES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => switchMapType(t.id)}
                      className="tsm-type-item"
                      style={{
                        background:  t.id === mapType ? "var(--blue-50)"  : "transparent",
                        fontWeight:  t.id === mapType ? 700 : 500,
                        color:       t.id === mapType ? "var(--blue-600)" : "var(--ink-3)",
                        borderLeft:  t.id === mapType ? "3px solid var(--blue-500)" : "3px solid transparent",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{t.icon}</span>
                      {t.label}
                      {t.id === mapType && <span style={{ marginLeft: "auto", fontSize: 10 }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
              <button
                className="tsm-type-btn"
                style={{ borderColor: showTypeMenu ? "var(--blue-400)" : "var(--border)" }}
                onClick={() => setShowTypeMenu((v) => !v)}
                title="Change map type"
              >
                <span style={{ fontSize: 13 }}>{activeType.icon}</span>
                {activeType.label}
                <span style={{ fontSize: 9, color: "var(--muted)", marginLeft: 2 }}>▲</span>
              </button>
            </div>

            {/* Legend toggle — top-left */}
            <button className="tsm-legend-toggle" onClick={() => setShowLegend((v) => !v)}>
              <span>◎</span>
              {showLegend ? "Hide legend" : "Status legend"}
            </button>

            {showLegend && (
              <div className="tsm-legend-panel">
                <div className="tsm-legend-title">Site Status</div>
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
            )}
          </>
        )}
      </div>

      {/* ── Below-map content ─────────────────────────────────────────────── */}
      <div>
        {description && (
          <>
            <div className="tsm-section-hdr">About This Trial</div>
            <p className="tsm-desc">{description}</p>
          </>
        )}

        {(inclusionCriteria || exclusionCriteria) && (
          <div className="tsm-criteria-wrap">
            <button
              className="tsm-criteria-toggle"
              style={{ borderRadius: showCriteria ? "var(--radius-lg) var(--radius-lg) 0 0" : "var(--radius-lg)" }}
              onClick={() => setShowCriteria((v) => !v)}
            >
              <span>Eligibility Criteria</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>
                {showCriteria ? "▲ Collapse" : "▼ Expand"}
              </span>
            </button>
            {showCriteria && (
              <div className="tsm-criteria-body">
                {inclusionCriteria && (
                  <div>
                    <div className="tsm-crit-label" style={{ color: "var(--green-700)" }}>Inclusion criteria</div>
                    <p className="tsm-crit-text">{inclusionCriteria}</p>
                  </div>
                )}
                {exclusionCriteria && (
                  <div>
                    <div className="tsm-crit-label" style={{ color: "var(--coral-600)" }}>Exclusion criteria</div>
                    <p className="tsm-crit-text">{exclusionCriteria}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="tsm-section-hdr">
          All Locations — {sites.length} site{sites.length !== 1 ? "s" : ""}
        </div>

        {sites.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: "14px 20px" }}>
            No site data available for this trial.
          </p>
        ) : (
          <div className="tsm-sites-list">
            {sites.map((site, i) => {
              const hasCoords = site.lat != null && site.lon != null;
              return (
                <div
                  key={`${site.facility}-${i}`}
                  className={`tsm-site-card card-anim-${Math.min(i + 1, 5)}`}
                  role={hasCoords ? "button" : undefined}
                  tabIndex={hasCoords ? 0 : undefined}
                  onClick={() => {
                    if (!hasCoords || !mapInstanceRef.current) return;
                    mapInstanceRef.current.setView([site.lat, site.lon], 11);
                    mapDivRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && hasCoords && mapInstanceRef.current)
                      mapInstanceRef.current.setView([site.lat, site.lon], 11);
                  }}
                >
                  <div className="tsm-site-header">
                    <div className="tsm-facility">{site.facility || "Unnamed Site"}</div>
                    <StatusBadge status={site.status} />
                  </div>
                  <div className="tsm-location">
                    {[site.city, site.state, site.country].filter(Boolean).join(", ") || "Location unknown"}
                  </div>
                  {hasCoords ? (
                    <>
                      <div className="tsm-site-focus">→ Click to focus map</div>
                      <button
                        className="tsm-find-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFindPhysicians({
                            lat: site.lat as number, lng: site.lon as number,
                            facility: site.facility, city: site.city,
                            state: site.state, nct_id: nctId, condition: condition ?? null,
                          }, 25);
                        }}
                      >
                        🩺 Find physicians nearby
                      </button>
                    </>
                  ) : (
                    <div className="tsm-no-coords">
                      <span>○</span> No map coordinates available
                    </div>
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