"use client";

import { useState, FormEvent, useEffect } from "react";

/* ─── types ──────────────────────────────────────────────────────────────── */
type SearchFilters = {
  condition: string;
  city:      string;
  state:     string;
  status:    string;
  phase:     string;
};

type SearchFormProps = {
  onSearch:      (filters: SearchFilters) => void;
  loading?:      boolean;
  compact?:      boolean;
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

const US_STATES: { abbr: string; name: string }[] = [
  { abbr: "",   name: "Any State" },
  { abbr: "AL", name: "Alabama" },      { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" },      { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" },   { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" },  { abbr: "DE", name: "Delaware" },
  { abbr: "FL", name: "Florida" },      { abbr: "GA", name: "Georgia" },
  { abbr: "HI", name: "Hawaii" },       { abbr: "ID", name: "Idaho" },
  { abbr: "IL", name: "Illinois" },     { abbr: "IN", name: "Indiana" },
  { abbr: "IA", name: "Iowa" },         { abbr: "KS", name: "Kansas" },
  { abbr: "KY", name: "Kentucky" },     { abbr: "LA", name: "Louisiana" },
  { abbr: "ME", name: "Maine" },        { abbr: "MD", name: "Maryland" },
  { abbr: "MA", name: "Massachusetts" },{ abbr: "MI", name: "Michigan" },
  { abbr: "MN", name: "Minnesota" },    { abbr: "MS", name: "Mississippi" },
  { abbr: "MO", name: "Missouri" },     { abbr: "MT", name: "Montana" },
  { abbr: "NE", name: "Nebraska" },     { abbr: "NV", name: "Nevada" },
  { abbr: "NH", name: "New Hampshire" },{ abbr: "NJ", name: "New Jersey" },
  { abbr: "NM", name: "New Mexico" },   { abbr: "NY", name: "New York" },
  { abbr: "NC", name: "North Carolina" },{ abbr: "ND", name: "North Dakota" },
  { abbr: "OH", name: "Ohio" },         { abbr: "OK", name: "Oklahoma" },
  { abbr: "OR", name: "Oregon" },       { abbr: "PA", name: "Pennsylvania" },
  { abbr: "RI", name: "Rhode Island" }, { abbr: "SC", name: "South Carolina" },
  { abbr: "SD", name: "South Dakota" }, { abbr: "TN", name: "Tennessee" },
  { abbr: "TX", name: "Texas" },        { abbr: "UT", name: "Utah" },
  { abbr: "VT", name: "Vermont" },      { abbr: "VA", name: "Virginia" },
  { abbr: "WA", name: "Washington" },   { abbr: "WV", name: "West Virginia" },
  { abbr: "WI", name: "Wisconsin" },    { abbr: "WY", name: "Wyoming" },
  { abbr: "DC", name: "Washington DC" },
];

// Validation: city must be letters, spaces, hyphens, apostrophes only
const CITY_REGEX = /^[a-zA-Z\s\-'\.]{0,60}$/;
const SPIN_KEYFRAME = `@keyframes sfSpin { to { transform: rotate(360deg); } }`;

/* ─── Validation helpers ─────────────────────────────────────────────────── */
function validateCity(city: string): string | null {
  if (!city.trim()) return null; // optional field
  if (!CITY_REGEX.test(city.trim())) return "City must contain only letters, spaces, hyphens, or apostrophes.";
  if (city.trim().length < 2) return "City name must be at least 2 characters.";
  return null;
}

/* ─── shared field styles ────────────────────────────────────────────────── */
const fieldInput = (hasError?: boolean): React.CSSProperties => ({
  width:        "100%",
  padding:      "10px 13px",
  border:       `1px solid ${hasError ? "#ef4444" : "#e2e8f0"}`,
  borderRadius:  8,
  fontSize:      14,
  color:         "#0f172a",
  background:    "#ffffff",
  outline:       "none",
  fontFamily:    "inherit",
  boxSizing:     "border-box" as const,
  appearance:    "none" as const,
  transition:    "border-color 0.15s, box-shadow 0.15s",
});

const fieldLabel: React.CSSProperties = {
  display:       "flex",
  alignItems:    "center",
  gap:           5,
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: "0.7px",
  textTransform: "uppercase" as const,
  color:         "#94a3b8",
  marginBottom:  6,
};

const errorText: React.CSSProperties = {
  fontSize:   11,
  color:      "#ef4444",
  marginTop:  4,
  fontWeight: 500,
};

/* ─── component ──────────────────────────────────────────────────────────── */
export default function SearchForm({ onSearch, loading, compact, initialValues }: SearchFormProps) {
  const [condition,  setCondition]  = useState(initialValues?.condition ?? "");
  const [city,       setCity]       = useState(initialValues?.city      ?? "");
  const [state,      setState]      = useState(initialValues?.state     ?? "");
  const [status,     setStatus]     = useState(initialValues?.status    ?? "");
  const [phase,      setPhase]      = useState(initialValues?.phase     ?? "");
  const [cityError,  setCityError]  = useState<string | null>(null);
  const [condError,  setCondError]  = useState<string | null>(null);

  // Sync if URL params change (browser back/forward navigation)
  useEffect(() => {
    if (!initialValues) return;
    setCondition(initialValues.condition ?? "");
    setCity(initialValues.city           ?? "");
    setState(initialValues.state         ?? "");
    setStatus(initialValues.status       ?? "");
    setPhase(initialValues.phase         ?? "");
    setCityError(null);
    setCondError(null);
  }, [
    initialValues?.condition,
    initialValues?.city,
    initialValues?.state,
    initialValues?.status,
    initialValues?.phase,
  ]);

  const validate = (): boolean => {
    let valid = true;
    if (!condition.trim()) {
      setCondError("Condition is required.");
      valid = false;
    } else {
      setCondError(null);
    }
    const cErr = validateCity(city);
    setCityError(cErr);
    if (cErr) valid = false;
    return valid;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSearch({ condition: condition.trim(), city: city.trim(), state, status, phase });
  };

  const handleQuick = (q: string) => {
    setCondition(q);
    setCondError(null);
    const cErr = validateCity(city);
    setCityError(cErr);
    if (!cErr) {
      onSearch({ condition: q, city: city.trim(), state, status, phase });
    }
  };

  const handleCityChange = (val: string) => {
    setCity(val);
    if (cityError) setCityError(validateCity(val));
  };

  const isDisabled = loading || !condition.trim();

  /* ── COMPACT ─────────────────────────────────────────────────────────── */
  if (compact) {
    return (
      <>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');
          ${SPIN_KEYFRAME}
          .sf-compact-grid {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto;
            gap: 10px;
            align-items: flex-start;
            font-family: 'Sora', sans-serif;
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
          @media (max-width: 1000px) {
            .sf-compact-grid { grid-template-columns: repeat(3, 1fr); }
          }
          @media (max-width: 600px) {
            .sf-compact-grid { grid-template-columns: 1fr; }
          }
        `}</style>

        <form onSubmit={handleSubmit} style={{ width: "100%", fontFamily: "'Sora', sans-serif" }}>
          <div className="sf-compact-grid">

            {/* Condition */}
            <div>
              <label style={fieldLabel}>
                Condition <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>
              </label>
              <input
                style={fieldInput(!!condError)}
                type="text"
                value={condition}
                onChange={(e) => { setCondition(e.target.value); if (condError) setCondError(null); }}
                placeholder="e.g. Breast Cancer…"
              />
              {condError && <p style={errorText}>{condError}</p>}
            </div>

            {/* City */}
            <div>
              <label style={fieldLabel}>City</label>
              <input
                style={fieldInput(!!cityError)}
                type="text"
                value={city}
                onChange={(e) => handleCityChange(e.target.value)}
                placeholder="Any city"
              />
              {cityError && <p style={errorText}>{cityError}</p>}
            </div>

            {/* State */}
            <div>
              <label style={fieldLabel}>State</label>
              <select
                style={{ ...fieldInput(), cursor: "pointer" }}
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                {US_STATES.map((s) => (
                  <option key={s.abbr} value={s.abbr}>{s.abbr || "Any"}</option>
                ))}
              </select>
            </div>

            {/* Phase */}
            <div>
              <label style={fieldLabel}>Phase</label>
              <select
                style={{ ...fieldInput(), cursor: "pointer" }}
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
                style={{ ...fieldInput(), cursor: "pointer" }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingTop: 28 }}>
              <button
                type="submit"
                disabled={isDisabled}
                style={{
                  padding:      "10px 20px",
                  background:   isDisabled ? "#e2e8f0" : "#2563eb",
                  color:        isDisabled ? "#94a3b8" : "#fff",
                  border:       "none",
                  borderRadius:  8,
                  fontSize:      14,
                  fontWeight:    600,
                  cursor:        isDisabled ? "not-allowed" : "pointer",
                  whiteSpace:    "nowrap",
                  fontFamily:    "inherit",
                  display:       "flex",
                  alignItems:    "center",
                  gap:           6,
                  transition:    "all 0.15s",
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
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

  /* ── HERO ────────────────────────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,600&family=Sora:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        ${SPIN_KEYFRAME}

        .sf-hero-shell {
          width: 100%;
          min-height: 100%;
          background:
            radial-gradient(ellipse at 20% 50%, rgba(37,99,235,0.07) 0%, transparent 60%),
            radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.06) 0%, transparent 50%),
            linear-gradient(160deg, #f0f9ff 0%, #f8fafc 50%, #f0fdf4 100%);
          padding: 48px clamp(24px, 6vw, 120px);
          box-sizing: border-box;
          font-family: 'Sora', sans-serif;
        }

        .sf-hero-inner {
          max-width: 860px;
          margin: 0 auto;
        }

        .sf-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 5px 14px;
          border-radius: 20px;
          background: rgba(37,99,235,0.08);
          border: 1px solid rgba(37,99,235,0.15);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #2563eb;
          margin-bottom: 20px;
          font-family: 'IBM Plex Mono', monospace;
        }

        .sf-hero-title {
          font-family: 'Playfair Display', serif;
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 700;
          color: #0f172a;
          line-height: 1.15;
          letter-spacing: -0.5px;
          margin: 0 0 12px;
        }

        .sf-hero-title em {
          font-style: italic;
          color: #2563eb;
        }

        .sf-hero-sub {
          font-size: 15px;
          color: #64748b;
          font-weight: 400;
          margin: 0 0 36px;
          line-height: 1.6;
        }

        .sf-hero-card {
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(12px);
          border-radius: 16px;
          border: 1px solid rgba(226,232,240,0.8);
          box-shadow:
            0 1px 3px rgba(0,0,0,0.04),
            0 8px 32px rgba(37,99,235,0.06),
            0 24px 64px rgba(0,0,0,0.04);
          padding: 32px 36px 28px;
        }

        .sf-condition-wrap {
          margin-bottom: 20px;
        }

        .sf-condition-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: #94a3b8;
          display: flex;
          align-items: center;
          gap: 5px;
          margin-bottom: 8px;
        }

        .sf-condition-input {
          width: 100%;
          padding: 14px 16px;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          font-size: 16px;
          color: #0f172a;
          font-family: 'Sora', sans-serif;
          background: #fff;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .sf-condition-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 4px rgba(37,99,235,0.10);
        }
        .sf-condition-input.has-error {
          border-color: #ef4444;
        }

        .sf-filter-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 20px;
        }
        .sf-filter-field input,
        .sf-filter-field select {
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .sf-filter-field input:focus,
        .sf-filter-field select:focus {
          border-color: #60a5fa;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.10);
          outline: none;
        }

        .sf-submit-btn {
          width: 100%;
          padding: 14px 24px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: 'Sora', sans-serif;
          transition: all 0.15s;
          letter-spacing: 0.1px;
        }
        .sf-submit-btn:hover:not(:disabled) {
          background: #1d4ed8;
          box-shadow: 0 4px 16px rgba(37,99,235,0.30);
          transform: translateY(-1px);
        }
        .sf-submit-btn:disabled {
          background: #e2e8f0;
          color: #94a3b8;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .sf-quick-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 20px;
          flex-wrap: wrap;
        }
        .sf-quick-chip {
          padding: 5px 13px;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 12px;
          font-weight: 500;
          color: #2563eb;
          cursor: pointer;
          font-family: 'Sora', sans-serif;
          transition: all 0.12s;
        }
        .sf-quick-chip:hover {
          background: #eff6ff;
          border-color: #bfdbfe;
        }

        @media (max-width: 860px) {
          .sf-filter-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 560px) {
          .sf-hero-shell { padding: 24px 16px; }
          .sf-hero-card  { padding: 24px 20px; }
          .sf-filter-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="sf-hero-shell">
        <div className="sf-hero-inner">

          {/* Eyebrow */}
          <div className="sf-eyebrow">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
            ClinicalTrials.gov — Live Registry
          </div>

          {/* Title */}
          <h1 className="sf-hero-title">
            Find a <em>clinical trial</em><br />that fits your needs
          </h1>
          <p className="sf-hero-sub">
            Search 400,000+ trials across all conditions. Discover sites, locate physicians, and capture leads — all in one place.
          </p>

          {/* Card */}
          <div className="sf-hero-card">
            <form onSubmit={handleSubmit}>

              {/* Condition */}
              <div className="sf-condition-wrap">
                <label className="sf-condition-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/>
                    <circle cx="12" cy="9" r="2.5"/>
                  </svg>
                  Condition / Disease
                  <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  className={`sf-condition-input${condError ? " has-error" : ""}`}
                  type="text"
                  value={condition}
                  onChange={(e) => { setCondition(e.target.value); if (condError) setCondError(null); }}
                  placeholder="e.g. Breast Cancer, Diabetes, Alzheimer…"
                />
                {condError && <p style={errorText}>{condError}</p>}
              </div>

              {/* Filters */}
              <div className="sf-filter-grid">
                <div className="sf-filter-field">
                  <label style={fieldLabel}>City</label>
                  <input
                    style={fieldInput(!!cityError)}
                    type="text"
                    value={city}
                    onChange={(e) => handleCityChange(e.target.value)}
                    placeholder="e.g. Boston"
                  />
                  {cityError && <p style={errorText}>{cityError}</p>}
                </div>
                <div className="sf-filter-field">
                  <label style={fieldLabel}>State</label>
                  <select
                    style={{ ...fieldInput(), cursor: "pointer" }}
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  >
                    {US_STATES.map((s) => (
                      <option key={s.abbr} value={s.abbr}>{s.abbr || "Any State"}</option>
                    ))}
                  </select>
                </div>
                <div className="sf-filter-field">
                  <label style={fieldLabel}>Phase</label>
                  <select
                    style={{ ...fieldInput(), cursor: "pointer" }}
                    value={phase}
                    onChange={(e) => setPhase(e.target.value)}
                  >
                    {PHASES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sf-filter-field">
                  <label style={fieldLabel}>Status</label>
                  <select
                    style={{ ...fieldInput(), cursor: "pointer" }}
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
              <button type="submit" className="sf-submit-btn" disabled={isDisabled}>
                {loading ? (
                  <>
                    <span style={{
                      width: 16, height: 16,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "sfSpin 0.7s linear infinite",
                    }} />
                    Searching trials…
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                    Search Trials
                  </>
                )}
              </button>
            </form>

            {/* Quick picks */}
            <div className="sf-quick-row">
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.8px",
                textTransform: "uppercase", color: "#cbd5e1", whiteSpace: "nowrap",
                fontFamily: "'IBM Plex Mono', monospace",
              }}>
                Quick
              </span>
              <span style={{ width: 1, height: 14, background: "#e2e8f0", flexShrink: 0 }} />
              {QUICK_CONDITIONS.map((q) => (
                <button key={q} type="button" className="sf-quick-chip" onClick={() => handleQuick(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}