"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Site = {
  facility: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: string | null;
  lat: number | null;
  lon: number | null;
};

type TrialSiteMapProps = {
  sites: Site[];
  trialTitle?: string;
};

type MapSdkState = "loading" | "ready" | "fallback";

type Bounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

type ProjectedSite = Site & {
  x: number;
  y: number;
  key: string;
};

type MapQuestWindow = Window &
  typeof globalThis & {
    L?: any;
  };

const MQ_KEY = process.env.NEXT_PUBLIC_MAPQUEST_KEY ?? "";
const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_KEY ?? "";
const MAPQUEST_SCRIPT_ID = "mapquest-sdk-script";
const MAPQUEST_STYLESHEET_ID = "mapquest-sdk-stylesheet";
const SVG_WIDTH = 1000;
const SVG_HEIGHT = 440;

const STATUS_COLORS: Record<string, string> = {
  RECRUITING: "#22c55e",
  NOT_YET_RECRUITING: "#f59e0b",
  ACTIVE_NOT_RECRUITING: "#3b82f6",
  COMPLETED: "#6b7280",
  TERMINATED: "#ef4444",
  WITHDRAWN: "#ef4444",
};

const DEFAULT_BOUNDS: Bounds = {
  minLat: -55,
  maxLat: 75,
  minLon: -180,
  maxLon: 180,
};

function getStatusColor(status: string | null): string {
  if (!status) return "#8b5cf6";
  return STATUS_COLORS[status.toUpperCase()] ?? "#8b5cf6";
}

function formatStatus(status: string | null): string {
  return status ? status.replace(/_/g, " ") : "Unknown";
}

function formatLocation(site: Site): string {
  return [site.city, site.state, site.country].filter(Boolean).join(", ");
}

function formatSiteLabel(site: Site): string {
  return [site.facility || "Unknown site", formatLocation(site), formatStatus(site.status)]
    .filter(Boolean)
    .join(" | ");
}

function getViewportBounds(sites: Site[]): Bounds {
  if (sites.length === 0) return DEFAULT_BOUNDS;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const site of sites) {
    if (site.lat == null || site.lon == null) continue;
    minLat = Math.min(minLat, site.lat);
    maxLat = Math.max(maxLat, site.lat);
    minLon = Math.min(minLon, site.lon);
    maxLon = Math.max(maxLon, site.lon);
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) {
    return DEFAULT_BOUNDS;
  }

  const latSpan = Math.max(maxLat - minLat, 3);
  const lonSpan = Math.max(maxLon - minLon, 3);
  const latPad = latSpan * 0.18;
  const lonPad = lonSpan * 0.18;

  return {
    minLat: Math.max(-85, minLat - latPad),
    maxLat: Math.min(85, maxLat + latPad),
    minLon: Math.max(-180, minLon - lonPad),
    maxLon: Math.min(180, maxLon + lonPad),
  };
}

function buildGeoapifyStaticMapUrl(sites: Site[]): string | null {
  if (!GEOAPIFY_KEY || sites.length === 0) return null;

  const bounds = getViewportBounds(sites);
  const params = new URLSearchParams();

  params.set("style", "osm-carto");
  params.set("width", "1400");
  params.set("height", "900");
  params.set("format", "png");
  params.set("scaleFactor", "2");
  params.set(
    "area",
    `rect:${bounds.minLon},${bounds.maxLat},${bounds.maxLon},${bounds.minLat}`,
  );
  params.set(
    "marker",
    sites
      .map((site, index) =>
        [
          `lonlat:${site.lon},${site.lat}`,
          "type:circle",
          `color:${getStatusColor(site.status)}`,
          "size:36",
          `text:${index + 1}`,
          "contentsize:16",
          "contentcolor:#ffffff",
          "whitecircle:no",
          "shadow:no",
          "strokecolor:#ffffff",
        ].join(";"),
      )
      .join("|"),
  );
  params.set("apiKey", GEOAPIFY_KEY);

  return `https://maps.geoapify.com/v1/staticmap?${params.toString()}`;
}

