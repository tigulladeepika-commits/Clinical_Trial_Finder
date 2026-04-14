"use client";

import { useState, FormEvent } from "react";

/* ─── types ──────────────────────────────────────────────────────────────── */
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

/* ─── constants ──────────────────────────────────────────────────────────── */
const PHASES = [
  { label: "Any Phase",     value: "" },
  { label: "Early Phase 1", value: "early phase 1" },
  { label: "Phase 1",       value: "phase1" },
  { label: "Phase 2",       value: "phase2" },
  { label: "Phase 3",       value: "phase3" },
  { label: "Phase 4",       value: "phase4" },
];

const STATUSES = [
  { label: "Any Status",              value: "" },
  { label: "Recruiting",              value: "recruiting" },
  { label: "Not Yet Recruiting",      value: "not yet recruiting" },
  { label: "Active (not recruiting)", value: "active, not recruiting" },
  { label: "Completed",               value: "completed" },
  { label: "Terminated",              value: "terminated" },
];

const QUICK_CONDITIONS = [
  "Breast Cancer", "Lung Cancer", "Diabetes", "Alzheimer",
  "Heart Failure", "Depression", "COPD", "Leukemia", "COVID", "Stroke",
];

const US_STATES = [
  "", "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY","DC",
];

/* ─── design tokens ──────────────────────────────────────────────────────── */
const T = {
  bg:          "#f8fafc",
  card:        "#ffffff",
  border:      "#e8edf3",
  text:        "#0f172a",
  muted:       "#64748b",
  hint:        "#94a3b8",
  blue:        "#2563eb",
  blueFaint:   "#eff6ff",
  blueBorder:  "#bfdbfe",
  green:       "#22c55e",
  greenText:   "#166534",
  greenFaint:  "#f0fdf4",
  greenBorder: "#bbf7d0",
  danger:      "#ef4444",
};

/* ─── shared styles ──────────────────────────────────────────────────────── */
const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 13px",
  border: `1.5px solid ${T.border}`,
  borderRadius: 10,
  fontSize: 14,
  color: T.text,
  background: T.bg,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.55px",
  textTransform: "uppercase",
  color: T.hint,
  marginBottom: 6,
};

