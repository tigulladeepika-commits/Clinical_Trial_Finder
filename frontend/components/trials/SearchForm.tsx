"use client";

import { useState, useCallback, useEffect } from "react";
import type { TrialSearchFilters }           from "@/types/trial";
import { validateCityStateAsync, formatValidationError } from "@/lib/validation";

const STATUSES = [
  "",
  "Recruiting",
  "Active, not recruiting",
  "Not yet recruiting",
  "Enrolling by invitation",
  "Completed",
  "Terminated",
  "Suspended",
  "Withdrawn",
] as const;

const PHASES = ["", "Phase 1", "Phase 2", "Phase 3", "Phase 4", "N/A"] as const;

const US_STATES = [
  { code: "",   label: "State" },
  { code: "AL", label: "Alabama" },       { code: "AK", label: "Alaska" },
  { code: "AZ", label: "Arizona" },       { code: "AR", label: "Arkansas" },
  { code: "CA", label: "California" },    { code: "CO", label: "Colorado" },
  { code: "CT", label: "Connecticut" },   { code: "DE", label: "Delaware" },
  { code: "FL", label: "Florida" },       { code: "GA", label: "Georgia" },
  { code: "HI", label: "Hawaii" },        { code: "ID", label: "Idaho" },
  { code: "IL", label: "Illinois" },      { code: "IN", label: "Indiana" },
  { code: "IA", label: "Iowa" },          { code: "KS", label: "Kansas" },
  { code: "KY", label: "Kentucky" },      { code: "LA", label: "Louisiana" },
  { code: "ME", label: "Maine" },         { code: "MD", label: "Maryland" },
  { code: "MA", label: "Massachusetts" }, { code: "MI", label: "Michigan" },
  { code: "MN", label: "Minnesota" },     { code: "MS", label: "Mississippi" },
  { code: "MO", label: "Missouri" },      { code: "MT", label: "Montana" },
  { code: "NE", label: "Nebraska" },      { code: "NV", label: "Nevada" },
  { code: "NH", label: "New Hampshire" }, { code: "NJ", label: "New Jersey" },
  { code: "NM", label: "New Mexico" },    { code: "NY", label: "New York" },
  { code: "NC", label: "North Carolina" },{ code: "ND", label: "North Dakota" },
  { code: "OH", label: "Ohio" },          { code: "OK", label: "Oklahoma" },
  { code: "OR", label: "Oregon" },        { code: "PA", label: "Pennsylvania" },
  { code: "RI", label: "Rhode Island" },  { code: "SC", label: "South Carolina" },
  { code: "SD", label: "South Dakota" },  { code: "TN", label: "Tennessee" },
  { code: "TX", label: "Texas" },         { code: "UT", label: "Utah" },
  { code: "VT", label: "Vermont" },       { code: "VA", label: "Virginia" },
  { code: "WA", label: "Washington" },    { code: "WV", label: "West Virginia" },
  { code: "WI", label: "Wisconsin" },     { code: "WY", label: "Wyoming" },
];

interface Props {
  onSearch:      (filters: TrialSearchFilters) => void;
  loading?:      boolean;
  compact?:      boolean;
  initialValues: TrialSearchFilters;
}

