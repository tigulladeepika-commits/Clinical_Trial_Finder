// components/physicians/PhysicianMap.tsx

"use client";

import { useEffect, useRef, useState } from "react";
import type { Physician }    from "@/types/physician";
import type { SelectedSite } from "@/types/physician";

type MapType = "map" | "satellite" | "light" | "dark";

const MAP_TYPES: { id: MapType; label: string; icon: string }[] = [
  { id: "map",       label: "Standard",  icon: "🗺" },
  { id: "satellite", label: "Satellite", icon: "🌍" },
  { id: "light",     label: "Light",     icon: "☀️" },
  { id: "dark",      label: "Dark",      icon: "🌙" },
];

const MIN_ZOOM = 0;
const MAX_ZOOM = 20;

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
  return `
    <div style="filter:drop-shadow(0 2px 8px rgba(0,0,0,0.30));cursor:pointer;">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="2.5"/>
        <rect x="12" y="7" width="6" height="16" rx="1.5" fill="white"/>
        <rect x="7" y="12" width="16" height="6" rx="1.5" fill="white"/>
      </svg>
    </div>`.trim();
}

function doctorMarkerHtml(color: string, size: number, selected: boolean): string {
  const glow = selected
    ? `filter:drop-shadow(0 0 8px ${color});`
    : "filter:drop-shadow(0 2px 6px rgba(0,0,0,0.25));";
  return `
    <div style="${glow}cursor:pointer;transition:transform 0.15s;">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="${selected ? 3 : 2}"/>
        <circle cx="15" cy="11" r="4" fill="white"/>
        <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
        <path d="M12 17.5 Q10 21 13 22.5" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        <circle cx="13.5" cy="23" r="1.2" fill="${color}"/>
      </svg>
    </div>`.trim();
}

function suggestedMarkerHtml(color: string, size: number, selected: boolean): string {
  const glow = selected
    ? `filter:drop-shadow(0 0 8px ${color});`
    : "filter:drop-shadow(0 2px 6px rgba(0,0,0,0.22));";
  return `
    <div style="${glow}cursor:pointer;transition:transform 0.15s;">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="${selected ? 3 : 2}"/>
        <circle cx="15" cy="11" r="4" fill="white"/>
        <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
        <polygon points="24,5 25,8 28,8 25.5,10 26.5,13 24,11.5 21.5,13 22.5,10 20,8 23,8"
          fill="#fbbf24" stroke="white" stroke-width="0.5"/>
      </svg>
    </div>`.trim();
}