/* ─── component ──────────────────────────────────────────────────────────── */
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

  const isDisabled = loading || !condition.trim();

  /* ── COMPACT ─────────────────────────────────────────────────────────── */
  if (compact) {
    return (
      <form onSubmit={handleSubmit} style={{ width: "100%", fontFamily: "inherit" }}>
        <div className="sf-compact-grid">
          <div>
            <label style={label}>Condition <span style={{ color: T.danger }}>*</span></label>
            <input style={input} type="text" value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. Breast Cancer…" required />
          </div>
          <div>
            <label style={label}>City</label>
            <input style={input} type="text" value={city}
              onChange={(e) => setCity(e.target.value)} placeholder="Boston" />
          </div>
          <div>
            <label style={label}>State</label>
            <select style={{ ...input, cursor: "pointer" }} value={state}
              onChange={(e) => setState(e.target.value)}>
              {US_STATES.map((s) => <option key={s} value={s}>{s || "Any"}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Phase</label>
            <select style={{ ...input, cursor: "pointer" }} value={phase}
              onChange={(e) => setPhase(e.target.value)}>
              {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Status</label>
            <select style={{ ...input, cursor: "pointer" }} value={status}
              onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <button type="submit" disabled={isDisabled} style={{
              padding: "10px 20px",
              background: T.blue,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: isDisabled ? "not-allowed" : "pointer",
              opacity: isDisabled ? 0.55 : 1,
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        <style>{`
          .sf-compact-grid {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto;
            gap: 12px;
            align-items: flex-end;
          }
          @media (max-width: 900px) {
            .sf-compact-grid { grid-template-columns: repeat(3, 1fr); }
          }
          @media (max-width: 560px) {
            .sf-compact-grid { grid-template-columns: 1fr; }
          }
        `}</style>
      </form>
    );
  }

  /* ── HERO ────────────────────────────────────────────────────────────── */
  return (
    <>
      {/* Scoped styles — clamp + media queries can't live in inline styles */}
      <style>{`
        .sf-shell {
          width: 100%;
          background: ${T.bg};
          padding: 28px clamp(24px, 5vw, 108px);
          box-sizing: border-box;
          font-family: inherit;
        }
        .sf-card {
          background: ${T.card};
          border-radius: 16px;
          border: 1px solid ${T.border};
          box-shadow: 0 2px 16px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.03);
          padding: 32px 36px 28px;
        }
        .sf-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 28px;
          flex-wrap: wrap;
        }
        .sf-filters {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 18px;
        }
        .sf-quick-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 20px;
          flex-wrap: wrap;
        }
        /* responsive */
        @media (max-width: 800px) {
          .sf-filters { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 560px) {
          .sf-filters  { grid-template-columns: 1fr; }
          .sf-header   { flex-direction: column; }
          .sf-card     { padding: 24px 20px; }
          .sf-live-badge { white-space: normal !important; }
        }
        @keyframes sfPulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%       { opacity: 0.5; transform: scale(1.45); }
        }
        @keyframes sfSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="sf-shell">
        <div className="sf-card">

          {/* ── Header: title left, badge right ── */}
          <div className="sf-header">
            <div>
              <h1 style={{
                margin: 0,
                fontSize: "clamp(20px, 2.2vw, 24px)",
                fontWeight: 700,
                color: T.text,
                letterSpacing: "-0.4px",
                lineHeight: 1.2,
              }}>
                Clinical Trial Finder
              </h1>
              <p style={{ margin: "5px 0 0", fontSize: 13, color: T.muted }}>
                Find trials by condition, location, phase, or status.
              </p>
            </div>

            {/* Live data badge — inside the card, top-right */}
            <div className="sf-live-badge" style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              color: T.greenText,
              background: T.greenFaint,
              border: `1px solid ${T.greenBorder}`,
              borderRadius: 20,
              padding: "5px 13px",
              flexShrink: 0,
              alignSelf: "flex-start",
              whiteSpace: "nowrap",
            }}>
              <span style={{
                width: 7, height: 7,
                borderRadius: "50%",
                background: T.green,
                flexShrink: 0,
                display: "inline-block",
                animation: "sfPulse 2s ease-in-out infinite",
              }} />
              Search across <strong style={{ margin: "0 3px" }}>400,000+</strong> trials · ClinicalTrials.gov
            </div>
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit}>

            {/* Condition — full width */}
            <div style={{ marginBottom: 18 }}>
              <label style={label}>
                Condition / Disease <span style={{ color: T.danger }}>*</span>
              </label>
              <input
                style={{ ...input, fontSize: 15, padding: "12px 14px" }}
                type="text"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g. Breast Cancer, Diabetes, Alzheimer…"
                required
              />
            </div>

            {/* City · State · Phase · Status */}
            <div className="sf-filters">
              <div>
                <label style={label}>City</label>
                <input style={input} type="text" value={city}
                  onChange={(e) => setCity(e.target.value)} placeholder="e.g. Boston" />
              </div>
              <div>
                <label style={label}>State</label>
                <select style={{ ...input, cursor: "pointer" }} value={state}
                  onChange={(e) => setState(e.target.value)}>
                  {US_STATES.map((s) => <option key={s} value={s}>{s || "Any State"}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Phase</label>
                <select style={{ ...input, cursor: "pointer" }} value={phase}
                  onChange={(e) => setPhase(e.target.value)}>
                  {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Status</label>
                <select style={{ ...input, cursor: "pointer" }} value={status}
                  onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isDisabled}
              style={{
                width: "100%",
                padding: "13px 24px",
                background: T.blue,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.55 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontFamily: "inherit",
                letterSpacing: "0.1px",
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 15, height: 15,
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
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  Search Trials
                </>
              )}
            </button>
          </form>

          {/* ── Quick picks ── */}
          <div className="sf-quick-row">
            <span style={{
              fontSize: 11, fontWeight: 600,
              letterSpacing: "0.5px", textTransform: "uppercase",
              color: T.hint, whiteSpace: "nowrap",
            }}>
              Quick
            </span>
            <span style={{ width: 1, height: 14, background: T.border, flexShrink: 0 }} />
            {QUICK_CONDITIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleQuick(q)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = T.blueFaint;
                  e.currentTarget.style.borderColor = T.blueBorder;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = T.bg;
                  e.currentTarget.style.borderColor = T.border;
                }}
                style={{
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: `1.5px solid ${T.border}`,
                  background: T.bg,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: T.blue,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {q}
              </button>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}