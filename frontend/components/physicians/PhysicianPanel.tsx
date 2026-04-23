// components/physicians/PhysicianPanel.tsx
// Updated: Lead capture modal on "Load More", improved design,
// radius distance note, universal color conventions.
// Fix: specialty pre-filled from site.condition; auto-search on mount.

"use client";

import React, { useState, useCallback, useEffect } from "react";
import PhysicianMap  from "./PhysicianMap";
import PhysicianCard from "./PhysicianCard";
import { submitLead } from "@/lib/api";
import type { Physician, SelectedSite } from "@/types/physician";

type Props = {
  site:        SelectedSite;
  physicians:  Physician[];
  total:       number;
  loading:     boolean;
  error:       string | null;
  searched:    boolean;
  hasMore:     boolean;
  onSearch:    (radius: number, specialty: string) => void;
  onLoadMore:  () => void;
  onBack:      () => void;
};

type Tab = "map" | "list";
const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

type BulkLeadModalProps = {
  physicians:     Physician[];
  remainingCount: number;
  site:           SelectedSite;
  onClose:        () => void;
  onContinue:     () => void;
};

function BulkLeadCaptureModal({
  physicians,
  remainingCount,
  site,
  onClose,
  onContinue,
}: BulkLeadModalProps) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await Promise.all(
        physicians.map((physician) =>
          submitLead({
            name:    form.name.trim(),
            email:   form.email.trim(),
            phone:   form.phone.trim(),
            npi:     physician.npi,
            nct_id:  site.nct_id,
            site:    site.facility ?? "",
            message: form.message.trim(),
          })
        )
      );
      setSubmitted(true);
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width:       "100%",
    padding:     "9px 12px",
    border:      "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize:    14,
    color:       "#0f172a",
    background:  "#f8fafc",
    outline:     "none",
    boxSizing:   "border-box",
    fontFamily:  "'Sora', sans-serif",
    transition:  "border-color 0.15s",
  };

  return (
    <div
      style={{
        position:        "fixed",
        inset:           0,
        background:      "rgba(0,0,0,0.5)",
        zIndex:          1100,
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        padding:         16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background:   "#fff",
          borderRadius: 18,
          width:        "100%",
          maxWidth:     500,
          boxShadow:    "0 32px 80px rgba(0,0,0,0.20)",
          overflow:     "hidden",
          fontFamily:   "'Sora', sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding:      "20px 24px 16px",
            borderBottom: "1px solid #f1f5f9",
            background:   "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                Capture Leads — {physicians.length} Physicians
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                Submit your contact info once to capture leads for all visible physicians
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 22, color: "#94a3b8", lineHeight: 1, padding: 0,
              }}
            >×</button>
          </div>

          <div
            style={{
              display:   "flex",
              flexWrap:  "wrap",
              gap:       5,
              marginTop: 12,
              maxHeight: 72,
              overflow:  "hidden",
            }}
          >
            {physicians.slice(0, 8).map((physician) => (
              <span
                key={physician.npi}
                style={{
                  padding:      "2px 9px",
                  borderRadius: 20,
                  background:   "white",
                  border:       "1px solid #bfdbfe",
                  fontSize:     11,
                  color:        "#2563eb",
                  fontWeight:   600,
                }}
              >
                {physician.name.split(" ").slice(-1)[0]}
              </span>
            ))}
            {physicians.length > 8 && (
              <span
                style={{
                  padding:      "2px 9px",
                  borderRadius: 20,
                  background:   "#f1f5f9",
                  border:       "1px solid #e2e8f0",
                  fontSize:     11,
                  color:        "#64748b",
                  fontWeight:   600,
                }}
              >
                +{physicians.length - 8} more
              </span>
            )}
          </div>
        </div>

        {/* Meta strip */}
        <div
          style={{
            padding:      "8px 24px",
            background:   "#f8fafc",
            borderBottom: "1px solid #f1f5f9",
            fontSize:     12,
            color:        "#64748b",
            display:      "flex",
            gap:          16,
            flexWrap:     "wrap",
          }}
        >
          <span>Trial: <strong style={{ color: "#0f172a" }}>{site.nct_id}</strong></span>
          {site.facility && (
            <span>Site: <strong style={{ color: "#0f172a" }}>{site.facility}</strong></span>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 24px" }}>
          {submitted ? (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>
                {physicians.length} leads captured!
              </div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
                Your details have been saved for all visible physicians.
              </div>
              <button
                onClick={remainingCount > 0 ? onContinue : onClose}
                style={{
                  padding:     "10px 28px",
                  borderRadius: 9,
                  border:      "none",
                  background:  "#2563eb",
                  color:       "#fff",
                  fontWeight:  700,
                  fontSize:    14,
                  cursor:      "pointer",
                  fontFamily:  "'Sora', sans-serif",
                }}
              >
                {remainingCount > 0 ? `Continue to ${remainingCount} More` : "Done"}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 5, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                    Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input type="text" required value={form.name} onChange={set("name")} placeholder="Your name" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 5, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                    Email <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input type="email" required value={form.email} onChange={set("email")} placeholder="you@org.com" style={inputStyle} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 5, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Phone <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                </label>
                <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+1 (555) 000-0000" style={inputStyle} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 5, letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Message <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                </label>
                <textarea value={form.message} onChange={set("message")} placeholder="Notes about this outreach…" rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
              </div>

              {error && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fee2e2", color: "#dc2626", fontSize: 13, border: "1px solid #fecaca" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding:     "10px 20px",
                    borderRadius: 9,
                    border:      "1px solid #e2e8f0",
                    background:  "transparent",
                    color:       "#475569",
                    fontWeight:  600,
                    fontSize:    14,
                    cursor:      "pointer",
                    fontFamily:  "'Sora', sans-serif",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !form.name.trim() || !form.email.trim()}
                  style={{
                    padding:     "10px 24px",
                    borderRadius: 9,
                    border:      "none",
                    background:  submitting ? "#e2e8f0" : "#2563eb",
                    color:       submitting ? "#94a3b8" : "#fff",
                    fontWeight:  700,
                    fontSize:    14,
                    cursor:      submitting ? "not-allowed" : "pointer",
                    fontFamily:  "'Sora', sans-serif",
                    transition:  "all 0.15s",
                  }}
                >
                  {submitting ? "Saving…" : `Save ${physicians.length} Leads`}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PhysicianPanel({
  site,
  physicians,
  total,
  loading,
  error,
  searched,
  hasMore,
  onSearch,
  onLoadMore,
  onBack,
}: Props) {
  const [tab,         setTab        ] = useState<Tab>("map");
  const [radius,      setRadius     ] = useState(25);
  // ── FIX: pre-fill specialty from site.condition so the backend receives
  //         the trial condition as the specialty anchor on every search.
  const [specialty,   setSpecialty  ] = useState(site.condition ?? "");
  const [selectedNpi, setSelectedNpi] = useState<string | null>(null);
  const [showBulkLead, setShowBulkLead] = useState(false);

  const remainingCount = Math.max(0, total - physicians.length);

  // ── FIX: auto-trigger search on mount so physicians matching the trial
  //         condition are loaded immediately without the user clicking Search.
  useEffect(() => {
    onSearch(radius, site.condition ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  const handleSearch = useCallback(() => {
    onSearch(radius, specialty.trim());
  }, [radius, specialty, onSearch]);

  const handleSelectPhysician = useCallback((physician: Physician) => {
    setSelectedNpi((prev) => (prev === physician.npi ? null : physician.npi));
    setTab("list");
  }, []);

  const handleContinueLoadMore = useCallback(() => {
    onLoadMore();
    setShowBulkLead(false);
  }, [onLoadMore]);

  const siteLabel = [site.facility, site.city, site.state].filter(Boolean).join(", ") || "Selected site";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        @keyframes ppSpin { to { transform: rotate(360deg); } }
        .pp-spinner {
          width: 28px; height: 28px;
          border: 3px solid #f1f5f9;
          border-top-color: #2563eb;
          border-radius: 50%;
          animation: ppSpin 0.75s linear infinite;
        }
        .pp-tab-btn {
          flex: 1; padding: 11px 0; border: none;
          background: transparent;
          font-size: 13px; font-weight: 600;
          cursor: pointer; font-family: 'Sora', sans-serif;
          transition: all 0.15s;
          display: flex; align-items: center; justify-content: center; gap: 5px;
        }
        .pp-load-more-btn {
          margin: 12px 16px 16px;
          width: calc(100% - 32px);
          padding: 11px 0;
          border-radius: 10px;
          border: 1.5px dashed #cbd5e1;
          background: transparent;
          color: #64748b;
          font-size: 13px; font-weight: 600;
          cursor: pointer;
          font-family: 'Sora', sans-serif;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: all 0.15s;
        }
        .pp-load-more-btn:hover {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontFamily: "'Sora', sans-serif" }}>

        {/* ── Header / controls ─────────────────────────────────────────── */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", background: "#fff", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <button
              onClick={onBack}
              style={{
                background:     "#f1f5f9",
                border:         "none",
                cursor:         "pointer",
                width:          28,
                height:         28,
                borderRadius:   8,
                fontSize:       14,
                color:          "#64748b",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                transition:     "all 0.12s",
              }}
              title="Back to trial sites"
              onMouseEnter={(e) => { e.currentTarget.style.background = "#e2e8f0"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#f1f5f9"; }}
            >←</button>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
              Physicians near site
            </div>
          </div>

          <div
            style={{
              display:      "inline-flex",
              alignItems:   "center",
              gap:          6,
              padding:      "4px 12px",
              borderRadius: 20,
              background:   "#eff6ff",
              border:       "1px solid #bfdbfe",
              fontSize:     11,
              color:        "#2563eb",
              fontWeight:   600,
              marginBottom: 12,
              maxWidth:     "100%",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {siteLabel}
            </span>
          </div>

          {/* Search controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              style={{
                padding:     "8px 10px",
                borderRadius: 8,
                border:      "1px solid #e2e8f0",
                fontSize:    13,
                color:       "#334155",
                background:  "#f8fafc",
                cursor:      "pointer",
                fontFamily:  "'Sora', sans-serif",
                outline:     "none",
              }}
            >
              {RADIUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option} miles</option>
              ))}
            </select>

            <input
              type="text"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Specialty (optional)"
              style={{
                flex:        1,
                minWidth:    120,
                padding:     "8px 12px",
                borderRadius: 8,
                border:      "1px solid #e2e8f0",
                fontSize:    13,
                color:       "#334155",
                background:  "#f8fafc",
                outline:     "none",
                fontFamily:  "'Sora', sans-serif",
                transition:  "border-color 0.15s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#60a5fa"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
            />

            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                padding:      "8px 18px",
                borderRadius: 8,
                border:       "none",
                background:   loading ? "#e2e8f0" : "#2563eb",
                color:        loading ? "#94a3b8" : "#fff",
                fontSize:     13,
                fontWeight:   700,
                cursor:       loading ? "not-allowed" : "pointer",
                whiteSpace:   "nowrap",
                fontFamily:   "'Sora', sans-serif",
                transition:   "all 0.15s",
                display:      "flex",
                alignItems:   "center",
                gap:          5,
              }}
            >
              {loading ? (
                <>
                  <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "ppSpin 0.7s linear infinite" }} />
                  Searching…
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  Search
                </>
              )}
            </button>
          </div>

          {/* Condition badge — shows what specialty was auto-resolved from */}
          {site.condition && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>
              <span style={{ fontWeight: 600, color: "#475569" }}>Trial condition:</span>{" "}
              <span
                style={{
                  display:      "inline-block",
                  padding:      "1px 8px",
                  borderRadius: 20,
                  background:   "#f0fdf4",
                  border:       "1px solid #bbf7d0",
                  color:        "#15803d",
                  fontWeight:   600,
                  fontSize:     11,
                }}
              >
                {site.condition}
              </span>
            </div>
          )}
        </div>

        {/* ── Stats strip ───────────────────────────────────────────────── */}
        {searched && !loading && physicians.length > 0 && (
          <div style={{ display: "flex", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
            {[
              { label: "Found",   value: total              },
              { label: "Showing", value: physicians.length  },
              { label: "Radius",  value: `${radius} mi`    },
            ].map((stat, index, all) => (
              <div
                key={index}
                style={{
                  flex:        1,
                  padding:     "11px 0",
                  textAlign:   "center",
                  borderRight: index < all.length - 1 ? "1px solid #f1f5f9" : "none",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: "#0f172a", fontFamily: "'IBM Plex Mono', monospace" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Map / List tabs ───────────────────────────────────────────── */}
        {searched && !loading && physicians.length > 0 && (
          <div style={{ display: "flex", borderBottom: "1px solid #f1f5f9", background: "#fff", flexShrink: 0 }}>
            {(["map", "list"] as Tab[]).map((nextTab) => (
              <button
                key={nextTab}
                className="pp-tab-btn"
                onClick={() => setTab(nextTab)}
                style={{
                  borderBottom: tab === nextTab ? "2px solid #2563eb" : "2px solid transparent",
                  color:        tab === nextTab ? "#2563eb" : "#94a3b8",
                }}
              >
                {nextTab === "map" ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                    Map
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
                      <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                    List
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Scrollable content area ───────────────────────────────────── */}
        <div style={{ flex: 1, overflow: "auto" }}>

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 56, color: "#94a3b8" }}>
              <div className="pp-spinner" />
              <p style={{ fontSize: 14, margin: 0, fontWeight: 500 }}>Searching physicians…</p>
            </div>
          )}

          {!loading && error && (
            <div style={{ margin: "16px", padding: "14px 16px", borderRadius: 10, background: "#fef2f2", color: "#dc2626", fontSize: 13, border: "1px solid #fecaca", fontWeight: 500 }}>
              {error}
            </div>
          )}

          {!loading && !error && !searched && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 56, textAlign: "center", color: "#94a3b8" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <path d="M20 7h-9" /><path d="M14 17H5" />
                <circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" />
              </svg>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#64748b" }}>
                Set your radius and press Search<br />to find physicians near this site
              </p>
              <p style={{ fontSize: 12, margin: 0, color: "#94a3b8" }}>
                Distance is calculated using straight-line (as-the-crow-flies) miles from the trial site coordinates.
              </p>
            </div>
          )}

          {!loading && !error && searched && physicians.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 56, textAlign: "center", color: "#94a3b8" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                No physicians found within {radius} miles.
              </p>
              <p style={{ fontSize: 13, margin: 0 }}>
                Try increasing the radius or broadening the specialty filter.
              </p>
            </div>
          )}

          {!loading && !error && physicians.length > 0 && tab === "map" && (
            <div style={{ padding: 16 }}>
              <PhysicianMap
                physicians={physicians}
                selectedSite={site}
                selectedNpi={selectedNpi}
                onSelect={handleSelectPhysician}
              />
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 10, textAlign: "center", fontStyle: "italic" }}>
                Distances shown are straight-line miles from the trial site.
              </p>
            </div>
          )}

          {!loading && !error && physicians.length > 0 && tab === "list" && (
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {physicians.map((physician, index) => (
                <PhysicianCard
                  key={physician.npi}
                  physician={physician}
                  index={index}
                  nctId={site.nct_id}
                  siteName={site.facility}
                  isSelected={physician.npi === selectedNpi}
                  onSelect={handleSelectPhysician}
                />
              ))}
            </div>
          )}

          {!loading && !error && physicians.length > 0 && hasMore && (
            <button className="pp-load-more-btn" onClick={() => setShowBulkLead(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              Load more ({remainingCount} remaining) — Capture leads first
            </button>
          )}

          {!loading && !error && physicians.length > 0 && !hasMore && (
            <p style={{ textAlign: "center", fontSize: 11, color: "#cbd5e1", padding: "12px 16px", fontStyle: "italic" }}>
              All {total} physicians shown
            </p>
          )}
        </div>
      </div>

      {showBulkLead && (
        <BulkLeadCaptureModal
          physicians={physicians}
          remainingCount={remainingCount}
          site={site}
          onClose={() => setShowBulkLead(false)}
          onContinue={handleContinueLoadMore}
        />
      )}
    </>
  );
}