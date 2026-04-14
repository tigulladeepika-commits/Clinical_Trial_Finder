"use client";

import { useState, FormEvent } from "react";

type SearchFilters = {
  condition: string;
  city: string;
  state: string;
  status: string;
  phase: string;
};

type SearchFormProps = {
  onSearch: (filters: SearchFilters) => void;
  loading?: boolean;
  compact?: boolean;
};

const PHASES = [
  { label: "Any Phase",     value: "" },
  { label: "Early Phase 1", value: "early phase 1" },
  { label: "Phase 1",       value: "phase1" },
  { label: "Phase 2",       value: "phase2" },
  { label: "Phase 3",       value: "phase3" },
  { label: "Phase 4",       value: "phase4" },
];

const STATUSES = [
  { label: "Any Status",             value: "" },
  { label: "Recruiting",             value: "recruiting" },
  { label: "Not Yet Recruiting",     value: "not yet recruiting" },
  { label: "Active (not recruiting)",value: "active, not recruiting" },
  { label: "Completed",              value: "completed" },
  { label: "Terminated",             value: "terminated" },
];

const QUICK_CONDITIONS = [
  "Breast Cancer","Lung Cancer","Diabetes","Alzheimer",
  "Heart Failure","Depression","COPD","Leukemia","COVID","Stroke",
];

const US_STATES = [
  "","AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY","DC",
];

/* ─── tokens ─────────────────────────────────────────────────────────────── */
const C = {
  bg:          "#f8fafc",
  card:        "#ffffff",
  border:      "#e8edf3",
  borderFocus: "#3b82f6",
  text:        "#0f172a",
  muted:       "#64748b",
  hint:        "#94a3b8",
  blue:        "#2563eb",
  blueHover:   "#1d4ed8",
  blueFaint:   "#eff6ff",
  blueBorder:  "#bfdbfe",
  green:       "#22c55e",
  greenText:   "#166534",
  greenFaint:  "#f0fdf4",
  greenBorder: "#bbf7d0",
  danger:      "#ef4444",
};