function projectPoint(lat: number, lon: number, bounds: Bounds) {
  const x =
    ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * SVG_WIDTH;
  const y =
    SVG_HEIGHT -
    ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * SVG_HEIGHT;

  return {
    x: Math.min(SVG_WIDTH - 22, Math.max(22, x)),
    y: Math.min(SVG_HEIGHT - 22, Math.max(22, y)),
  };
}

function getGridStep(span: number): number {
  if (span <= 10) return 2;
  if (span <= 20) return 5;
  if (span <= 40) return 10;
  return 20;
}

function buildGridLines(start: number, end: number, step: number): number[] {
  const first = Math.ceil(start / step) * step;
  const values: number[] = [];

  for (let value = first; value <= end; value += step) {
    values.push(Number(value.toFixed(2)));
  }

  return values;
}

function formatLatitude(value: number): string {
  return `${Math.abs(Math.round(value))}${value >= 0 ? "N" : "S"}`;
}

function formatLongitude(value: number): string {
  return `${Math.abs(Math.round(value))}${value >= 0 ? "E" : "W"}`;
}

function getSvgMarker(color: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z"
        fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="14" cy="14" r="5" fill="white" opacity="0.9"/>
    </svg>
  `;
}

function StaticFallbackMap({
  sites,
  mapUrl,
  onError,
}: {
  sites: Site[];
  mapUrl: string;
  onError: () => void;
}) {
  return (
    <div>
      <div
        style={{
          marginBottom: "10px",
          padding: "10px 14px",
          background: "#0a1628",
          border: "1px solid #1e3a5f",
          borderRadius: "8px",
          color: "#93c5fd",
          fontSize: "12px",
        }}
      >
        Showing a static site map because the interactive MapQuest SDK was not
        available in this browser session.
      </div>

      <div
        style={{
          position: "relative",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
          border: "1px solid #1e3a5f",
          background: "#0b1420",
        }}
      >
        <img
          src={mapUrl}
          alt="Static map showing clinical trial site locations"
          onError={onError}
          style={{
            width: "100%",
            height: "440px",
            display: "block",
            objectFit: "cover",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 2,
            background: "rgba(10,20,35,0.92)",
            border: "1px solid #1e4976",
            borderRadius: "8px",
            padding: "6px 12px",
            color: "#7dd3fc",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          Static map
        </div>

        <div
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            zIndex: 2,
            background: "rgba(10,20,35,0.92)",
            border: "1px solid #1e4976",
            borderRadius: "8px",
            padding: "6px 12px",
            color: "#cbd5e1",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          {sites.length} mapped sites
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "10px",
          marginTop: "12px",
        }}
      >
        {sites.map((site, index) => (
          <div
            key={`${site.facility ?? "site"}-${site.lat}-${site.lon}-${index}`}
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "flex-start",
              padding: "10px 12px",
              background: "#0a1628",
              border: "1px solid #1e3a5f",
              borderRadius: "10px",
            }}
          >
            <div
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "999px",
                flexShrink: 0,
                background: getStatusColor(site.status),
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              {index + 1}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#e2e8f0", fontSize: "12px", fontWeight: 600 }}>
                {site.facility || "Unknown site"}
              </div>
              <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "2px" }}>
                {formatLocation(site) || "Location unavailable"}
              </div>
              <div style={{ color: getStatusColor(site.status), fontSize: "11px", marginTop: "4px" }}>
                {formatStatus(site.status)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "10px",
          color: "#64748b",
          fontSize: "11px",
          lineHeight: 1.5,
        }}
      >
        Powered by{" "}
        <a
          href="https://www.geoapify.com/"
          target="_blank"
          rel="noreferrer"
          style={{ color: "#7dd3fc" }}
        >
          Geoapify
        </a>
        {" "}and{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          style={{ color: "#7dd3fc" }}
        >
          OpenStreetMap contributors
        </a>
        .
      </div>
    </div>
  );
}

function CoordinateFallbackMap({ sites }: { sites: Site[] }) {
  const bounds = useMemo(() => getViewportBounds(sites), [sites]);

  const projectedSites = useMemo<ProjectedSite[]>(() => {
    const duplicates = new Map<string, number>();

    return sites.map((site, index) => {
      const { x, y } = projectPoint(site.lat!, site.lon!, bounds);
      const duplicateKey = `${site.lat?.toFixed(3)}:${site.lon?.toFixed(3)}`;
      const duplicateIndex = duplicates.get(duplicateKey) ?? 0;
      duplicates.set(duplicateKey, duplicateIndex + 1);

      const angle = duplicateIndex * 0.9;
      const offset = duplicateIndex === 0 ? 0 : 8;

      return {
        ...site,
        key: `${site.facility ?? "site"}-${site.lat}-${site.lon}-${index}`,
        x: x + Math.cos(angle) * offset,
        y: y + Math.sin(angle) * offset,
      };
    });
  }, [bounds, sites]);

  const latLines = useMemo(() => {
    return buildGridLines(
      bounds.minLat,
      bounds.maxLat,
      getGridStep(bounds.maxLat - bounds.minLat),
    );
  }, [bounds]);

  const lonLines = useMemo(() => {
    return buildGridLines(
      bounds.minLon,
      bounds.maxLon,
      getGridStep(bounds.maxLon - bounds.minLon),
    );
  }, [bounds]);

  if (projectedSites.length === 0) {
    return (
      <div
        style={{
          padding: "28px",
          background: "#0d1b2a",
          border: "1px solid #1e3a5f",
          borderRadius: "12px",
          color: "#93c5fd",
          textAlign: "center",
        }}
      >
        No site coordinates are available for this trial yet.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          marginBottom: "10px",
          padding: "10px 14px",
          background: "#0a1628",
          border: "1px solid #1e3a5f",
          borderRadius: "8px",
          color: "#93c5fd",
          fontSize: "12px",
        }}
      >
        The static basemap could not be loaded either, so this is a last-resort
        coordinate view.
      </div>

      <div
        style={{
          position: "relative",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
          border: "1px solid #1e3a5f",
          background:
            "radial-gradient(circle at top, rgba(14, 116, 144, 0.18), transparent 40%), linear-gradient(180deg, #11243a 0%, #091321 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 2,
            background: "rgba(10,20,35,0.92)",
            border: "1px solid #1e4976",
            borderRadius: "8px",
            padding: "6px 12px",
            color: "#7dd3fc",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          Coordinate view
        </div>

        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label="Clinical trial site coordinate map"
          style={{ width: "100%", height: "440px", display: "block" }}
        >
          <defs>
            <linearGradient id="map-grid-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(125,211,252,0.24)" />
              <stop offset="100%" stopColor="rgba(125,211,252,0.08)" />
            </linearGradient>
          </defs>

          <rect
            x="0"
            y="0"
            width={SVG_WIDTH}
            height={SVG_HEIGHT}
            fill="rgba(7, 18, 33, 0.55)"
          />

          {lonLines.map((value) => {
            const { x } = projectPoint(bounds.minLat, value, bounds);
            return (
              <g key={`lon-${value}`}>
                <line
                  x1={x}
                  x2={x}
                  y1="0"
                  y2={SVG_HEIGHT}
                  stroke="url(#map-grid-fade)"
                  strokeDasharray="6 10"
                />
                <text
                  x={x}
                  y={SVG_HEIGHT - 10}
                  textAnchor="middle"
                  fill="#5b7ea6"
                  fontSize="11"
                >
                  {formatLongitude(value)}
                </text>
              </g>
            );
          })}

          {latLines.map((value) => {
            const { y } = projectPoint(value, bounds.minLon, bounds);
            return (
              <g key={`lat-${value}`}>
                <line
                  x1="0"
                  x2={SVG_WIDTH}
                  y1={y}
                  y2={y}
                  stroke="url(#map-grid-fade)"
                  strokeDasharray="6 10"
                />
                <text x="12" y={y - 8} fill="#5b7ea6" fontSize="11">
                  {formatLatitude(value)}
                </text>
              </g>
            );
          })}

          {projectedSites.map((site) => {
            const color = getStatusColor(site.status);

            return (
              <g key={site.key}>
                <circle
                  cx={site.x}
                  cy={site.y}
                  r="10"
                  fill={`${color}22`}
                  stroke="none"
                />
                <circle
                  cx={site.x}
                  cy={site.y}
                  r="5"
                  fill={color}
                  stroke="white"
                  strokeWidth="2"
                >
                  <title>{formatSiteLabel(site)}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function TrialSiteMap({ sites, trialTitle }: TrialSiteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [sdkState, setSdkState] = useState<MapSdkState>(
    MQ_KEY ? "loading" : "fallback",
  );
  const [staticMapFailed, setStaticMapFailed] = useState(false);

  const mappableSites = useMemo(
    () => sites.filter((site) => site.lat != null && site.lon != null),
    [sites],
  );

  const staticMapUrl = useMemo(
    () => buildGeoapifyStaticMapUrl(mappableSites),
    [mappableSites],
  );

  useEffect(() => {
    setStaticMapFailed(false);
  }, [staticMapUrl]);

  useEffect(() => {
    if (!MQ_KEY) {
      setSdkState("fallback");
      return;
    }

    const mapWindow = window as MapQuestWindow;

    if (mapWindow.L?.mapquest) {
      mapWindow.L.mapquest.key = MQ_KEY;
      setSdkState("ready");
      return;
    }

    setSdkState("loading");

    let cancelled = false;
    let retries = 0;

    const markFallback = () => {
      if (!cancelled) setSdkState("fallback");
    };

    const pollForSdk = () => {
      if (cancelled) return;

      const currentWindow = window as MapQuestWindow;
      if (currentWindow.L?.mapquest) {
        currentWindow.L.mapquest.key = MQ_KEY;
        setSdkState("ready");
        return;
      }

      retries += 1;
      if (retries >= 40) {
        markFallback();
        return;
      }

      window.setTimeout(pollForSdk, 250);
    };

    if (!document.getElementById(MAPQUEST_STYLESHEET_ID)) {
      const link = document.createElement("link");
      link.id = MAPQUEST_STYLESHEET_ID;
      link.rel = "stylesheet";
      link.href = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.css";
      document.head.appendChild(link);
    }

    const existingScript = document.getElementById(
      MAPQUEST_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    if (existingScript) {
      pollForSdk();
    } else {
      const script = document.createElement("script");
      script.id = MAPQUEST_SCRIPT_ID;
      script.src = "https://api.mqcdn.com/sdk/mapquest-js/v1.3.2/mapquest.js";
      script.async = true;
      script.onload = pollForSdk;
      script.onerror = markFallback;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sdkState !== "ready" || !containerRef.current) return;

    const mapWindow = window as MapQuestWindow;
    const L = mapWindow.L;

    if (!L?.mapquest) {
      setSdkState("fallback");
      return;
    }

    try {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const element = containerRef.current;
      (element as HTMLDivElement & { _leaflet_id?: number | null })._leaflet_id =
        null;
      element.innerHTML = "";

      L.mapquest.key = MQ_KEY;

      let centerLat = 39.5;
      let centerLon = -98.35;
      let zoom = 4;

      if (mappableSites.length > 0) {
        centerLat =
          mappableSites.reduce((sum, site) => sum + site.lat!, 0) /
          mappableSites.length;
        centerLon =
          mappableSites.reduce((sum, site) => sum + site.lon!, 0) /
          mappableSites.length;
        zoom = mappableSites.length === 1 ? 10 : 4;
      }

      const map = L.mapquest.map(element, {
        center: [centerLat, centerLon],
        zoom,
        layers: L.mapquest.tileLayer("map"),
      });
      mapRef.current = map;

      if (typeof L.mapquest.control === "function") {
        map.addControl(L.mapquest.control());
      }

      mappableSites.forEach((site) => {
        const color = getStatusColor(site.status);
        const markerIcon = L.divIcon({
          html: getSvgMarker(color),
          className: "",
          iconSize: [28, 36],
          iconAnchor: [14, 36],
          popupAnchor: [0, -36],
        });

        const label = [
          site.facility
            ? `<strong style="font-size:13px">${site.facility}</strong>`
            : "",
          formatLocation(site),
          site.status
            ? `<span style="color:${color};font-size:11px;font-weight:600">${formatStatus(site.status)}</span>`
            : "",
        ]
          .filter(Boolean)
          .join("<br/>");

        L.marker([site.lat!, site.lon!], { icon: markerIcon })
          .bindPopup(`<div style="min-width:160px;line-height:1.6">${label}</div>`)
          .addTo(map);
      });

      if (mappableSites.length > 1) {
        const bounds = L.latLngBounds(
          mappableSites.map((site) => [site.lat!, site.lon!]),
        );
        map.fitBounds(bounds, { padding: [40, 40] });
      }

      window.setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      }, 200);
    } catch {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          // Ignore cleanup failures while switching to fallback maps.
        }
        mapRef.current = null;
      }
      setSdkState("fallback");
    }

    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          // Ignore cleanup failures during unmount.
        }
        mapRef.current = null;
      }
    };
  }, [mappableSites, sdkState]);

  const legend = [
    { label: "Recruiting", color: STATUS_COLORS.RECRUITING },
    { label: "Not Yet Recruiting", color: STATUS_COLORS.NOT_YET_RECRUITING },
    {
      label: "Active (not recruiting)",
      color: STATUS_COLORS.ACTIVE_NOT_RECRUITING,
    },
    { label: "Completed", color: STATUS_COLORS.COMPLETED },
    { label: "Terminated/Withdrawn", color: STATUS_COLORS.TERMINATED },
  ];

  const sitesWithoutCoordinates = sites.filter(
    (site) => site.lat == null || site.lon == null,
  );

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {trialTitle && (
        <div
          style={{ marginBottom: "10px", color: "#94a3b8", fontSize: "12px" }}
        >
          {trialTitle}
        </div>
      )}

      {sdkState === "fallback" ? (
        staticMapUrl && !staticMapFailed ? (
          <StaticFallbackMap
            sites={mappableSites}
            mapUrl={staticMapUrl}
            onError={() => setStaticMapFailed(true)}
          />
        ) : (
          <CoordinateFallbackMap sites={mappableSites} />
        )
      ) : (
        <div
          style={{
            position: "relative",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            border: "1px solid #1e3a5f",
          }}
        >
          <div ref={containerRef} style={{ width: "100%", height: "440px" }} />

          <div
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              zIndex: 1000,
              background: "rgba(10,20,35,0.92)",
              backdropFilter: "blur(8px)",
              border: "1px solid #1e4976",
              borderRadius: "8px",
              padding: "6px 12px",
              color: "#7dd3fc",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {mappableSites.length} / {sites.length} sites mapped
          </div>

          {sdkState === "loading" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "#0d1b2a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#4b6a8a",
                fontSize: "13px",
              }}
            >
              Initializing MapQuest...
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          marginTop: "12px",
          padding: "10px 14px",
          background: "#0a1628",
          borderRadius: "8px",
          border: "1px solid #1e3a5f",
        }}
      >
        {legend.map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              color: "#94a3b8",
            }}
          >
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: item.color,
                flexShrink: 0,
              }}
            />
            {item.label}
          </div>
        ))}
      </div>

      {sitesWithoutCoordinates.length > 0 && (
        <div
          style={{
            marginTop: "10px",
            padding: "10px 14px",
            background: "#111827",
            borderRadius: "8px",
            border: "1px solid #292524",
          }}
        >
          <div
            style={{ fontSize: "11px", color: "#6b7280", marginBottom: "6px" }}
          >
            Sites without map coordinates:
          </div>
          {sitesWithoutCoordinates.map((site, index) => (
            <div
              key={index}
              style={{ fontSize: "12px", color: "#9ca3af", padding: "2px 0" }}
            >
              {site.facility || "Unknown"} - {formatLocation(site)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
