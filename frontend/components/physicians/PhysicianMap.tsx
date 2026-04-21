// components/physicians/PhysicianMap.tsx
// MapQuest map that renders physician markers alongside the selected
// trial site marker. Reuses the same MapQuest SDK as TrialSiteMap.

"use client";

import { useEffect, useRef } from "react";
import type { Physician }    from "@/types/physician";
import type { SelectedSite } from "@/types/physician";

type Props = {
  physicians:   Physician[];
  selectedSite: SelectedSite;
  selectedNpi:  string | null;
  onSelect:     (p: Physician) => void;
};

declare global {
  interface Window { L: any; }
}

// Physician markers are blue dots; the trial site is a red pin
const PHYSICIAN_COLOR = "#2563eb";
const SITE_COLOR      = "#ef4444";

export default function PhysicianMap({ physicians, selectedSite, selectedNpi, onSelect }: Props) {
  const mapKey      = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mapDivRef   = useRef<HTMLDivElement>(null);
  const mapRef      = useRef<any>(null);
  const markersRef  = useRef<any[]>([]);

  const mappable = physicians.filter((p) => p.lat != null && p.lng != null);

  // ── Build / rebuild map ────────────────────────────────────────────────────
  const initMap = () => {
    if (!mapDivRef.current || mapRef.current) return;
    const L = window.L;
    if (!L?.mapquest) return;

    L.mapquest.key = mapKey;

    // Inject styles once
    if (!document.getElementById("phys-map-style")) {
      const style = document.createElement("style");
      style.id    = "phys-map-style";
      style.textContent = `
        .phys-tooltip {
          background: white !important; border: 1px solid #e2e8f0 !important;
          border-radius: 8px !important; padding: 6px 10px !important;
          font-size: 12px !important; font-weight: 500 !important;
          color: #1e293b !important; box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important;
          white-space: nowrap !important; pointer-events: none !important;
        }
        .phys-popup .leaflet-popup-content-wrapper {
          background: white !important; border: 1px solid #e2e8f0 !important;
          border-radius: 12px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.14) !important;
          padding: 0 !important; overflow: hidden !important; min-width: 200px !important;
        }
        .phys-popup .leaflet-popup-content { margin: 0 !important; }
        .phys-popup .leaflet-popup-close-button {
          top: 8px !important; right: 10px !important; font-size: 18px !important;
          color: #94a3b8 !important;
        }
        .phys-dot {
          border-radius: 50% !important; border: 2.5px solid white !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.28) !important;
          cursor: pointer !important; transition: transform 0.15s !important;
        }
        .phys-dot:hover { transform: scale(1.5) !important; }
        .site-pin {
          border-radius: 50% 50% 50% 0 !important;
          transform: rotate(-45deg) !important;
          border: 2.5px solid white !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.35) !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Center: average of all mappable physicians or fall back to site
    const centerLat = mappable.length
      ? mappable.reduce((s, p) => s + p.lat!, 0) / mappable.length
      : selectedSite.lat;
    const centerLng = mappable.length
      ? mappable.reduce((s, p) => s + p.lng!, 0) / mappable.length
      : selectedSite.lng;

    const map = L.mapquest.map(mapDivRef.current, {
      center:      [centerLat, centerLng],
      layers:      L.mapquest.tileLayer("map"),
      zoom:        10,
      zoomControl: false,
    });
    mapRef.current = map;

    // Trial site marker (red pin)
    const siteIcon = L.divIcon({
      html: `<div class="site-pin" style="width:16px;height:16px;background:${SITE_COLOR};"></div>`,
      className: "", iconSize: [16, 16], iconAnchor: [8, 16],
    });
    const siteMarker = L.marker([selectedSite.lat, selectedSite.lng], { icon: siteIcon }).addTo(map);
    siteMarker.bindTooltip(
      `<div style="font-weight:700;color:#dc2626;">📍 Trial Site</div>
       <div style="font-size:11px;color:#64748b;">${selectedSite.facility ?? ""}</div>`,
      { permanent: false, direction: "top", offset: [0, -14], className: "phys-tooltip" }
    );

    // Physician markers
    markersRef.current = mappable.map((p) => {
      const isSelected = p.npi === selectedNpi;
      const color      = isSelected ? "#1d4ed8" : PHYSICIAN_COLOR;
      const size       = isSelected ? 18 : 14;

      const icon = L.divIcon({
        html: `<div class="phys-dot" style="width:${size}px;height:${size}px;background:${color};"></div>`,
        className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);

      marker.bindTooltip(
        `<div style="font-weight:600;">${p.name}</div>
         <div style="font-size:11px;color:#64748b;">${p.taxonomy_desc ?? ""}</div>`,
        { permanent: false, direction: "top", offset: [0, -10], className: "phys-tooltip" }
      );

      const popupHtml = `
        <div>
          <div style="padding:12px 14px 10px;border-bottom:1px solid #f1f5f9;">
            <div style="font-weight:700;font-size:13px;color:#0f172a;padding-right:16px;">${p.name}</div>
            ${p.taxonomy_desc ? `<div style="font-size:11px;color:#3b82f6;margin-top:2px;">${p.taxonomy_desc}</div>` : ""}
          </div>
          <div style="padding:10px 14px;font-size:12px;color:#64748b;">
            ${p.address ? `<div>📍 ${p.address}</div>` : ""}
            ${p.phone   ? `<div style="margin-top:4px;">📞 ${p.phone}</div>` : ""}
            ${p.distance_miles != null ? `<div style="margin-top:4px;font-weight:600;color:#2563eb;">${p.distance_miles} mi from site</div>` : ""}
          </div>
        </div>`;

      marker.bindPopup(popupHtml, {
        className: "phys-popup", offset: [0, -8], maxWidth: 260, closeButton: true,
      });

      marker.on("click", () => { onSelect(p); marker.openPopup(); });

      return marker;
    });

    // Fit bounds to include site + all physician markers
    const allPoints: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
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
  }, [mapKey, physicians, selectedSite]);

  const zoomIn  = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const fitAll  = () => {
    if (!mapRef.current || !window.L) return;
    const pts: [number, number][] = [
      [selectedSite.lat, selectedSite.lng],
      ...mappable.map((p) => [p.lat!, p.lng!] as [number, number]),
    ];
    mapRef.current.fitBounds(window.L.latLngBounds(pts), { padding: [40, 40] });
  };

  if (!mapKey) {
    return (
      <div style={{
        height: 340, display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 10, background: "var(--gray-50, #f8fafc)",
        color: "var(--gray-400, #94a3b8)", borderRadius: 12,
      }}>
        <div style={{ fontSize: 36 }}>🗺️</div>
        <div style={{ fontSize: 14 }}>MapQuest API key not configured</div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden" }}>
      <div ref={mapDivRef} style={{ height: 340, width: "100%", background: "#e8edf2" }} />

      {/* Zoom controls */}
      <div style={{
        position: "absolute", top: 10, right: 10, zIndex: 1000,
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {[
          { icon: "+", title: "Zoom in",       fn: zoomIn  },
          { icon: "−", title: "Zoom out",      fn: zoomOut },
          { icon: "⊡", title: "Fit all",       fn: fitAll  },
        ].map((b) => (
          <button key={b.title} title={b.title} onClick={b.fn} style={{
            width: 32, height: 32, background: "white",
            border: "1px solid var(--gray-200, #e2e8f0)", borderRadius: 8,
            fontSize: 16, fontWeight: 700, color: "var(--gray-700, #334155)",
            cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
          }}>{b.icon}</button>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 10, left: 10, zIndex: 1000,
        background: "rgba(255,255,255,0.95)", border: "1px solid var(--gray-200, #e2e8f0)",
        borderRadius: 8, padding: "8px 12px",
        display: "flex", flexDirection: "column", gap: 5,
      }}>
        {[
          { color: SITE_COLOR,      label: "Trial site" },
          { color: PHYSICIAN_COLOR, label: "Physician"  },
        ].map((l) => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: l.color, border: "2px solid white",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--gray-600, #475569)" }}>
              {l.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}