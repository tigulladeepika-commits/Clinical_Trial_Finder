// components/physicians/PhysicianMap.tsx
// v2 changes:
//  - Added `suggestedPhysicians` prop — plotted in teal/green to visually
//    distinguish them from main (blue) physicians.
//  - Trial site stays red (hospital cross).
//  - Legend updated with three entries: Trial Site / Physician / Suggested.
//  - Suggested markers use a slightly different doctor icon with teal colour.
//  - Popup for suggested physicians shows a "Suggested" badge.

"use client";

import { useEffect, useRef } from "react";
import type { Physician }    from "@/types/physician";
import type { SelectedSite } from "@/types/physician";

type Props = {
  physicians:           Physician[];
  suggestedPhysicians?: Physician[];   // NEW — plotted in teal
  selectedSite:         SelectedSite;
  selectedNpi:          string | null;
  onSelect:             (p: Physician) => void;
};

declare global { interface Window { L: any; } }

// ── SVG icon generators ───────────────────────────────────────────────────────

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
  const glow = selected ? `filter:drop-shadow(0 0 8px ${color});` : "filter:drop-shadow(0 2px 6px rgba(0,0,0,0.25));";
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

/** Star marker for suggested physicians — teal with a small star accent */
function suggestedMarkerHtml(color: string, size: number, selected: boolean): string {
  const glow = selected
    ? `filter:drop-shadow(0 0 8px ${color});`
    : "filter:drop-shadow(0 2px 6px rgba(0,0,0,0.22));";
  return `
    <div style="${glow}cursor:pointer;transition:transform 0.15s;">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="14" fill="${color}" stroke="white" stroke-width="${selected ? 3 : 2}"/>
        <!-- Head -->
        <circle cx="15" cy="11" r="4" fill="white"/>
        <!-- Body -->
        <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
        <!-- Small star top-right to signal "suggested" -->
        <polygon points="24,5 25,8 28,8 25.5,10 26.5,13 24,11.5 21.5,13 22.5,10 20,8 23,8"
          fill="#fbbf24" stroke="white" stroke-width="0.5"/>
      </svg>
    </div>`.trim();
}

