// components/trials/TrialSiteMap.tsx
// v7: two separate map containers — inline + modal — no DOM teleport

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import StatusBadge           from "@/components/shared/StatusBadge";
import type { TrialSite }    from "@/types/trial";
import type { SelectedSite } from "@/types/physician";

type MapType = "map" | "satellite" | "light" | "dark";
const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;

const MAP_TYPES: { id: MapType; label: string; icon: string }[] = [
  { id: "map",       label: "Standard",  icon: "🗺"  },
  { id: "satellite", label: "Satellite", icon: "🌍" },
  { id: "light",     label: "Light",     icon: "☀️"  },
  { id: "dark",      label: "Dark",      icon: "🌙"  },
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
  return `<div style="filter:drop-shadow(0 3px 8px rgba(0,0,0,0.28));cursor:pointer;">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="13" fill="${color}" stroke="white" stroke-width="2.5"/>
      <rect x="11" y="7" width="6" height="14" rx="1.5" fill="white"/>
      <rect x="7" y="11" width="14" height="6" rx="1.5" fill="white"/>
    </svg></div>`.trim();
}

const LEGEND = [
  { color: "#059669", label: "Recruiting"              },
  { color: "#d97706", label: "Not Yet / Suspended"     },
  { color: "#2563eb", label: "Active (not recruiting)" },
  { color: "#64748b", label: "Completed"               },
  { color: "#dc2626", label: "Terminated / Withdrawn"  },
  { color: "#94a3b8", label: "Other / Unknown"         },
];