export default function PhysicianMap({
  physicians,
  suggestedPhysicians = [],
  selectedSite,
  radius,
  selectedNpi,
  onSelect,
}: Props) {
  const mapKey          = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef       = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<any>(null);
  const markersRef      = useRef<any[]>([]);
  const tileLayerRef    = useRef<any>(null);
  const radiusCircleRef = useRef<any>(null);

  const [mapType,      setMapType]      = useState<MapType>("map");
  const [currentZoom,  setCurrentZoom]  = useState(10);
  const [isExpanded,   setIsExpanded]   = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  const mappable          = physicians.filter((p) => p.lat != null && p.lng != null);
  const mappableSuggested = suggestedPhysicians.filter((p) => p.lat != null && p.lng != null);

  const switchMapType = (type: MapType) => {
    if (!mapRef.current || !window.L?.mapquest) return;
    const L = window.L;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    const layer = L.mapquest.tileLayer(type);
    layer.addTo(mapRef.current);
    tileLayerRef.current = layer;
    setMapType(type);
    setShowTypeMenu(false);
  };

  const zoomIn = () => {
    if (!mapRef.current) return;
    const z = mapRef.current.getZoom();
    if (z < MAX_ZOOM) { mapRef.current.setZoom(z + 1); setCurrentZoom(z + 1); }
  };
  const zoomOut = () => {
    if (!mapRef.current) return;
    const z = mapRef.current.getZoom();
    if (z > MIN_ZOOM) { mapRef.current.setZoom(z - 1); setCurrentZoom(z - 1); }
  };
  const fitAll = () => {
    if (!mapRef.current || !window.L) return;
    const pts: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
      ...mappableSuggested.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    mapRef.current.fitBounds(window.L.latLngBounds(pts), { padding: [40, 40] });
  };

  // FIX: robust resize helper — waits for layout to settle, then tells
  // Leaflet to recalculate its size so tiles render correctly.
  const refreshMapSize = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
          // Re-fit so the view re-centers nicely after the resize
          const pts: [number, number][] = [
            [selectedSite.lat, selectedSite.lng],
            ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
            ...mappableSuggested.map((p) => [p.lat!, p.lng!] as [number, number]),
          ];
          if (pts.length > 1) {
            mapRef.current.fitBounds(window.L.latLngBounds(pts), { padding: [40, 40] });
          }
        }
      });
    });
  };

  // FIX: expand/collapse just toggle a true fullscreen overlay — no scroll math needed
  const handleExpand = () => {
    setIsExpanded(true);
    setShowTypeMenu(false);
    setTimeout(refreshMapSize, 60);
  };

  const handleCollapse = () => {
    setIsExpanded(false);
    setShowTypeMenu(false);
    setTimeout(refreshMapSize, 60);
  };

  // FIX: lock page scroll while the fullscreen map overlay is open,
  // so nothing behind it is visible or scrollable
  useEffect(() => {
    if (!isExpanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, [isExpanded]);

  // Close fullscreen on Escape for convenience
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleCollapse(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  const initMap = () => {
    if (!mapDivRef.current || mapRef.current) return;
    const L = window.L;
    if (!L?.mapquest) return;

    L.mapquest.key = mapKey;

    if (!document.getElementById("phys-map-style-v5")) {
      const style = document.createElement("style");
      style.id = "phys-map-style-v5";
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');
        .phys-tooltip {
          background: white !important; border: 1px solid #e2e8f0 !important;
          border-radius: 10px !important; padding: 7px 12px !important;
          font-size: 12px !important; font-weight: 500 !important;
          color: #1e293b !important; box-shadow: 0 4px 14px rgba(0,0,0,0.12) !important;
          white-space: nowrap !important; pointer-events: none !important;
          font-family: 'Sora', sans-serif !important;
        }
        .phys-tooltip-suggested {
          background: white !important; border: 1px solid #99f6e4 !important;
          border-radius: 10px !important; padding: 7px 12px !important;
          font-size: 12px !important; font-weight: 500 !important;
          color: #134e4a !important; box-shadow: 0 4px 14px rgba(0,0,0,0.12) !important;
          white-space: nowrap !important; pointer-events: none !important;
          font-family: 'Sora', sans-serif !important;
        }
        .phys-popup .leaflet-popup-content-wrapper {
          background: white !important; border: 1px solid #e2e8f0 !important;
          border-radius: 14px !important; box-shadow: 0 10px 32px rgba(0,0,0,0.14) !important;
          padding: 0 !important; overflow: hidden !important; min-width: 210px !important;
        }
        .phys-popup .leaflet-popup-content { margin: 0 !important; }
        .phys-popup .leaflet-popup-close-button {
          top: 10px !important; right: 12px !important;
          font-size: 20px !important; color: #94a3b8 !important; font-weight: 300 !important;
        }
        .phys-popup .leaflet-popup-close-button:hover { color: #475569 !important; background: none !important; }
        .phys-popup-suggested .leaflet-popup-content-wrapper {
          background: white !important; border: 1px solid #99f6e4 !important;
          border-radius: 14px !important; box-shadow: 0 10px 32px rgba(20,184,166,0.15) !important;
          padding: 0 !important; overflow: hidden !important; min-width: 210px !important;
        }
        .phys-popup-suggested .leaflet-popup-content { margin: 0 !important; }
        .phys-popup-suggested .leaflet-popup-close-button {
          top: 10px !important; right: 12px !important;
          font-size: 20px !important; color: #94a3b8 !important; font-weight: 300 !important;
        }
        .phys-popup-suggested .leaflet-popup-close-button:hover { color: #475569 !important; background: none !important; }
        .site-tooltip {
          background: white !important; border: 1px solid #fecaca !important;
          border-radius: 10px !important; padding: 7px 12px !important;
          font-size: 12px !important; font-weight: 600 !important;
          color: #dc2626 !important; box-shadow: 0 4px 14px rgba(0,0,0,0.12) !important;
          pointer-events: none !important; font-family: 'Sora', sans-serif !important;
        }
      `;
      document.head.appendChild(style);
    }

    const allMappable = [...mappable, ...mappableSuggested];
    const centerLat = allMappable.length
      ? allMappable.reduce((s, p) => s + p.lat!, 0) / allMappable.length
      : selectedSite.lat;
    const centerLng = allMappable.length
      ? allMappable.reduce((s, p) => s + p.lng!, 0) / allMappable.length
      : selectedSite.lng;

    const initialLayer = L.mapquest.tileLayer("map");
    tileLayerRef.current = initialLayer;

    const map = L.mapquest.map(mapDivRef.current, {
      center:      [centerLat, centerLng],
      layers:      initialLayer,
      zoom:        10,
      minZoom:     MIN_ZOOM,
      maxZoom:     MAX_ZOOM,
      zoomControl: false,
    });
    mapRef.current = map;

    map.on("zoomend", () => setCurrentZoom(map.getZoom()));

    // Trial site marker
    const siteIcon = L.divIcon({
      html: hospitalMarkerHtml("#ef4444", 30),
      className: "", iconSize: [30, 30], iconAnchor: [15, 15],
    });
    const siteMarker = L.marker([selectedSite.lat, selectedSite.lng], { icon: siteIcon }).addTo(map);
    siteMarker.setZIndexOffset(1000);

    const radiusCircle = L.circle([selectedSite.lat, selectedSite.lng], {
      radius:      radius * 1609.34,
      color:       "#16a34a",
      fillColor:   "#22c55e",
      fillOpacity: 0.08,
      weight:      1.6,
      dashArray:   "6 5",
    }).addTo(map);
    radiusCircleRef.current = radiusCircle;

    const siteLocationLabel = [selectedSite.city, selectedSite.state].filter(Boolean).join(", ");
    const siteNameLabel = selectedSite.facility || "Clinical trial site";

    siteMarker.bindTooltip(
      `<div style="font-weight:700;color:#dc2626;">🏥 Clinical trial site</div>
       <div style="font-size:11px;color:#0f172a;font-weight:600;">${siteNameLabel}</div>
       ${siteLocationLabel ? `<div style="font-size:11px;color:#64748b;">${siteLocationLabel}</div>` : ""}`,
      { permanent: true, direction: "top", offset: [0, -20], className: "site-tooltip" }
    );

    const buildPopupHtml = (
      p: Physician,
      accentColor: string,
      bgColor: string,
      borderColor: string,
      badge?: string,
    ) => `
      <div>
        <div style="padding:13px 16px 11px;border-bottom:1px solid ${borderColor};background:${bgColor};">
          ${badge ? `<div style="margin-bottom:4px;"><span style="background:${accentColor};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.5px;">${badge}</span></div>` : ""}
          <div style="font-weight:700;font-size:13px;color:#0f172a;padding-right:18px;font-family:'Sora',sans-serif;">${p.name}</div>
          ${p.taxonomy_desc ? `<div style="font-size:11px;color:${accentColor};margin-top:2px;font-weight:600;">${p.taxonomy_desc}</div>` : ""}
        </div>
        <div style="padding:10px 16px 12px;font-family:'IBM Plex Mono',monospace;">
          <div style="font-size:11px;color:#64748b;">NPI <span style="color:#0f172a;font-weight:600;">${p.npi}</span></div>
        </div>
      </div>`;

    const mainCluster      = (window.L as any).markerClusterGroup
      ? (window.L as any).markerClusterGroup({ spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true, maxClusterRadius: 60 })
      : null;
    const suggestedCluster = (window.L as any).markerClusterGroup
      ? (window.L as any).markerClusterGroup({ spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true, maxClusterRadius: 60 })
      : null;
    if (mainCluster)      map.addLayer(mainCluster);
    if (suggestedCluster) map.addLayer(suggestedCluster);

    const mainMarkers = mappable.map((p) => {
      const isSelected = p.npi === selectedNpi;
      const color      = isSelected ? "#1d4ed8" : "#2563eb";
      const size       = isSelected ? 30 : 24;
      const icon = L.divIcon({
        html: doctorMarkerHtml(color, size, isSelected),
        className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      marker.bindPopup(buildPopupHtml(p, "#2563eb", "#f0f9ff", "#dbeafe") + `
        <div style="padding:8px 16px 12px;">
          <button onclick="window.__viewPhysician && window.__viewPhysician('${p.npi}')"
            style="width:100%;padding:7px 0;background:#2563eb;color:white;border:none;border-radius:8px;
            font-size:12px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">
            View Details →
          </button>
        </div>`, {
        className: "phys-popup", offset: [0, -10], maxWidth: 280, closeButton: true,
      });
      marker.on("mouseover", () => { marker.openPopup(); });
      marker.on("mouseout",  () => { /* keep popup open until user closes */ });
      marker.on("click", () => {
        map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { animate: true, duration: 0.8 });
        onSelect(p);
      });
      if (mainCluster) mainCluster.addLayer(marker); else marker.addTo(map);
      return marker;
    });

    const suggestedMarkers = mappableSuggested.map((p) => {
      const isSelected = p.npi === selectedNpi;
      const color      = isSelected ? "#0f766e" : "#14b8a6";
      const size       = isSelected ? 30 : 24;
      const icon = L.divIcon({
        html: suggestedMarkerHtml(color, size, isSelected),
        className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([p.lat, p.lng], { icon });
      marker.bindPopup(buildPopupHtml(p, "#14b8a6", "#f0fdfa", "#99f6e4", "SUGGESTED") + `
        <div style="padding:8px 16px 12px;">
          <button onclick="window.__viewPhysician && window.__viewPhysician('${p.npi}')"
            style="width:100%;padding:7px 0;background:#14b8a6;color:white;border:none;border-radius:8px;
            font-size:12px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;">
            View Details →
          </button>
        </div>`, {
        className: "phys-popup-suggested", offset: [0, -10], maxWidth: 280, closeButton: true,
      });
      marker.on("mouseover", () => { marker.openPopup(); });
      marker.on("mouseout",  () => { /* keep popup open until user closes */ });
      marker.on("click", () => {
        map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { animate: true, duration: 0.8 });
        onSelect(p);
      });
      if (suggestedCluster) suggestedCluster.addLayer(marker); else marker.addTo(map);
      return marker;
    });

    markersRef.current = [...mainMarkers, ...suggestedMarkers];

    const allPoints: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
      ...mappableSuggested.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    if (allPoints.length > 1) {
      map.fitBounds(window.L.latLngBounds(allPoints), { padding: [40, 40] });
    }
  };

  useEffect(() => {
    (window as any).__viewPhysician = (npi: string) => {
      const p = [...physicians, ...suggestedPhysicians].find((x) => x.npi === npi);
      if (p) {
        onSelect(p);
        setTimeout(() => {
          const card = document.querySelector(`[data-npi="${npi}"]`);
          if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            (card as HTMLElement).click();
          }
        }, 150);
      }
    };
    return () => { delete (window as any).__viewPhysician; };
  }, [physicians, suggestedPhysicians, onSelect]);

  useEffect(() => {
    if (!mapKey) return;
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
    if (!document.getElementById("mc-css")) {
      const mcc = document.createElement("link");
      mcc.id = "mc-css"; mcc.rel = "stylesheet";
      mcc.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css";
      document.head.appendChild(mcc);
    }
    if (!document.getElementById("mc-css2")) {
      const mcc2 = document.createElement("link");
      mcc2.id = "mc-css2"; mcc2.rel = "stylesheet";
      mcc2.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css";
      document.head.appendChild(mcc2);
    }
    if (!document.getElementById("mq-js")) {
      const script = document.createElement("script");
      script.id = "mq-js";
      script.src = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
      script.onload = () => {
        if (!document.getElementById("mc-js")) {
          const mc = document.createElement("script");
          mc.id = "mc-js";
          mc.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js";
          mc.onload = loadAndInit;
          document.head.appendChild(mc);
        } else {
          loadAndInit();
        }
      };
      document.head.appendChild(script);
    } else {
      if (!document.getElementById("mc-js")) {
        const mc = document.createElement("script");
        mc.id = "mc-js";
        mc.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js";
        mc.onload = loadAndInit;
        document.head.appendChild(mc);
      } else {
        loadAndInit();
      }
    }
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current    = [];
      tileLayerRef.current  = null;
      radiusCircleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
  mapKey,
  selectedSite.lat,
  selectedSite.lng,
  selectedSite.facility,
  physicians.map(p => p.npi).join(","),
  suggestedPhysicians.map(p => p.npi).join(","),
  ]);

  useEffect(() => {
    if (!radiusCircleRef.current) return;
    radiusCircleRef.current.setRadius(radius * 1609.34);
  }, [radius]);

  if (!mapKey) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 10, background: "#f8fafc", color: "#94a3b8",
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <div style={{ fontSize: 14 }}>MapQuest API key not configured</div>
      </div>
    );
  }

  const activeType = MAP_TYPES.find((t) => t.id === mapType)!;

  return (
    <div
      style={{
        position: isExpanded ? "fixed" : "relative",
        // FIX: true fullscreen overlay — covers header + everything else
        top: isExpanded ? 0 : undefined,
        left: isExpanded ? 0 : undefined,
        right: isExpanded ? 0 : undefined,
        bottom: isExpanded ? 0 : undefined,
        width: isExpanded ? "100vw" : "100%",
        height: isExpanded ? "100vh" : "100%",
        zIndex: isExpanded ? 9999 : undefined,
        background: isExpanded ? "white" : undefined,
        overflow: "hidden",
      }}
    >

      {/* ── Map canvas ───────────────────────────────────────────────────── */}
      <div ref={mapDivRef} style={{ width: "100%", height: "100%", background: "#e8edf2" }} />

      {/* ── Legend — top-left ── */}
      <div style={{
        position: "absolute", top: isExpanded ? 60 : 10, left: 10, zIndex: 1000,
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #e2e8f0", borderRadius: 10,
        padding: "9px 13px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", gap: 7,
      }}>
        {[
          { fill: "#ef4444", label: "Trial site", shape: "hospital"  },
          { fill: "#2563eb", label: "HCPs/HCOs",       shape: "doctor"    },
          { fill: "#14b8a6", label: "HCPs/HCOs Trial-Relevant",    shape: "suggested" },
        ].map(({ fill, label, shape }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 30 30">
              <circle cx="15" cy="15" r="14" fill={fill}/>
              {shape === "hospital" && <>
                <rect x="12" y="7" width="6" height="16" rx="1.5" fill="white"/>
                <rect x="7" y="12" width="16" height="6" rx="1.5" fill="white"/>
              </>}
              {(shape === "doctor" || shape === "suggested") && <>
                <circle cx="15" cy="11" r="4" fill="white"/>
                <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
              </>}
              {shape === "suggested" &&
                <polygon
                  points="24,5 25,8 28,8 25.5,10 26.5,13 24,11.5 21.5,13 22.5,10 20,8 23,8"
                  fill="#fbbf24" stroke="white" strokeWidth="0.5"
                />
              }
            </svg>
            <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>{label}</span>
          </div>
        ))}

        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          borderTop: "1px solid #e2e8f0", paddingTop: 7, marginTop: 1,
        }}>
          <svg width="14" height="14" viewBox="0 0 30 30">
            <circle
              cx="15" cy="15" r="12"
              fill="none"
              stroke="#16a34a"
              strokeWidth="3.5"
              strokeDasharray="5 4"
            />
          </svg>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: "#15803d",
            background: "#dcfce7",
            border: "1px solid #86efac",
            borderRadius: 20,
            padding: "1px 8px",
          }}>
            {radius} mi radius
          </span>
        </div>
      </div>

      {/* ── Map type switcher — bottom-right ─────────────────────────────── */}
      <div style={{ position: "absolute", bottom: 14, right: 10, zIndex: 1000 }}>
        {showTypeMenu && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", right: 0,
            background: "white", border: "1px solid #e2e8f0", borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.12)", overflow: "hidden", minWidth: 140,
          }}>
            {MAP_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => switchMapType(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "8px 14px",
                  background: t.id === mapType ? "#eff6ff" : "transparent",
                  border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: t.id === mapType ? 700 : 500,
                  color: t.id === mapType ? "#2563eb" : "#334155",
                  fontFamily: "'Sora', sans-serif",
                  borderLeft: t.id === mapType ? "3px solid #2563eb" : "3px solid transparent",
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
          onClick={() => setShowTypeMenu((v) => !v)}
          title="Change map type"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "6px 10px", background: "white",
            border: `1px solid ${showTypeMenu ? "#2563eb" : "#e2e8f0"}`,
            borderRadius: 8, cursor: "pointer",
            fontSize: 11, fontWeight: 600, color: "#334155",
            boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
            fontFamily: "'Sora', sans-serif",
          }}
        >
          <span style={{ fontSize: 13 }}>{activeType.icon}</span>
          {activeType.label}
          <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 2 }}>▲</span>
        </button>
      </div>

      {/* ── Expand / Back button ── */}
      {isExpanded ? (
        <button
          onClick={handleCollapse}
          title="Exit fullscreen"
          style={{
            position: "absolute", top: 10, left: 10, zIndex: 1001,
            background: "white", border: "1px solid #e2e8f0",
            borderRadius: 8, height: 32, padding: "0 12px",
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            fontSize: 13, fontWeight: 600, color: "#374151",
            fontFamily: "'Sora', sans-serif",
          }}
        >
          ← Back
        </button>
      ) : (
        <button
          onClick={handleExpand}
          title="Expand map"
          style={{
            position: "absolute", bottom: 40, right: 10, zIndex: 1000,
            background: "white", border: "1px solid #e2e8f0",
            borderRadius: 8, width: 32, height: 32,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            fontSize: 14, color: "#374151",
          }}
        >
          ⛶
        </button>
      )}

      {/* ── Zoom controls + level badge — top-right ───────────────────────── */}
      <div style={{
        position: "absolute", top: 10, right: 10, zIndex: 1000,
        display: "flex", flexDirection: "column", gap: 4, alignItems: "center",
      }}>
        <div style={{
          width: 32, height: 20, background: "white",
          border: "1px solid #e2e8f0", borderRadius: 6,
          fontSize: 10, fontWeight: 700, color: "#475569",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          {currentZoom}
        </div>
        {[
          { icon: "+", title: "Zoom in",  fn: zoomIn,  disabled: currentZoom >= MAX_ZOOM },
          { icon: "−", title: "Zoom out", fn: zoomOut, disabled: currentZoom <= MIN_ZOOM },
          { icon: "⊡", title: "Fit all",  fn: fitAll,  disabled: false },
        ].map((b) => (
          <button
            key={b.title} title={b.title} onClick={b.fn} disabled={b.disabled}
            style={{
              width: 32, height: 32, background: b.disabled ? "#f8fafc" : "white",
              border: "1px solid #e2e8f0", borderRadius: 8,
              fontSize: 16, fontWeight: 700,
              color: b.disabled ? "#cbd5e1" : "#334155",
              cursor: b.disabled ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
            }}
          >
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}