export default function PhysicianMap({
  physicians,
  suggestedPhysicians = [],
  selectedSite,
  selectedNpi,
  onSelect,
}: Props) {
  const mapKey     = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef  = useRef<HTMLDivElement>(null);
  const mapRef     = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const mappable          = physicians.filter((p) => p.lat != null && p.lng != null);
  const mappableSuggested = suggestedPhysicians.filter((p) => p.lat != null && p.lng != null);

  const initMap = () => {
    if (!mapDivRef.current || mapRef.current) return;
    const L = window.L;
    if (!L?.mapquest) return;

    L.mapquest.key = mapKey;

    if (!document.getElementById("phys-map-style-v3")) {
      const style = document.createElement("style");
      style.id = "phys-map-style-v3";
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

    const map = L.mapquest.map(mapDivRef.current, {
      center:      [centerLat, centerLng],
      layers:      L.mapquest.tileLayer("map"),
      zoom:        10,
      zoomControl: false,
    });
    mapRef.current = map;

    // Trial site marker (red hospital cross)
    const siteIcon = L.divIcon({
      html:      hospitalMarkerHtml("#ef4444", 30),
      className: "",
      iconSize:  [30, 30],
      iconAnchor:[15, 15],
    });
    const siteMarker = L.marker([selectedSite.lat, selectedSite.lng], { icon: siteIcon }).addTo(map);
    siteMarker.bindTooltip(
      `<div style="font-weight:700;color:#dc2626;">🏥 Trial Site</div>
       ${selectedSite.facility ? `<div style="font-size:11px;color:#64748b;">${selectedSite.facility}</div>` : ""}`,
      { permanent: false, direction: "top", offset: [0, -18], className: "site-tooltip" }
    );

    // ── Main physician markers (blue) ─────────────────────────────────────────
    const mainMarkers = mappable.map((p) => {
      const isSelected = p.npi === selectedNpi;
      const color      = isSelected ? "#1d4ed8" : "#2563eb";
      const size       = isSelected ? 30 : 24;

      const icon = L.divIcon({
        html:      doctorMarkerHtml(color, size, isSelected),
        className: "",
        iconSize:  [size, size],
        iconAnchor:[size / 2, size / 2],
      });

      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);

      marker.bindTooltip(
        `<div style="font-weight:700;">${p.name}</div>
         ${p.taxonomy_desc ? `<div style="font-size:11px;color:#3b82f6;">${p.taxonomy_desc}</div>` : ""}`,
        { permanent: false, direction: "top", offset: [0, -12], className: "phys-tooltip" }
      );

      const distNote = p.distance_miles != null
        ? `<div style="margin-top:4px;font-weight:700;color:#2563eb;font-size:12px;">📏 ${p.distance_miles} mi from site</div>`
        : "";

      const popupHtml = `
        <div>
          <div style="padding:13px 16px 11px;border-bottom:1px solid #f1f5f9;background:#f0f9ff;">
            <div style="font-weight:700;font-size:13px;color:#0f172a;padding-right:18px;font-family:'Sora',sans-serif;">${p.name}</div>
            ${p.taxonomy_desc ? `<div style="font-size:11px;color:#2563eb;margin-top:2px;font-weight:600;">${p.taxonomy_desc}</div>` : ""}
          </div>
          <div style="padding:11px 16px 13px;font-size:12px;color:#64748b;font-family:'Sora',sans-serif;">
            ${p.address ? `<div>📍 ${p.address}</div>` : ""}
            ${p.phone   ? `<div style="margin-top:4px;">📞 <a href="tel:${p.phone}" style="color:#2563eb;font-weight:600;">${p.phone}</a></div>` : ""}
            ${distNote}
            <div style="margin-top:6px;font-size:10px;color:#cbd5e1;font-family:'IBM Plex Mono',monospace;">NPI ${p.npi}</div>
          </div>
        </div>`;

      marker.bindPopup(popupHtml, {
        className: "phys-popup", offset: [0, -10], maxWidth: 280, closeButton: true,
      });
      marker.on("click", () => { onSelect(p); marker.openPopup(); });
      return marker;
    });

    // ── Suggested physician markers (teal) ────────────────────────────────────
    const suggestedMarkers = mappableSuggested.map((p) => {
      const isSelected = p.npi === selectedNpi;
      const color      = isSelected ? "#0f766e" : "#14b8a6";   // teal-700 / teal-500
      const size       = isSelected ? 30 : 24;

      const icon = L.divIcon({
        html:      suggestedMarkerHtml(color, size, isSelected),
        className: "",
        iconSize:  [size, size],
        iconAnchor:[size / 2, size / 2],
      });

      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);

      marker.bindTooltip(
        `<div style="font-weight:700;">⭐ ${p.name}</div>
         ${p.taxonomy_desc ? `<div style="font-size:11px;color:#14b8a6;">${p.taxonomy_desc}</div>` : ""}
         <div style="font-size:10px;color:#0d9488;margin-top:2px;">Suggested Physician</div>`,
        { permanent: false, direction: "top", offset: [0, -12], className: "phys-tooltip-suggested" }
      );

      const distNote = p.distance_miles != null
        ? `<div style="margin-top:4px;font-weight:700;color:#14b8a6;font-size:12px;">📏 ${p.distance_miles} mi from site</div>`
        : "";

      const popupHtml = `
        <div>
          <div style="padding:13px 16px 11px;border-bottom:1px solid #f0fdfa;background:#f0fdfa;">
            <div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="background:#14b8a6;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.5px;">SUGGESTED</span>
            </div>
            <div style="font-weight:700;font-size:13px;color:#0f172a;padding-right:18px;font-family:'Sora',sans-serif;">${p.name}</div>
            ${p.taxonomy_desc ? `<div style="font-size:11px;color:#0d9488;margin-top:2px;font-weight:600;">${p.taxonomy_desc}</div>` : ""}
          </div>
          <div style="padding:11px 16px 13px;font-size:12px;color:#64748b;font-family:'Sora',sans-serif;">
            ${p.address ? `<div>📍 ${p.address}</div>` : ""}
            ${p.phone   ? `<div style="margin-top:4px;">📞 <a href="tel:${p.phone}" style="color:#0d9488;font-weight:600;">${p.phone}</a></div>` : ""}
            ${distNote}
            <div style="margin-top:6px;font-size:10px;color:#cbd5e1;font-family:'IBM Plex Mono',monospace;">NPI ${p.npi}</div>
          </div>
        </div>`;

      marker.bindPopup(popupHtml, {
        className: "phys-popup-suggested", offset: [0, -10], maxWidth: 280, closeButton: true,
      });
      marker.on("click", () => { onSelect(p); marker.openPopup(); });
      return marker;
    });

    markersRef.current = [...mainMarkers, ...suggestedMarkers];

    // Fit bounds to include all points
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
    if (!mapKey) return;

    const loadAndInit = () => {
      if (window.L?.mapquest) { initMap(); return; }
      const iv = setInterval(() => {
        if (window.L?.mapquest) { clearInterval(iv); initMap(); }
      }, 100);
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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, physicians, suggestedPhysicians, selectedSite]);

  const zoomIn  = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const fitAll  = () => {
    if (!mapRef.current || !window.L) return;
    const pts: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
      ...mappableSuggested.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    mapRef.current.fitBounds(window.L.latLngBounds(pts), { padding: [40, 40] });
  };

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

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div ref={mapDivRef} style={{ width: "100%", height: "100%", background: "#e8edf2" }} />

      {/* Zoom controls */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          { icon: "+", title: "Zoom in",  fn: zoomIn  },
          { icon: "−", title: "Zoom out", fn: zoomOut },
          { icon: "⊡", title: "Fit all",  fn: fitAll  },
        ].map((b) => (
          <button key={b.title} title={b.title} onClick={b.fn} style={{
            width: 32, height: 32, background: "white",
            border: "1px solid #e2e8f0", borderRadius: 8,
            fontSize: 16, fontWeight: 700, color: "#334155",
            cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          }}>{b.icon}</button>
        ))}
      </div>

      {/* Legend — three entries */}
      <div style={{
        position: "absolute", bottom: 10, left: 10, zIndex: 1000,
        background: "rgba(255,255,255,0.95)",
        border: "1px solid #e2e8f0", borderRadius: 10,
        padding: "9px 13px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column", gap: 7,
      }}>
        {/* Trial Site */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="14" fill="#ef4444"/>
            <rect x="12" y="7" width="6" height="16" rx="1.5" fill="white"/>
            <rect x="7" y="12" width="16" height="6" rx="1.5" fill="white"/>
          </svg>
          <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>Trial Site</span>
        </div>
        {/* Main Physician */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="14" fill="#2563eb"/>
            <circle cx="15" cy="11" r="4" fill="white"/>
            <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
          </svg>
          <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>Physician</span>
        </div>
        {/* Suggested Physician */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 30 30">
            <circle cx="15" cy="15" r="14" fill="#14b8a6"/>
            <circle cx="15" cy="11" r="4" fill="white"/>
            <path d="M8 25c0-4.4 3.1-7 7-7s7 2.6 7 7" fill="white"/>
            <polygon points="24,5 25,8 28,8 25.5,10 26.5,13 24,11.5 21.5,13 22.5,10 20,8 23,8"
              fill="#fbbf24" stroke="white" stroke-width="0.5"/>
          </svg>
          <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>Suggested</span>
        </div>
      </div>
    </div>
  );
}