export default function TrialSiteMap({
  sites, trialTitle, nctId, description, condition,
  inclusionCriteria, exclusionCriteria, onFindPhysicians,
}: Props) {
  const mapKey = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";

  const [isExpanded,   setIsExpanded]   = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showLegend,   setShowLegend]   = useState(false);
  const [mapType,      setMapType]      = useState<MapType>("map");
  const [currentZoom,  setCurrentZoom]  = useState(3);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  // Two separate DOM refs — one per container
  const inlineMapRef = useRef<HTMLDivElement>(null);
  const modalMapRef  = useRef<HTMLDivElement>(null);

  // Two separate map instances
  const inlineInstanceRef = useRef<any>(null);
  const modalInstanceRef  = useRef<any>(null);
  const inlineTileRef     = useRef<any>(null);
  const modalTileRef      = useRef<any>(null);

  const mappableSites = sites.filter((s) => s.lat != null && s.lon != null);

  // ── Inject global styles once ────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("tsm-global-v7")) return;
    const style = document.createElement("style");
    style.id = "tsm-global-v7";
    style.textContent = `
      .trial-popup .leaflet-popup-content-wrapper {
        background:white!important;border:1px solid #e4e7f0!important;
        border-radius:16px!important;box-shadow:0 16px 48px rgba(0,0,0,.16)!important;
        padding:0!important;overflow:hidden!important;min-width:250px!important;max-width:310px!important;
      }
      .trial-popup .leaflet-popup-content{margin:0!important;line-height:1.5!important;}
      .trial-popup .leaflet-popup-close-button{top:10px!important;right:12px!important;font-size:20px!important;color:#94a3b8!important;font-weight:300!important;}
      .find-phys-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:10px;padding:9px 0;border-radius:10px;border:none;background:#047857;color:white;font-size:12px;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;transition:background .14s;}
      .find-phys-btn:hover{background:#065f46;}
      .trial-radius-field{margin-top:12px;display:flex;flex-direction:column;gap:6px;font-size:11px;color:#475569;}
      .trial-radius-field label{font-weight:700;}
      .trial-radius-select{width:100%;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;padding:8px 10px;font-size:12px;}
      @keyframes tsmFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes tsmModalIn{from{opacity:0;transform:scale(.96) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
      .tsm-backdrop{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;animation:tsmFadeIn .22s ease both;}
      .tsm-modal{position:relative;width:100%;max-width:1100px;height:80vh;max-height:780px;background:white;border-radius:20px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.28);animation:tsmModalIn .26s cubic-bezier(.22,1,.36,1) both;}
      .tsm-close{position:absolute;top:14px;right:14px;z-index:1101;width:36px;height:36px;background:white;border:1px solid #e2e8f0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#64748b;box-shadow:0 2px 8px rgba(0,0,0,.12);transition:all .15s;}
      .tsm-close:hover{background:#fee2e2;color:#dc2626;border-color:#fecaca;}
    `;
    document.head.appendChild(style);
  }, []);

  // ── Load Leaflet scripts once ─────────────────────────────────────────────
  const loadLeaflet = useCallback((cb: () => void) => {
    const ready = () => window.L?.mapquest;
    if (ready()) { cb(); return; }

    const addLink = (id: string, href: string, preload = false) => {
      if (document.getElementById(id)) return;
      // Add preload hint first for faster fetch
      if (preload) {
        const pre = document.createElement("link");
        pre.rel = "preload"; pre.as = "style"; pre.href = href;
        document.head.appendChild(pre);
      }
      const l = document.createElement("link");
      l.id = id; l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
    };
    // Load all CSS immediately in parallel
    addLink("mq-css",    "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.css", true);
    addLink("mc-css-t",  "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css", true);
    addLink("mc-css2-t", "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css", true);

    const waitReady = (afterLoad: () => void) => {
      if (ready()) { afterLoad(); return; }
      const iv = setInterval(() => { if (ready()) { clearInterval(iv); afterLoad(); } }, 50);
    };

    // Load MarkerCluster in parallel with MapQuest (doesn't depend on it)
    const loadMC = () => {
      if (document.getElementById("mc-js-t")) return;
      const mc = document.createElement("script"); mc.id = "mc-js-t";
      mc.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js";
      mc.async = true; mc.defer = true;
      document.head.appendChild(mc);
    };

    if (document.getElementById("mq-js")) {
      loadMC();
      waitReady(cb);
      return;
    }
    const s = document.createElement("script"); s.id = "mq-js";
    s.src = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
    s.async = true;
    s.onload = () => { loadMC(); waitReady(cb); };
    document.head.appendChild(s);
  }, []);

  // ── Core map builder — works for both inline and modal containers ─────────
  const buildMap = useCallback((
    container: HTMLDivElement,
    instanceRef: React.MutableRefObject<any>,
    tileRef: React.MutableRefObject<any>,
    clickHandlerRef: React.MutableRefObject<((e: MouseEvent) => void) | null>,
  ) => {
    if (!container || instanceRef.current) return;
    const L = window.L;
    if (!L?.mapquest) return;
    L.mapquest.key = mapKey;

    const lats = mappableSites.map((s) => s.lat as number);
    const lons = mappableSites.map((s) => s.lon as number);

    const tile = L.mapquest.tileLayer(mapType);
    tileRef.current = tile;

    const map = L.mapquest.map(container, {
      center: [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2],
      layers: tile, zoom: 3, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomControl: false,
    });
    instanceRef.current = map;
    map.on("zoomend", () => setCurrentZoom(map.getZoom()));

    // Click handler for Find Physicians button inside popups
    const handleClick = (event: MouseEvent) => {
      const btn = (event.target as HTMLElement)?.closest?.(".find-phys-btn") as HTMLButtonElement | null;
      if (!btn) return;
      event.preventDefault();
      const idx = Number(btn.dataset.siteIndex);
      const site = mappableSites[idx];
      if (!site) return;
      const popup = btn.closest(".leaflet-popup-content");
      const sel   = popup?.querySelector<HTMLSelectElement>(".trial-radius-select");
      onFindPhysicians({
        lat: site.lat as number, lng: site.lon as number,
        facility: site.facility, city: site.city, state: site.state,
        nct_id: nctId, condition: condition ?? null,
      }, sel ? Number(sel.value) : 25);
    };
    clickHandlerRef.current = handleClick;
    container.addEventListener("click", handleClick);

    // Add markers
    mappableSites.forEach((site, index) => {
      const color = statusColor(site.status);
      const icon  = L.divIcon({ html: hospitalMarkerHtml(color, 28), className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker([site.lat, site.lon], { icon }).addTo(map);
      const loc    = [site.city, site.state, site.country].filter(Boolean).join(", ");
      const opts   = RADIUS_OPTIONS.map((r) => `<option value="${r}"${r === 25 ? " selected" : ""}>${r} mi</option>`).join("");
      const popup  = `
        <div>
          <div style="background:${color}10;border-bottom:1px solid ${color}25;padding:14px 16px 12px;">
            <div style="font-weight:700;font-size:13px;color:#0a0f1e;line-height:1.35;padding-right:22px;font-family:'Sora',sans-serif;">
              ${site.facility || "Unknown Facility"}
            </div>
            ${loc ? `<div style="font-size:11px;color:#64748b;margin-top:5px;">📍 ${loc}</div>` : ""}
          </div>
          <div style="padding:12px 16px 14px;">
            ${site.status ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${color}14;color:${color};border:1px solid ${color}35;">
              <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;"></span>
              ${statusLabel(site.status)}</div>` : ""}
            <div class="trial-radius-field">
              <label>Radius</label>
              <select class="trial-radius-select" data-site-index="${index}">${opts}</select>
            </div>
            <button class="find-phys-btn" data-site-index="${index}" type="button">🩺 Find physicians nearby</button>
          </div>
        </div>`;
      marker.bindPopup(popup, { className: "trial-popup", offset: [0, -10], maxWidth: 310, closeButton: true, autoClose: false, closeOnClick: false, keepInView: true, autoPan: true });
      marker.on("mouseover", () => { map.closePopup(); marker.openPopup(); });
      marker.on("click",     () => marker.openPopup());
    });

    if (mappableSites.length > 1) {
      map.fitBounds(window.L.latLngBounds(mappableSites.map((s) => [s.lat, s.lon])), { padding: [44, 44] });
    }
  }, [mapKey, mappableSites, mapType, nctId, condition, onFindPhysicians]);

  // ── Inline map init ───────────────────────────────────────────────────────
  const inlineClickRef = useRef<((e: MouseEvent) => void) | null>(null);
  useEffect(() => {
    if (!mapKey || mappableSites.length === 0) return;
    loadLeaflet(() => {
      if (inlineMapRef.current) buildMap(inlineMapRef.current, inlineInstanceRef, inlineTileRef, inlineClickRef);
    });
    return () => {
      if (inlineClickRef.current && inlineMapRef.current)
        inlineMapRef.current.removeEventListener("click", inlineClickRef.current);
      if (inlineInstanceRef.current) { inlineInstanceRef.current.remove(); inlineInstanceRef.current = null; }
      inlineTileRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, sites, nctId]);

  // ── Modal map init (when modal opens) ─────────────────────────────────────
  const modalClickRef = useRef<((e: MouseEvent) => void) | null>(null);
  useEffect(() => {
    if (!isExpanded) {
      // Destroy modal map on close so it rebuilds fresh next open
      if (modalClickRef.current && modalMapRef.current)
        modalMapRef.current.removeEventListener("click", modalClickRef.current);
      if (modalInstanceRef.current) { modalInstanceRef.current.remove(); modalInstanceRef.current = null; }
      modalTileRef.current = null;
      return;
    }
    document.body.style.overflow = "hidden";
    // Small delay to ensure modal DOM is painted before Leaflet init
    const tid = setTimeout(() => {
      loadLeaflet(() => {
        if (modalMapRef.current) buildMap(modalMapRef.current, modalInstanceRef, modalTileRef, modalClickRef);
      });
    }, 60);
    return () => {
      clearTimeout(tid);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  // ── Tile-layer switcher (applies to whichever instance is active) ─────────
  const switchMapType = (type: MapType) => {
    const instance = isExpanded ? modalInstanceRef.current : inlineInstanceRef.current;
    const tileRef  = isExpanded ? modalTileRef             : inlineTileRef;
    if (!instance || !window.L?.mapquest) return;
    if (tileRef.current) instance.removeLayer(tileRef.current);
    const layer = window.L.mapquest.tileLayer(type);
    layer.addTo(instance);
    tileRef.current = layer;
    setMapType(type);
    setShowTypeMenu(false);
  };

  const activeInstance = () => isExpanded ? modalInstanceRef.current : inlineInstanceRef.current;

  const zoomIn = () => {
    const m = activeInstance(); if (!m) return;
    const z = m.getZoom(); if (z < MAX_ZOOM) { m.setZoom(z + 1); setCurrentZoom(z + 1); }
  };
  const zoomOut = () => {
    const m = activeInstance(); if (!m) return;
    const z = m.getZoom(); if (z > MIN_ZOOM) { m.setZoom(z - 1); setCurrentZoom(z - 1); }
  };
  const fitAll = () => {
    const m = activeInstance(); if (!m || mappableSites.length === 0) return;
    m.fitBounds(window.L.latLngBounds(mappableSites.map((s) => [s.lat, s.lon])), { padding: [44, 44] });
  };

  const activeType = MAP_TYPES.find((t) => t.id === mapType)!;

  // ── Map overlay controls (zoom + type + legend) ───────────────────────────
  // In modal: ✕ is top-right, zoom shifts below it. Legend is top-left, no conflict.
  const Controls = ({ expanded = false }: { expanded?: boolean }) => (
    <>
      {/* Zoom — top-right, shifted below ✕ button in modal */}
      <div style={{ position: "absolute", top: expanded ? 60 : 12, right: 12, zIndex: 1000, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
        <div style={{ width: 36, height: 20, background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>{currentZoom}</div>
        {[
          { icon: "+", title: "Zoom in",  fn: zoomIn,  disabled: currentZoom >= MAX_ZOOM },
          { icon: "−", title: "Zoom out", fn: zoomOut, disabled: currentZoom <= MIN_ZOOM },
          { icon: "⊡", title: "Fit all",  fn: fitAll,  disabled: false },
        ].map((b) => (
          <button key={b.title} title={b.title} onClick={b.fn} disabled={b.disabled}
            style={{ width: 36, height: 36, background: b.disabled ? "#f8fafc" : "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 17, fontWeight: 700, color: b.disabled ? "#cbd5e1" : "#334155", cursor: b.disabled ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,.08)" }}>{b.icon}</button>
        ))}
      </div>

      {/* Type switcher — bottom-right */}
      <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 1000 }}>
        {showTypeMenu && (
          <div style={{ position: "absolute", bottom: "calc(100% + 6px)", right: 0, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,.12)", overflow: "hidden", minWidth: 140 }}>
            {MAP_TYPES.map((t) => (
              <button key={t.id} onClick={() => switchMapType(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 12, background: t.id === mapType ? "#eff6ff" : "transparent", fontWeight: t.id === mapType ? 700 : 500, color: t.id === mapType ? "#2563eb" : "#334155", borderLeft: t.id === mapType ? "3px solid #2563eb" : "3px solid transparent" }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span>{t.label}
                {t.id === mapType && <span style={{ marginLeft: "auto", fontSize: 10 }}>✓</span>}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setShowTypeMenu((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", background: "white", border: `1px solid ${showTypeMenu ? "#3b82f6" : "#e2e8f0"}`, borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#334155", boxShadow: "0 2px 6px rgba(0,0,0,.08)" }}>
          <span style={{ fontSize: 13 }}>{activeType.icon}</span>{activeType.label}
          <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 2 }}>▲</span>
        </button>
      </div>

      {/* Legend toggle — top-left, no conflict with ✕ which is top-right */}
      <button onClick={() => setShowLegend((v) => !v)}
        style={{ position: "absolute", top: 12, left: 12, zIndex: 1000, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", boxShadow: "0 2px 6px rgba(0,0,0,.08)", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#334155", display: "flex", alignItems: "center", gap: 5 }}>
        <span>◎</span>{showLegend ? "Hide legend" : "Status legend"}
      </button>
      {showLegend && (
        <div style={{ position: "absolute", top: 46, left: 12, zIndex: 1000, background: "rgba(255,255,255,.97)", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px", boxShadow: "0 6px 20px rgba(0,0,0,.1)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#94a3b8", marginBottom: 3 }}>Site Status</div>
          {LEGEND.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                <circle cx="14" cy="14" r="13" fill={l.color}/>
                <rect x="11" y="7" width="6" height="14" rx="1.5" fill="white"/>
                <rect x="7" y="11" width="14" height="6" rx="1.5" fill="white"/>
              </svg>
              <span style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>{l.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      <style>{`
        .tsm-section-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);padding:18px 20px 8px;border-bottom:1px solid var(--border);background:#fff;position:sticky;top:0;z-index:5;}
        .tsm-desc{font-size:13px;color:var(--ink-3);line-height:1.75;padding:14px 20px 18px;}
        .tsm-criteria-wrap{padding:0 20px 18px;}
        .tsm-criteria-toggle{width:100%;padding:11px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-family:var(--font-sans);font-size:13px;font-weight:600;color:var(--ink-2);transition:all .15s;}
        .tsm-criteria-toggle:hover{background:var(--surface-2);border-color:var(--border-mid);}
        .tsm-criteria-body{padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-lg) var(--radius-lg);display:flex;flex-direction:column;gap:14px;}
        .tsm-crit-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;}
        .tsm-crit-text{font-size:12px;color:var(--ink-3);line-height:1.7;}
        .tsm-site-card{background:#fff;border:1px solid var(--border);border-radius:var(--radius-lg);padding:13px 15px;cursor:pointer;outline:none;transition:all .16s cubic-bezier(.22,1,.36,1);margin-bottom:8px;position:relative;overflow:hidden;}
        .tsm-site-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:background .14s;}
        .tsm-site-card:hover{border-color:var(--blue-400);box-shadow:0 4px 16px rgba(37,99,235,.10);transform:translateY(-1px);}
        .tsm-site-card:hover::before{background:var(--green-500);}
        .tsm-site-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px;}
        .tsm-facility{font-size:13px;font-weight:500;color:var(--ink);flex:1;}
        .tsm-location{font-size:11px;color:var(--muted);margin-bottom:8px;}
        .tsm-site-focus{opacity:0;transition:opacity .15s;font-size:11px;font-weight:600;color:var(--blue-600);}
        .tsm-site-card:hover .tsm-site-focus{opacity:1;}
        .tsm-find-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:9px;padding:8px 0;border-radius:var(--radius-md);border:1px solid var(--blue-200);background:var(--blue-50);color:var(--blue-600);font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font-sans);transition:all .15s;}
        .tsm-find-btn:hover{background:var(--blue-600);color:#fff;border-color:var(--blue-600);}
        .tsm-no-coords{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted-light);margin-top:5px;}
        .tsm-sites-list{padding:12px 20px 24px;}
        .tsm-empty-map{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--surface-2);color:var(--muted);}
      `}</style>

      {/* ── Inline map ───────────────────────────────────────────────────── */}
      <div style={{ position: "relative", width: "100%", minHeight: 420 }}>
        {!mapKey || mappableSites.length === 0 ? (
          <div className="tsm-empty-map" style={{ height: 420 }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.35 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-3)" }}>
              {!mapKey ? "MapQuest key not configured" : "No geocoded sites available"}
            </div>
          </div>
        ) : (
          <>
            <div ref={inlineMapRef} style={{ height: 420, width: "100%", background: "#e8edf2" }} />
            <Controls expanded={false} />
            {/* Expand button */}
            <button onClick={() => setIsExpanded(true)} title="Expand map"
              style={{ position: "absolute", bottom: 56, right: 10, zIndex: 1000, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.12)", fontSize: 14, color: "#374151" }}>
              ⛶
            </button>
          </>
        )}
      </div>

      {/* ── Modal overlay ────────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="tsm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsExpanded(false); }}>
          <div className="tsm-modal">
            <button className="tsm-close" onClick={() => setIsExpanded(false)} title="Close">✕</button>
            {/* Fresh map div for modal — Leaflet inits here independently */}
            <div ref={modalMapRef} style={{ width: "100%", height: "100%", background: "#e8edf2" }} />
            <Controls expanded={true} />
          </div>
        </div>
      )}

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
            <button className="tsm-criteria-toggle"
              style={{ borderRadius: showCriteria ? "var(--radius-lg) var(--radius-lg) 0 0" : "var(--radius-lg)" }}
              onClick={() => setShowCriteria((v) => !v)}>
              <span>Eligibility Criteria</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{showCriteria ? "▲ Collapse" : "▼ Expand"}</span>
            </button>
            {showCriteria && (
              <div className="tsm-criteria-body">
                {(() => {
                  let inclText = inclusionCriteria || "";
                  let exclText = exclusionCriteria || "";
                  const splitIdx = inclText.search(/exclusion criteria/i);
                  if (splitIdx > 0 && !exclText) { exclText = inclText.slice(splitIdx); inclText = inclText.slice(0, splitIdx); }
                  const parseLines = (t: string) => t.split(/\n/).map((l) => l.replace(/^[-•*0-9.\s]+/, "").trim()).filter((l) => l && !/^(inclusion|exclusion)\s*criteria\s*:?$/i.test(l));
                  return (
                    <>
                      {inclText && <div style={{ marginBottom: 12 }}>
                        <div className="tsm-crit-label" style={{ color: "var(--green-700)", marginBottom: 6 }}>Inclusion Criteria</div>
                        <ul style={{ margin: 0, paddingLeft: 18, listStyleType: "disc" }}>{parseLines(inclText).map((l, i) => <li key={i} className="tsm-crit-text" style={{ marginBottom: 4 }}>{l}</li>)}</ul>
                      </div>}
                      {exclText && <div>
                        <div className="tsm-crit-label" style={{ color: "var(--coral-600)", marginBottom: 6 }}>Exclusion Criteria</div>
                        <ul style={{ margin: 0, paddingLeft: 18, listStyleType: "disc" }}>{parseLines(exclText).map((l, i) => <li key={i} className="tsm-crit-text" style={{ marginBottom: 4 }}>{l}</li>)}</ul>
                      </div>}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        <div className="tsm-section-hdr">All Locations — {sites.length} site{sites.length !== 1 ? "s" : ""}</div>
        {sites.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: "14px 20px" }}>No site data available for this trial.</p>
        ) : (
          <div className="tsm-sites-list">
            {sites.map((site, i) => {
              const hasCoords = site.lat != null && site.lon != null;
              return (
                <div key={`${site.facility}-${i}`} className={`tsm-site-card card-anim-${Math.min(i + 1, 5)}`}
                  role={hasCoords ? "button" : undefined} tabIndex={hasCoords ? 0 : undefined}
                  onClick={() => { if (!hasCoords || !inlineInstanceRef.current) return; inlineInstanceRef.current.setView([site.lat, site.lon], 11); inlineMapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && hasCoords && inlineInstanceRef.current) inlineInstanceRef.current.setView([site.lat, site.lon], 11); }}>
                  <div className="tsm-site-header">
                    <div className="tsm-facility">{site.facility || "Unnamed Site"}</div>
                    <StatusBadge status={site.status} />
                  </div>
                  <div className="tsm-location">{[site.city, site.state, site.country].filter(Boolean).join(", ") || "Location unknown"}</div>
                  {hasCoords ? (
                    <>
                      <div className="tsm-site-focus">→ Click to focus map</div>
                      <button className="tsm-find-btn" onClick={(e) => { e.stopPropagation(); onFindPhysicians({ lat: site.lat as number, lng: site.lon as number, facility: site.facility, city: site.city, state: site.state, nct_id: nctId, condition: condition ?? null }, 25); }}>
                        🩺 Find physicians nearby
                      </button>
                    </>
                  ) : (
                    <div className="tsm-no-coords"><span>○</span> No map coordinates available</div>
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