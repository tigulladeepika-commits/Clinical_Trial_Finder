"use client";

import { useEffect, useRef } from "react";

type Site = {
  facility: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: string | null;
  lat: number | null;
  lon: number | null;
};

type Props = {
  sites: Site[];
  trialTitle: string;
};

function siteBadgeClass(status: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "recruiting") return "badge badge-status-recruiting";
  if (s.includes("active")) return "badge badge-status-active";
  return "badge badge-status-default";
}

export default function TrialSiteMap({ sites, trialTitle }: Props) {
  const mapKey = process.env.NEXT_PUBLIC_MAPQUEST_KEY || "";
  const mappableSites = sites.filter((s) => s.lat != null && s.lon != null);

  // Build MapQuest static map URL with markers
  const buildMapUrl = () => {
    if (!mapKey || mappableSites.length === 0) return null;

    const center = mappableSites[0];
    const markers = mappableSites
      .slice(0, 20)
      .map((s) => `${s.lat},${s.lon}`)
      .join("||");

    return (
      `https://www.mapquestapi.com/staticmap/v5/map?key=${mapKey}` +
      `&center=${center.lat},${center.lon}` +
      `&zoom=4&size=800,380@2x` +
      `&locations=${markers}` +
      `&defaultMarker=marker-sm-616ADE-FF5733`
    );
  };

  const mapUrl = buildMapUrl();

  return (
    <div>
      {/* ── MAP ── */}
      <div className="map-container">
        {mapUrl ? (
          <img
            src={mapUrl}
            alt="Trial site locations map"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div style={{
            height: "100%", display: "flex", alignItems: "center",
            justifyContent: "center", flexDirection: "column", gap: 8,
            color: "var(--gray-400)", fontSize: 14,
          }}>
            <div style={{ fontSize: 32 }}>🗺️</div>
            <div>Map not available</div>
            <div style={{ fontSize: 12 }}>
              {!mapKey ? "MapQuest API key not configured" : "No geocoded locations"}
            </div>
          </div>
        )}
      </div>

      {/* ── SUMMARY BAR ── */}
      <div className="sites-summary-bar">
        <div className="summary-stat">
          <strong>{sites.length}</strong>
          Total Sites
        </div>
        <div className="summary-stat">
          <strong>{sites.filter((s) => (s.status || "").toLowerCase() === "recruiting").length}</strong>
          Recruiting
        </div>
        <div className="summary-stat">
          <strong>{mappableSites.length}</strong>
          Mapped
        </div>
        <div className="summary-stat">
          <strong>{[...new Set(sites.map((s) => s.country).filter(Boolean))].length}</strong>
          Countries
        </div>
      </div>

      {/* ── DETAIL CONTENT ── */}
      <div className="detail-content">
        {/* All Locations Grid */}
        <div className="detail-section">
          <div className="section-title">All Locations</div>
          {sites.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--gray-400)" }}>No location data available.</p>
          ) : (
            <div className="sites-grid">
              {sites.map((site, i) => (
                <div key={i} className="site-card">
                  <div className="site-facility">{site.facility || "Unknown Facility"}</div>
                  <div className="site-location">
                    {[site.city, site.state, site.country].filter(Boolean).join(", ") || "Location unknown"}
                  </div>
                  {site.status && (
                    <span className={`site-status ${siteBadgeClass(site.status)}`}>
                      {site.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}