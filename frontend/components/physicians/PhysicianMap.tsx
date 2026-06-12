// components/physicians/PhysicianMap.tsx
// v8: fixed height, two independent map instances, modal overlay

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Physician }    from "@/types/physician";
import type { SelectedSite } from "@/types/physician";

type MapType = "map" | "satellite" | "light" | "dark";

const MAP_TYPES: { id: MapType; label: string; icon: string }[] = [
  { id: "map",       label: "Standard",  icon: "🗺"  },
  { id: "satellite", label: "Satellite", icon: "🌍" },
  { id: "light",     label: "Light",     icon: "☀️"  },
  { id: "dark",      label: "Dark",      icon: "🌙"  },
];

const MIN_ZOOM = 0;
const MAX_ZOOM = 20;
const DEFAULT_HEIGHT = 480; // fixed px height for inline map

type Props = {
  physicians:           Physician[];
  suggestedPhysicians?: Physician[];
  selectedSite:         SelectedSite;
  radius:               number;
  selectedNpi:          string | null;
  onSelect:             (p: Physician) => void;
};

declare global { interface Window { L: any; } }

function hospitalMarkerHtml(color = "#ef4444", size = 30): string {
  return `<div style="filter:drop-shadow(0 2px 8px rgba(0,0,0,.30));cursor:pointer;">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="2.5"/>
      <rect x="12" y="7" width="6" height="16" rx="1.5" fill="white"/>
      <rect x="7" y="12" width="16" height="6" rx="1.5" fill="white"/>
    </svg></div>`.trim();
}

function doctorMarkerHtml(color: string, size: number, selected: boolean): string {
  const glow = selected ? `filter:drop-shadow(0 0 8px ${color});` : "filter:drop-shadow(0 2px 6px rgba(0,0,0,.25));";
  return `<div style="${glow}cursor:pointer;">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="${selected ? 3 : 2}"/>
      <circle cx="15" cy="11" r="4" fill="white"/>
      <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
      <path d="M12 17.5 Q10 21 13 22.5" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <circle cx="13.5" cy="23" r="1.2" fill="${color}"/>
    </svg></div>`.trim();
}

function suggestedMarkerHtml(color: string, size: number, selected: boolean): string {
  const glow = selected ? `filter:drop-shadow(0 0 8px ${color});` : "filter:drop-shadow(0 2px 6px rgba(0,0,0,.22));";
  return `<div style="${glow}cursor:pointer;">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="${selected ? 3 : 2}"/>
      <circle cx="15" cy="11" r="4" fill="white"/>
      <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
      <polygon points="24,5 25,8 28,8 25.5,10 26.5,13 24,11.5 21.5,13 22.5,10 20,8 23,8" fill="#fbbf24" stroke="white" stroke-width=".5"/>
    </svg></div>`.trim();
}