export default function SearchForm({ onSearch, loading, compact }: SearchFormProps) {
  const [condition, setCondition] = useState("");
  const [city,      setCity]      = useState("");
  const [state,     setState]     = useState("");
  const [status,    setStatus]    = useState("");
  const [phase,     setPhase]     = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!condition.trim()) return;
    onSearch({ condition: condition.trim(), city: city.trim(), state, status, phase });
  };

  const handleQuick = (q: string) => {
    setCondition(q);
    onSearch({ condition: q, city: city.trim(), state, status, phase });
  };

  /* ── shared input style ── */
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 13px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 10,
    fontSize: 14,
    color: C.text,
    background: C.bg,
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s, box-shadow 0.15s",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.55px",
    textTransform: "uppercase",
    color: C.hint,
    marginBottom: 6,
  };

  /* ── COMPACT mode ── */
  if (compact) {
    return (
      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto",
          gap: 12,
          alignItems: "flex-end",
        }}>
          {/* Condition */}
          <div>
            <label style={labelStyle}>Condition <span style={{ color: C.danger }}>*</span></label>
            <input style={inputStyle} type="text" value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. Breast Cancer…" required />
          </div>
          {/* City */}
          <div>
            <label style={labelStyle}>City</label>
            <input style={inputStyle} type="text" value={city}
              onChange={(e) => setCity(e.target.value)} placeholder="Boston" />
          </div>
          {/* State */}
          <div>
            <label style={labelStyle}>State</label>
            <select style={{ ...inputStyle, cursor: "pointer" }} value={state}
              onChange={(e) => setState(e.target.value)}>
              {US_STATES.map((s) => <option key={s} value={s}>{s || "Any"}</option>)}
            </select>
          </div>
          {/* Phase */}
          <div>
            <label style={labelStyle}>Phase</label>
            <select style={{ ...inputStyle, cursor: "pointer" }} value={phase}
              onChange={(e) => setPhase(e.target.value)}>
              {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {/* Status */}
          <div>
            <label style={labelStyle}>Status</label>
            <select style={{ ...inputStyle, cursor: "pointer" }} value={status}
              onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {/* Submit */}
          <button type="submit" disabled={loading || !condition.trim()}
            style={{
              padding: "10px 20px",
              background: C.blue,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || !condition.trim() ? "not-allowed" : "pointer",
              opacity: loading || !condition.trim() ? 0.55 : 1,
              whiteSpace: "nowrap",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
            {loading ? "Searching…" : "🔍 Search"}
          </button>
        </div>
      </form>
    );
  }

  /* ── HERO mode ── */
  return (
    <>
      {/* Outer shell — full width with breathing room */}
      <div style={{
        width: "100%",
        padding: "28px clamp(20px, 4vw, 96px)",
        background: C.bg,
        boxSizing: "border-box",
        fontFamily: "inherit",
      }}>
        {/* Card */}
        <div style={{
          background: C.card,
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          boxShadow: "0 2px 16px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.03)",
          padding: "32px 36px 28px",
        }}>

          {/* ── Header row ── */}
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 28,
            flexWrap: "wrap",
          }}>
            {/* Left: title + subtitle */}
            <div>
              <h1 style={{
                margin: 0,
                fontSize: "clamp(20px, 2.2vw, 24px)",
                fontWeight: 700,
                color: C.text,
                letterSpacing: "-0.4px",
                lineHeight: 1.2,
              }}>
                Clinical Trial Finder
              </h1>
              <p style={{
                margin: "5px 0 0",
                fontSize: 13,
                color: C.muted,
                fontWeight: 400,
              }}>
                Find trials by condition, location, phase, or status.
              </p>
            </div>

            {/* Right: live data badge */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              color: C.greenText,
              background: C.greenFaint,
              border: `1px solid ${C.greenBorder}`,
              borderRadius: 20,
              padding: "5px 13px",
              flexShrink: 0,
              alignSelf: "flex-start",
              marginTop: 3,
              whiteSpace: "nowrap",
            }}>
              {/* Pulsing dot via inline animation */}
              <span style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: C.green,
                flexShrink: 0,
                display: "inline-block",
                animation: "sfPulse 2s ease-in-out infinite",
              }} />
              Search across{" "}
              <strong style={{ margin: "0 2px" }}>400,000+</strong>{" "}
              trials from ClinicalTrials.gov in real time.
            </div>
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit}>

            {/* Condition — full width */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>
                Condition / Disease{" "}
                <span style={{ color: C.danger }}>*</span>
              </label>
              <input
                style={{ ...inputStyle, fontSize: 15, padding: "12px 14px" }}
                type="text"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g. Breast Cancer, Diabetes, Alzheimer…"
                required
              />
            </div>

            {/* Secondary filters — 4-col grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
              marginBottom: 18,
            }}>
              <div>
                <label style={labelStyle}>City</label>
                <input style={inputStyle} type="text" value={city}
                  onChange={(e) => setCity(e.target.value)} placeholder="e.g. Boston" />
              </div>
              <div>
                <label style={labelStyle}>State</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={state}
                  onChange={(e) => setState(e.target.value)}>
                  {US_STATES.map((s) => <option key={s} value={s}>{s || "Any State"}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Phase</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={phase}
                  onChange={(e) => setPhase(e.target.value)}>
                  {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={status}
                  onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || !condition.trim()}
              style={{
                width: "100%",
                padding: "13px 24px",
                background: loading || !condition.trim() ? C.blue : C.blue,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading || !condition.trim() ? "not-allowed" : "pointer",
                opacity: loading || !condition.trim() ? 0.55 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontFamily: "inherit",
                letterSpacing: "0.1px",
                transition: "opacity 0.15s, background 0.15s",
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 15,
                    height: 15,
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "sfSpin 0.7s linear infinite",
                  }} />
                  Searching…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  Search Trials
                </>
              )}
            </button>
          </form>

          {/* ── Quick picks ── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 20,
            flexWrap: "wrap",
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: C.hint,
              whiteSpace: "nowrap",
            }}>
              Quick
            </span>
            {/* thin divider */}
            <span style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
            {QUICK_CONDITIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleQuick(q)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: `1.5px solid ${C.border}`,
                  background: C.bg,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: C.blue,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "border-color 0.13s, background 0.13s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = C.blueFaint;
                  e.currentTarget.style.borderColor = C.blueBorder;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = C.bg;
                  e.currentTarget.style.borderColor = C.border;
                }}
              >
                {q}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Keyframe animations — minimal, scoped */}
      <style>{`
        @keyframes sfPulse {
          0%,100% { opacity:1;   transform:scale(1);    }
          50%      { opacity:0.5; transform:scale(1.45); }
        }
        @keyframes sfSpin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 700px) {
          .sf-filters-grid { grid-template-columns: repeat(2,1fr) !important; }
          .sf-header-row   { flex-direction: column !important; }
          .sf-live-badge   { white-space: normal !important; }
        }
      `}</style>
    </>
  );
}