"use client";

import { useState, FormEvent, useEffect } from "react";

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
  initialValues?: SearchFilters;
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
  card:        "#ffffff",
  cardBorder:  "#e2e8f0",
  accent:      "#0d9488",
  text:        "#0f172a",
  muted:       "#64748b",
  hint:        "#94a3b8",
  eyebrow:     "#0d9488",
  inputBg:     "#ffffff",
  inputBorder: "#e2e8f0",
  blue:        "#2563eb",
  chipBorder:  "#e2e8f0",
  chipBg:      "#f8fafc",
  chipText:    "#2563eb",
  chipBgHov:   "#eff6ff",
  chipBrHov:   "#bfdbfe",
  danger:      "#ef4444",
};

/* ─── shared field styles ────────────────────────────────────────────────── */
const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "10px 13px",
  border: `1px solid ${T.inputBorder}`,
  borderRadius: 8,
  fontSize: 14,
  color: T.text,
  background: T.inputBg,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  appearance: "none",
};

const fieldLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.7px",
  textTransform: "uppercase",
  color: T.hint,
  marginBottom: 6,
};

/* ─── component ──────────────────────────────────────────────────────────── */
export default function SearchForm({ onSearch, loading, compact, initialValues }: SearchFormProps) {
  // Always initialize from initialValues so compact bar is pre-filled on first render
  const [condition, setCondition] = useState(initialValues?.condition ?? "");
  const [city,      setCity]      = useState(initialValues?.city      ?? "");
  const [state,     setState]     = useState(initialValues?.state     ?? "");
  const [status,    setStatus]    = useState(initialValues?.status    ?? "");
  const [phase,     setPhase]     = useState(initialValues?.phase     ?? "");

  // Sync if URL params change (browser back/forward navigation)
  useEffect(() => {
    if (!initialValues) return;
    setCondition(initialValues.condition ?? "");
    setCity(initialValues.city           ?? "");
    setState(initialValues.state         ?? "");
    setStatus(initialValues.status       ?? "");
    setPhase(initialValues.phase         ?? "");
  }, [
    initialValues?.condition,
    initialValues?.city,
    initialValues?.state,
    initialValues?.status,
    initialValues?.phase,
  ]);

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

  /* ── COMPACT (shown above results — pre-filled + fully editable) ─────── */
  if (compact) {
    return (
      <>
        <style>{`
          .sf-compact-grid {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto;
            gap: 12px;
            align-items: flex-end;
          }
          .sf-compact-grid input,
          .sf-compact-grid select {
            transition: border-color 0.15s, box-shadow 0.15s;
          }
          .sf-compact-grid input:focus,
          .sf-compact-grid select:focus {
            border-color: #60a5fa !important;
            box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
            outline: none;
          }
          @media (max-width: 900px) {
            .sf-compact-grid { grid-template-columns: repeat(3, 1fr); }
          }
          @media (max-width: 560px) {
            .sf-compact-grid { grid-template-columns: 1fr; }
          }
        `}</style>

        <form onSubmit={handleSubmit} style={{ width: "100%", fontFamily: "inherit" }}>
          <div className="sf-compact-grid">

            {/* Condition */}
            <div>
              <label style={fieldLabel}>
                Condition <span style={{ color: T.danger, marginLeft: 2 }}>*</span>
              </label>
              <input
                style={fieldInput}
                type="text"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g. Breast Cancer…"
                required
              />
            </div>

            {/* City */}
            <div>
              <label style={fieldLabel}>City</label>
              <input
                style={fieldInput}
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Any city"
              />
            </div>

            {/* State */}
            <div>
              <label style={fieldLabel}>State</label>
              <select
                style={{ ...fieldInput, cursor: "pointer" }}
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s || "Any"}</option>
                ))}
              </select>
            </div>

            {/* Phase */}
            <div>
              <label style={fieldLabel}>Phase</label>
              <select
                style={{ ...fieldInput, cursor: "pointer" }}
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
              >
                {PHASES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label style={fieldLabel}>Status</label>
              <select
                style={{ ...fieldInput, cursor: "pointer" }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={isDisabled}
                style={{
                  padding: "10px 20px",
                  background: T.blue,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  opacity: isDisabled ? 0.55 : 1,
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "opacity 0.15s, box-shadow 0.15s",
                }}
              >
                {loading ? (
                  <>
                    <span style={{
                      width: 13, height: 13,
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
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                    Search
                  </>
                )}
              </button>
            </div>

          </div>
        </form>
      </>
    );
  }

  /* ── HERO (initial landing — no results yet) ─────────────────────────── */
  return (
    <>
      <style>{`
        .sf-shell {
          width: 100%;
          min-height: 100%;
          background: linear-gradient(135deg, #dff3f8 0%, #eaf6f8 40%, #f0f7fa 70%, #f8fafc 100%);
          padding: 36px clamp(24px, 5vw, 108px);
          box-sizing: border-box;
          font-family: inherit;
        }
        .sf-card {
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid ${T.cardBorder};
          border-left: 5px solid ${T.accent};
          box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04);
          padding: 36px 40px 32px;
          position: relative;
        }
        .sf-header { margin-bottom: 32px; }
        .sf-filters {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 20px;
        }
        .sf-quick-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 22px;
          flex-wrap: wrap;
        }
        @media (max-width: 820px) {
          .sf-filters { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 560px) {
          .sf-shell   { padding: 20px 16px; }
          .sf-card    { padding: 24px 20px; border-left-width: 4px; }
          .sf-filters { grid-template-columns: 1fr; }
        }
        @keyframes sfSpin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="sf-shell">
        <div className="sf-card">

          {/* ── Header ── */}
          <div className="sf-header">
            <p style={{
              margin: "0 0 10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: T.eyebrow,
            }}>
              Clinical Trials · ClinicalTrials.gov
            </p>
            <h1 style={{
              margin: "0 0 8px",
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 700,
              color: T.text,
              lineHeight: 1.2,
              letterSpacing: "-0.5px",
            }}>
              Find a{" "}
              <span style={{ color: T.accent, fontStyle: "italic", fontWeight: 600 }}>
                clinical trial
              </span>{" "}
              near you
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: T.muted, fontWeight: 400 }}>
              Search 400,000+ trials across all conditions using the official ClinicalTrials.gov registry.
            </p>
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit}>

            {/* Condition */}
            <div style={{ marginBottom: 20 }}>
              <label style={fieldLabel}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  stroke={T.hint} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
                Condition / Disease
                <span style={{ color: T.danger, marginLeft: 2 }}>*</span>
              </label>
              <input
                style={{ ...fieldInput, fontSize: 15, padding: "12px 14px" }}
                type="text"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g. Breast Cancer, Diabetes, Alzheimer…"
                required
              />
              <p style={{ margin: "5px 0 0", fontSize: 11.5, color: T.hint, fontStyle: "italic" }}>
                Enter a condition, disease, or keyword to search trials
              </p>
            </div>

            {/* City · State · Phase · Status */}
            <div className="sf-filters">
              <div>
                <label style={fieldLabel}>City</label>
                <input
                  style={fieldInput}
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Boston"
                />
              </div>
              <div>
                <label style={fieldLabel}>State</label>
                <select
                  style={{ ...fieldInput, cursor: "pointer" }}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s || "Any State"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Phase</label>
                <select
                  style={{ ...fieldInput, cursor: "pointer" }}
                  value={phase}
                  onChange={(e) => setPhase(e.target.value)}
                >
                  {PHASES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Status</label>
                <select
                  style={{ ...fieldInput, cursor: "pointer" }}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
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
                borderRadius: 8,
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
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  Search Trials
                </>
              )}
            </button>
          </form>

          {/* ── Quick picks ── */}
          <div className="sf-quick-row">
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.6px",
              textTransform: "uppercase",
              color: T.hint,
              whiteSpace: "nowrap",
            }}>
              Quick
            </span>
            <span style={{ width: 1, height: 14, background: T.cardBorder, flexShrink: 0 }} />
            {QUICK_CONDITIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleQuick(q)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background  = T.chipBgHov;
                  e.currentTarget.style.borderColor = T.chipBrHov;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background  = T.chipBg;
                  e.currentTarget.style.borderColor = T.chipBorder;
                }}
                style={{
                  padding: "4px 12px",
                  borderRadius: 20,
                  border: `1.5px solid ${T.chipBorder}`,
                  background: T.chipBg,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: T.chipText,
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