export default function PhysicianMap({
  physicians, suggestedPhysicians = [], selectedSite, radius, selectedNpi, onSelect,
}: Props) {
  const mapKey = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";

  const [mapType,      setMapType]      = useState<MapType>("map");
  const [currentZoom,  setCurrentZoom]  = useState(10);
  const [isExpanded,   setIsExpanded]   = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  // Two separate DOM refs
  const inlineMapRef = useRef<HTMLDivElement>(null);
  const modalMapRef  = useRef<HTMLDivElement>(null);

  // Two separate map instances
  const inlineInstanceRef  = useRef<any>(null);
  const modalInstanceRef   = useRef<any>(null);
  const inlineTileRef      = useRef<any>(null);
  const modalTileRef       = useRef<any>(null);
  const inlineCircleRef    = useRef<any>(null);
  const modalCircleRef     = useRef<any>(null);

  const mappable          = physicians.filter((p) => p.lat != null && p.lng != null);
  const mappableSuggested = suggestedPhysicians.filter((p) => p.lat != null && p.lng != null);

  // ── Global styles once ───────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("pm-global-v8")) return;
    const style = document.createElement("style");
    style.id = "pm-global-v8";
    style.textContent = `
      .phys-popup .leaflet-popup-content-wrapper{background:white!important;border:1px solid #e2e8f0!important;border-radius:14px!important;box-shadow:0 10px 32px rgba(0,0,0,.14)!important;padding:0!important;overflow:hidden!important;min-width:210px!important;}
      .phys-popup .leaflet-popup-content{margin:0!important;}
      .phys-popup .leaflet-popup-close-button{top:10px!important;right:12px!important;font-size:20px!important;color:#94a3b8!important;font-weight:300!important;}
      .phys-popup .leaflet-popup-close-button:hover{color:#475569!important;background:none!important;}
      .phys-popup-suggested .leaflet-popup-content-wrapper{background:white!important;border:1px solid #99f6e4!important;border-radius:14px!important;box-shadow:0 10px 32px rgba(20,184,166,.15)!important;padding:0!important;overflow:hidden!important;min-width:210px!important;}
      .phys-popup-suggested .leaflet-popup-content{margin:0!important;}
      .phys-popup-suggested .leaflet-popup-close-button{top:10px!important;right:12px!important;font-size:20px!important;color:#94a3b8!important;font-weight:300!important;}
      .site-tooltip{background:white!important;border:1px solid #fecaca!important;border-radius:10px!important;padding:7px 12px!important;font-size:12px!important;font-weight:600!important;color:#dc2626!important;box-shadow:0 4px 14px rgba(0,0,0,.12)!important;pointer-events:none!important;font-family:'Sora',sans-serif!important;}
      @keyframes pmFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes pmModalIn{from{opacity:0;transform:scale(.96) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
      .pm-backdrop{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;animation:pmFadeIn .22s ease both;}
      .pm-modal{position:relative;width:100%;max-width:1200px;height:82vh;max-height:820px;background:white;border-radius:20px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.28);animation:pmModalIn .26s cubic-bezier(.22,1,.36,1) both;}
      .pm-close{position:absolute;top:14px;right:14px;z-index:1100;width:36px;height:36px;background:white;border:1px solid #e2e8f0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;color:#64748b;box-shadow:0 2px 8px rgba(0,0,0,.12);transition:all .15s;}
      .pm-close:hover{background:#fee2e2;color:#dc2626;border-color:#fecaca;}
    `;
    document.head.appendChild(style);
  }, []);

  // ── Load Leaflet ─────────────────────────────────────────────────────────
  const loadLeaflet = useCallback((cb: () => void) => {
    if (window.L?.mapquest) { cb(); return; }
    const addLink = (id: string, href: string) => {
      if (document.getElementById(id)) return;
      const l = document.createElement("link"); l.id = id; l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
    };
    addLink("mq-css",  "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.css");
    addLink("mc-css",  "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css");
    addLink("mc-css2", "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css");

    const waitReady = (fn: () => void) => {
      if (window.L?.mapquest) { fn(); return; }
      const iv = setInterval(() => { if (window.L?.mapquest) { clearInterval(iv); fn(); } }, 100);
    };
    const loadMQ = (after: () => void) => {
      if (document.getElementById("mq-js")) { waitReady(after); return; }
      const s = document.createElement("script"); s.id = "mq-js";
      s.src = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
      s.onload = after; document.head.appendChild(s);
    };
    loadMQ(() => {
      if (document.getElementById("mc-js")) { waitReady(cb); return; }
      const mc = document.createElement("script"); mc.id = "mc-js";
      mc.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js";
      mc.onload = cb; document.head.appendChild(mc);
    });
  }, []);

  // ── Core map builder ─────────────────────────────────────────────────────
  const buildMap = useCallback((
    container: HTMLDivElement,
    instanceRef: React.MutableRefObject<any>,
    tileRef: React.MutableRefObject<any>,
    circleRef: React.MutableRefObject<any>,
  ) => {
    if (!container || instanceRef.current) return;
    const L = window.L;
    if (!L?.mapquest) return;
    L.mapquest.key = mapKey;

    const allMappable = [...mappable, ...mappableSuggested];
    const centerLat = allMappable.length ? allMappable.reduce((s, p) => s + p.lat!, 0) / allMappable.length : selectedSite.lat;
    const centerLng = allMappable.length ? allMappable.reduce((s, p) => s + p.lng!, 0) / allMappable.length : selectedSite.lng;

    const tile = L.mapquest.tileLayer("map");
    tileRef.current = tile;

    const map = L.mapquest.map(container, {
      center: [centerLat, centerLng], layers: tile,
      zoom: 10, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomControl: false,
    });
    instanceRef.current = map;
    map.on("zoomend", () => setCurrentZoom(map.getZoom()));

    // Trial site marker
    const siteIcon = L.divIcon({ html: hospitalMarkerHtml("#ef4444", 30), className: "", iconSize: [30, 30], iconAnchor: [15, 15] });
    const siteMarker = L.marker([selectedSite.lat, selectedSite.lng], { icon: siteIcon }).addTo(map);
    siteMarker.setZIndexOffset(1000);

    // Radius circle
    const circle = L.circle([selectedSite.lat, selectedSite.lng], {
      radius: radius * 1609.34, color: "#16a34a", fillColor: "#22c55e",
      fillOpacity: 0.08, weight: 1.6, dashArray: "6 5",
    }).addTo(map);
    circleRef.current = circle;

    const siteLabel = [selectedSite.city, selectedSite.state].filter(Boolean).join(", ");
    siteMarker.bindTooltip(
      `<div style="font-weight:700;color:#dc2626;">🏥 Clinical trial site</div>
       <div style="font-size:11px;color:#0f172a;font-weight:600;">${selectedSite.facility || "Clinical trial site"}</div>
       ${siteLabel ? `<div style="font-size:11px;color:#64748b;">${siteLabel}</div>` : ""}`,
      { permanent: true, direction: "top", offset: [0, -20], className: "site-tooltip" }
    );

    const buildPopup = (p: Physician, accent: string, bg: string, border: string, badge?: string) => `
      <div>
        <div style="padding:13px 16px 11px;border-bottom:1px solid ${border};background:${bg};">
          ${badge ? `<div style="margin-bottom:4px;"><span style="background:${accent};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;">${badge}</span></div>` : ""}
          <div style="font-weight:700;font-size:13px;color:#0f172a;padding-right:18px;font-family:'Sora',sans-serif;">${p.name}</div>
          ${p.taxonomy_desc ? `<div style="font-size:11px;color:${accent};margin-top:2px;font-weight:600;">${p.taxonomy_desc}</div>` : ""}
        </div>
        <div style="padding:10px 16px 12px;font-family:'IBM Plex Mono',monospace;">
          <div style="font-size:11px;color:#64748b;">NPI <span style="color:#0f172a;font-weight:600;">${p.npi}</span></div>
        </div>
        <div style="padding:0 16px 12px;">
          <button onclick="window.__viewPhysician && window.__viewPhysician('${p.npi}')"
            style="width:100%;padding:7px 0;background:${accent};color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">
            View Details →
          </button>
        </div>
      </div>`;

    // Clusters
    const mainCluster      = (L as any).markerClusterGroup ? (L as any).markerClusterGroup({ spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true, maxClusterRadius: 60 }) : null;
    const suggestedCluster = (L as any).markerClusterGroup ? (L as any).markerClusterGroup({ spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true, maxClusterRadius: 60 }) : null;
    if (mainCluster)      map.addLayer(mainCluster);
    if (suggestedCluster) map.addLayer(suggestedCluster);

    mappable.forEach((p) => {
      const isSelected = p.npi === selectedNpi;
      const color = isSelected ? "#1d4ed8" : "#2563eb";
      const size  = isSelected ? 30 : 24;
      const icon  = L.divIcon({ html: doctorMarkerHtml(color, size, isSelected), className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const marker = L.marker([p.lat, p.lng], { icon });
      marker.bindPopup(buildPopup(p, "#2563eb", "#f0f9ff", "#dbeafe"), { className: "phys-popup", offset: [0, -10], maxWidth: 280, closeButton: true });
      marker.on("mouseover", () => marker.openPopup());
      marker.on("click", () => { map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { animate: true, duration: 0.8 }); onSelect(p); });
      if (mainCluster) mainCluster.addLayer(marker); else marker.addTo(map);
    });

    mappableSuggested.forEach((p) => {
      const isSelected = p.npi === selectedNpi;
      const color = isSelected ? "#0f766e" : "#14b8a6";
      const size  = isSelected ? 30 : 24;
      const icon  = L.divIcon({ html: suggestedMarkerHtml(color, size, isSelected), className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const marker = L.marker([p.lat, p.lng], { icon });
      marker.bindPopup(buildPopup(p, "#14b8a6", "#f0fdfa", "#99f6e4", "SUGGESTED"), { className: "phys-popup-suggested", offset: [0, -10], maxWidth: 280, closeButton: true });
      marker.on("mouseover", () => marker.openPopup());
      marker.on("click", () => { map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { animate: true, duration: 0.8 }); onSelect(p); });
      if (suggestedCluster) suggestedCluster.addLayer(marker); else marker.addTo(map);
    });

    const allPts: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
      ...mappableSuggested.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    if (allPts.length > 1) map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40] });
  }, [mapKey, mappable, mappableSuggested, selectedSite, radius, selectedNpi, onSelect]);

  // popup bridge
  useEffect(() => {
    (window as any).__viewPhysician = (npi: string) => {
      const p = [...physicians, ...suggestedPhysicians].find((x) => x.npi === npi);
      if (p) {
        onSelect(p);
        setTimeout(() => {
          const card = document.querySelector(`[data-npi="${npi}"]`);
          if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); (card as HTMLElement).click(); }
        }, 150);
      }
    };
    return () => { delete (window as any).__viewPhysician; };
  }, [physicians, suggestedPhysicians, onSelect]);

  // ── Inline map init ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapKey) return;
    loadLeaflet(() => {
      if (inlineMapRef.current) buildMap(inlineMapRef.current, inlineInstanceRef, inlineTileRef, inlineCircleRef);
    });
    return () => {
      if (inlineInstanceRef.current) { inlineInstanceRef.current.remove(); inlineInstanceRef.current = null; }
      inlineTileRef.current = null; inlineCircleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapKey,
    selectedSite.lat, selectedSite.lng, selectedSite.facility,
    physicians.map(p => p.npi).join(","),
    suggestedPhysicians.map(p => p.npi).join(","),
  ]);

  // ── Modal map init / destroy ──────────────────────────────────────────────
  useEffect(() => {
    if (!isExpanded) {
      if (modalInstanceRef.current) { modalInstanceRef.current.remove(); modalInstanceRef.current = null; }
      modalTileRef.current = null; modalCircleRef.current = null;
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    const tid = setTimeout(() => {
      loadLeaflet(() => {
        if (modalMapRef.current) buildMap(modalMapRef.current, modalInstanceRef, modalTileRef, modalCircleRef);
      });
    }, 80);
    return () => {
      clearTimeout(tid);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  // reactive radius update — both instances
  useEffect(() => {
    inlineCircleRef.current?.setRadius(radius * 1609.34);
    modalCircleRef.current?.setRadius(radius * 1609.34);
  }, [radius]);

  // ── Tile switcher ─────────────────────────────────────────────────────────
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
  const zoomIn  = () => { const m = activeInstance(); if (!m) return; const z = m.getZoom(); if (z < MAX_ZOOM) { m.setZoom(z + 1); setCurrentZoom(z + 1); } };
  const zoomOut = () => { const m = activeInstance(); if (!m) return; const z = m.getZoom(); if (z > MIN_ZOOM) { m.setZoom(z - 1); setCurrentZoom(z - 1); } };
  const fitAll  = () => {
    const m = activeInstance(); if (!m || !window.L) return;
    const pts: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
      ...mappableSuggested.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    m.fitBounds(window.L.latLngBounds(pts), { padding: [40, 40] });
  };

  if (!mapKey) {
    return (
      <div style={{ height: DEFAULT_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, background: "#f8fafc", color: "#94a3b8" }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <div style={{ fontSize: 14 }}>MapQuest API key not configured</div>
      </div>
    );
  }

  const activeType = MAP_TYPES.find((t) => t.id === mapType)!;

  // ── Shared overlay controls ───────────────────────────────────────────────
  const Controls = () => (
    <>
      {/* Legend — top-left */}
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, background: "rgba(255,255,255,.95)", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 13px", boxShadow: "0 2px 8px rgba(0,0,0,.08)", display: "flex", flexDirection: "column", gap: 7 }}>
        {[
          { fill: "#ef4444", label: "Trial site",               shape: "hospital"  },
          { fill: "#2563eb", label: "HCPs/HCOs",                shape: "doctor"    },
          { fill: "#14b8a6", label: "HCPs/HCOs Trial-Relevant", shape: "suggested" },
        ].map(({ fill, label, shape }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 30 30">
              <circle cx="15" cy="15" r="14" fill={fill}/>
              {shape === "hospital" && <><rect x="12" y="7" width="6" height="16" rx="1.5" fill="white"/><rect x="7" y="12" width="16" height="6" rx="1.5" fill="white"/></>}
              {(shape === "doctor" || shape === "suggested") && <><circle cx="15" cy="11" r="4" fill="white"/><path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/></>}
              {shape === "suggested" && <polygon points="24,5 25,8 28,8 25.5,10 26.5,13 24,11.5 21.5,13 22.5,10 20,8 23,8" fill="#fbbf24" stroke="white" strokeWidth="0.5"/>}
            </svg>
            <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>{label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #e2e8f0", paddingTop: 7, marginTop: 1 }}>
          <svg width="14" height="14" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="12" fill="none" stroke="#16a34a" strokeWidth="3.5" strokeDasharray="5 4"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 20, padding: "1px 8px" }}>
            {radius} mi radius
          </span>
        </div>
      </div>

      {/* Zoom — top-right */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
        <div style={{ width: 32, height: 20, background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>{currentZoom}</div>
        {[
          { icon: "+", title: "Zoom in",  fn: zoomIn,  disabled: currentZoom >= MAX_ZOOM },
          { icon: "−", title: "Zoom out", fn: zoomOut, disabled: currentZoom <= MIN_ZOOM },
          { icon: "⊡", title: "Fit all",  fn: fitAll,  disabled: false },
        ].map((b) => (
          <button key={b.title} title={b.title} onClick={b.fn} disabled={b.disabled}
            style={{ width: 32, height: 32, background: b.disabled ? "#f8fafc" : "white", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 16, fontWeight: 700, color: b.disabled ? "#cbd5e1" : "#334155", cursor: b.disabled ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,.08)" }}>{b.icon}</button>
        ))}
      </div>

      {/* Type switcher — bottom-right */}
      <div style={{ position: "absolute", bottom: 14, right: 10, zIndex: 1000 }}>
        {showTypeMenu && (
          <div style={{ position: "absolute", bottom: "calc(100% + 6px)", right: 0, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,.12)", overflow: "hidden", minWidth: 140 }}>
            {MAP_TYPES.map((t) => (
              <button key={t.id} onClick={() => switchMapType(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: t.id === mapType ? 700 : 500, background: t.id === mapType ? "#eff6ff" : "transparent", color: t.id === mapType ? "#2563eb" : "#334155", borderLeft: t.id === mapType ? "3px solid #2563eb" : "3px solid transparent" }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span>{t.label}
                {t.id === mapType && <span style={{ marginLeft: "auto", fontSize: 10 }}>✓</span>}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setShowTypeMenu((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", background: "white", border: `1px solid ${showTypeMenu ? "#2563eb" : "#e2e8f0"}`, borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#334155", boxShadow: "0 2px 6px rgba(0,0,0,.08)" }}>
          <span style={{ fontSize: 13 }}>{activeType.icon}</span>{activeType.label}
          <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 2 }}>▲</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* ── Inline map — fixed px height so it always renders ─────────────── */}
      <div style={{ position: "relative", width: "100%", height: DEFAULT_HEIGHT, overflow: "hidden" }}>
        <div ref={inlineMapRef} style={{ width: "100%", height: "100%", background: "#e8edf2" }} />
        <Controls />
        <button onClick={() => setIsExpanded(true)} title="Expand map"
          style={{ position: "absolute", bottom: 40, right: 10, zIndex: 1000, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.12)", fontSize: 14, color: "#374151" }}>⛶</button>
      </div>

      {/* ── Modal overlay — independent map instance ──────────────────────── */}
      {isExpanded && (
        <div className="pm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsExpanded(false); }}>
          <div className="pm-modal">
            <button className="pm-close" onClick={() => setIsExpanded(false)} title="Close">✕</button>
            <div ref={modalMapRef} style={{ width: "100%", height: "100%", background: "#e8edf2" }} />
            <Controls />
          </div>
        </div>
      )}
    </>
  );
}