export default function SearchForm({ onSearch, loading = false, compact = false, initialValues }: Props) {
  const [condition, setCondition] = useState(initialValues.condition);
  const [city,      setCity]      = useState(initialValues.city);
  const [state,     setState_]    = useState(initialValues.state);
  const [status,    setStatus]    = useState(initialValues.status);
  const [phase,     setPhase]     = useState(initialValues.phase);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setCondition(initialValues.condition);
    setCity(initialValues.city);
    setState_(initialValues.state);
    setStatus(initialValues.status);
    setPhase(initialValues.phase);
  }, [initialValues.condition, initialValues.city, initialValues.state, initialValues.status, initialValues.phase]);

  const handleSubmit = useCallback(async () => {
    if (!condition.trim()) return;
    const validation = await validateCityStateAsync(city, state);
    if (!validation.isValid) {
      setValidationError(validation.error || "Invalid city/state combination");
      setTimeout(() => setValidationError(null), 5000);
      return;
    }
    setValidationError(null);
    onSearch({ condition, city, state, status, phase });
  }, [condition, city, state, status, phase, onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSubmit(); },
    [handleSubmit],
  );

  const btnDisabled = loading || !condition.trim();

  // ── COMPACT ──────────────────────────────────────────────────────────────────
  if (compact) {
    return (
      <>
        <style>{`
          .sf-compact {
            display: flex; gap: 8px; align-items: center;
            width: 100%; flex-wrap: nowrap; min-width: 0;
          }
          .sf-compact-input {
            height: 38px; padding: 0 14px;
            border: 1px solid var(--border); border-radius: var(--radius-md);
            font-size: 13px; color: var(--ink); background: var(--surface);
            outline: none; font-family: var(--font-sans);
            transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
            min-width: 0;
          }
          .sf-compact-input:focus {
            border-color: var(--green-500);
            box-shadow: 0 0 0 3px rgba(16,185,129,0.12);
            background: #fff;
          }
          .sf-compact-input::placeholder { color: var(--muted-light); }
          .sf-compact-select {
            height: 38px; padding: 0 8px;
            border: 1px solid var(--border); border-radius: var(--radius-md);
            font-size: 13px; color: var(--ink); background: var(--surface);
            outline: none; cursor: pointer; font-family: var(--font-sans);
            transition: border-color 0.15s;
          }
          .sf-compact-select:focus { border-color: var(--green-500); }
          .sf-compact-btn {
            height: 38px; padding: 0 18px;
            display: flex; align-items: center; gap: 7px;
            border: none; border-radius: var(--radius-md);
            font-size: 13px; font-weight: 600; color: #fff;
            cursor: pointer; font-family: var(--font-sans);
            white-space: nowrap; flex-shrink: 0;
            transition: all 0.16s cubic-bezier(.22,1,.36,1);
          }
          .sf-compact-btn:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(6,95,70,0.35);
          }
          .sf-compact-btn:disabled { cursor: not-allowed; }
        `}</style>
        <div className="sf-compact">
          <input
            className="sf-compact-input"
            style={{ flex: "2 1 0", minWidth: 120 }}
            placeholder="Condition or keyword"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Condition"
          />
          <input
            className="sf-compact-input"
            style={{ flex: "1 1 0", minWidth: 80 }}
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="City"
          />
          <select
            className="sf-compact-select"
            style={{ flex: "1 1 0", minWidth: 110 }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s || "Any Status"}</option>)}
          </select>
          <button
            onClick={handleSubmit}
            disabled={btnDisabled}
            className="sf-compact-btn"
            style={{ background: btnDisabled ? "var(--muted-light)" : "var(--forest-mid)" }}
          >
            {loading ? (
              <span style={{
                width: 14, height: 14, border: "2px solid rgba(255,255,255,0.35)",
                borderTopColor: "#fff", borderRadius: "50%",
                animation: "spinAnim 0.7s linear infinite", flexShrink: 0,
              }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            )}
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </>
    );
  }

  // ── HERO ──────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .sf-hero-card {
          background: #fff;
          border-radius: 20px;
          border: 1px solid rgba(6,95,70,0.12);
          padding: 32px 36px 28px;
          box-shadow: 0 8px 40px rgba(6,78,59,0.12), 0 2px 8px rgba(6,78,59,0.06);
        }
        .sf-hero-eyebrow {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 16px;
        }
        .sf-hero-eyebrow-tag {
          font-size: 10px; font-weight: 700; color: var(--forest-mid);
          text-transform: uppercase; letter-spacing: 1px;
          background: var(--green-50); padding: 3px 10px;
          border-radius: 20px; border: 1px solid var(--green-100);
        }
        .sf-hero-title {
          font-size: 30px; font-weight: 700; color: var(--ink);
          line-height: 1.2; margin-bottom: 24px; letter-spacing: -0.5px;
        }
        .sf-hero-title em { color: var(--forest-mid); font-style: italic; }
        .sf-label {
          font-size: 10px; font-weight: 700; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.7px;
          margin-bottom: 7px; display: block;
        }
        .sf-hero-input {
          height: 50px; padding: 0 18px;
          border: 1.5px solid var(--border); border-radius: var(--radius-lg);
          font-size: 15px; color: var(--ink); background: var(--surface);
          outline: none; font-family: var(--font-sans); width: 100%;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .sf-hero-input:focus {
          border-color: var(--green-500);
          box-shadow: 0 0 0 4px rgba(16,185,129,0.12);
          background: #fff;
        }
        .sf-hero-input::placeholder { color: var(--muted-light); }
        .sf-hero-select {
          height: 44px; padding: 0 14px;
          border: 1.5px solid var(--border); border-radius: var(--radius-lg);
          font-size: 13px; color: var(--ink); background: var(--surface);
          outline: none; cursor: pointer; font-family: var(--font-sans); width: 100%;
          transition: border-color 0.15s;
        }
        .sf-hero-select:focus { border-color: var(--green-500); }
        .sf-hero-btn {
          width: 100%; height: 54px;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          background: var(--forest-mid); color: #fff;
          border: none; border-radius: var(--radius-lg);
          font-size: 16px; font-weight: 700; cursor: pointer;
          font-family: var(--font-sans);
          transition: all 0.18s cubic-bezier(.22,1,.36,1);
          letter-spacing: 0.2px;
          box-shadow: 0 4px 16px rgba(6,95,70,0.35);
        }
        .sf-hero-btn:hover:not(:disabled) {
          background: var(--forest);
          box-shadow: 0 8px 28px rgba(6,95,70,0.45);
          transform: translateY(-2px);
        }
        .sf-hero-btn:disabled {
          background: var(--muted-light); cursor: not-allowed;
          box-shadow: none; transform: none;
        }
        .sf-hint {
          font-size: 11px; color: var(--muted-light);
          margin-top: 5px; font-style: italic;
        }
        /* Error popup */
        .sf-error-popup {
          position: fixed; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          z-index: 9999; padding: 28px 36px;
          background: #fff; border: 2px solid var(--coral-600);
          border-radius: var(--radius-xl);
          box-shadow: 0 24px 60px rgba(0,0,0,0.22);
          display: flex; flex-direction: column;
          align-items: center; gap: 14px;
          max-width: 420px; text-align: center;
          animation: fadeUp 0.2s ease both;
        }
        .sf-error-popup-icon { font-size: 36px; }
        .sf-error-popup-title { font-size: 17px; font-weight: 700; color: var(--ink); }
        .sf-error-popup-msg { font-size: 13px; color: var(--muted); line-height: 1.6; }
        .sf-error-popup-btn {
          padding: 9px 28px; background: var(--coral-600); color: #fff;
          border: none; border-radius: var(--radius-md);
          font-size: 14px; font-weight: 600; cursor: pointer;
          font-family: var(--font-sans); margin-top: 4px;
          transition: background 0.15s;
        }
        .sf-error-popup-btn:hover { background: #b91c1c; }
      `}</style>

      {/* Validation error popup */}
      {validationError && (
        <div className="sf-error-popup">
          <div className="sf-error-popup-icon">⚠️</div>
          <div className="sf-error-popup-title">Invalid City / State</div>
          <div className="sf-error-popup-msg">{validationError}</div>
          <button className="sf-error-popup-btn" onClick={() => setValidationError(null)}>
            OK, I'll fix it
          </button>
        </div>
      )}

      <div className="sf-hero-card">
        {/* Eyebrow */}
        <div className="sf-hero-eyebrow">
          <span className="sf-hero-eyebrow-tag">ClinicalTrials.gov</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600, color: "var(--green-600)",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--green-500)", display: "inline-block",
            }} />
            Live database
          </span>
        </div>

        {/* Title */}
        <h2 className="sf-hero-title">
          Find a <em>clinical trial</em> near you
        </h2>

        {/* Condition */}
        <div style={{ marginBottom: 16 }}>
          <label className="sf-label">
            Condition / Disease
            <span style={{ color: "var(--coral-600)", marginLeft: 3 }}>*</span>
          </label>
          <input
            className="sf-hero-input"
            placeholder="e.g. Breast Cancer, Type 2 Diabetes, Alzheimer's…"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {!condition.trim() && (
            <div className="sf-hint">Required — enter a condition or keyword to search</div>
          )}
        </div>

        {/* Filters row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
          <div>
            <label className="sf-label">City</label>
            <input
              className="sf-hero-input"
              style={{ height: 44, fontSize: 13 }}
              placeholder="e.g. Boston"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <label className="sf-label">State</label>
            <select className="sf-hero-select" value={state} onChange={(e) => setState_(e.target.value)}>
              {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="sf-label">Phase</label>
            <select className="sf-hero-select" value={phase} onChange={(e) => setPhase(e.target.value)}>
              {PHASES.map((p) => <option key={p} value={p}>{p || "Any Phase"}</option>)}
            </select>
          </div>
          <div>
            <label className="sf-label">Status</label>
            <select className="sf-hero-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || "Any Status"}</option>)}
            </select>
          </div>
        </div>

        {/* Submit */}
        <button
          className="sf-hero-btn"
          onClick={handleSubmit}
          disabled={btnDisabled}
        >
          {loading ? (
            <>
              <span style={{
                width: 18, height: 18,
                border: "2.5px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff", borderRadius: "50%",
                animation: "spinAnim 0.7s linear infinite",
              }} />
              Searching…
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Search Trials
            </>
          )}
        </button>
      </div>
    </>
  );
}