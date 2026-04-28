// components/trials/SearchForm.tsx
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
  { code: "AL", label: "Alabama(AL)" },       { code: "AK", label: "Alaska(AK)" },
  { code: "AZ", label: "Arizona(AZ)" },       { code: "AR", label: "Arkansas(AR)" },
  { code: "CA", label: "California(CA)" },    { code: "CO", label: "Colorado(CO)" },
  { code: "CT", label: "Connecticut(CT)" },   { code: "DE", label: "Delaware(DE)" },
  { code: "FL", label: "Florida(FL)" },       { code: "GA", label: "Georgia(GA)" },
  { code: "HI", label: "Hawaii(HI)" },        { code: "ID", label: "Idaho(ID)" },
  { code: "IL", label: "Illinois(IL)" },      { code: "IN", label: "Indiana(IN)" },
  { code: "IA", label: "Iowa(IA)" },          { code: "KS", label: "Kansas(KS)" },
  { code: "KY", label: "Kentucky(KY)" },      { code: "LA", label: "Louisiana(LA)" },
  { code: "ME", label: "Maine(ME)" },         { code: "MD", label: "Maryland(MD)" },
  { code: "MA", label: "Massachusetts(MA)" }, { code: "MI", label: "Michigan(MI)" },
  { code: "MN", label: "Minnesota(MN)" },     { code: "MS", label: "Mississippi(MS)" },
  { code: "MO", label: "Missouri(MO)" },      { code: "MT", label: "Montana(MT)" },
  { code: "NE", label: "Nebraska(NE)" },      { code: "NV", label: "Nevada(NV)" },
  { code: "NH", label: "New Hampshire(NH)" }, { code: "NJ", label: "New Jersey(NJ)" },
  { code: "NM", label: "New Mexico(NM)" },    { code: "NY", label: "New York(NY)" },
  { code: "NC", label: "North Carolina(NC)" }, { code: "ND", label: "North Dakota(ND)" },
  { code: "OH", label: "Ohio(OH)" },          { code: "OK", label: "Oklahoma(OK)" },
  { code: "OR", label: "Oregon(OR)" },        { code: "PA", label: "Pennsylvania(PA)" },
  { code: "RI", label: "Rhode Island(RI)" },  { code: "SC", label: "South Carolina(SC)" },
  { code: "SD", label: "South Dakota(SD)" },  { code: "TN", label: "Tennessee(TN)" },
  { code: "TX", label: "Texas(TX)" },         { code: "UT", label: "Utah(UT)" },
  { code: "VT", label: "Vermont(VT)" },       { code: "VA", label: "Virginia(VA)" },
  { code: "WA", label: "Washington(WA)" },    { code: "WV", label: "West Virginia(WV)" },
  { code: "WI", label: "Wisconsin(WI)" },     { code: "WY", label: "Wyoming(WY)" },
];

interface Props {
  onSearch:      (filters: TrialSearchFilters) => void;
  loading?:      boolean;
  compact?:      boolean;
  initialValues: TrialSearchFilters;
}

export default function SearchForm({
  onSearch,
  loading = false,
  compact = false,
  initialValues,
}: Props) {
  const [condition, setCondition] = useState(initialValues.condition);
  const [city,      setCity]      = useState(initialValues.city);
  const [state,     setState_]    = useState(initialValues.state);
  const [status,    setStatus]    = useState(initialValues.status);
  const [phase,     setPhase]     = useState(initialValues.phase);
  
  // CRITICAL FIX: Add validation error state for city/state combo
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setCondition(initialValues.condition);
    setCity(initialValues.city);
    setState_(initialValues.state);
    setStatus(initialValues.status);
    setPhase(initialValues.phase);
  }, [
    initialValues.condition,
    initialValues.city,
    initialValues.state,
    initialValues.status,
    initialValues.phase,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!condition.trim()) return;
    
    // CRITICAL FIX: Validate city/state combination before searching
    // Use async validation that falls back to backend if local data is stale
    const validation = await validateCityStateAsync(city, state);
    if (!validation.isValid) {
      setValidationError(validation.error || "Invalid city/state combination");
      // Show error for 5 seconds
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

  const SearchIcon = () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );

  // ── COMPACT ─────────────────────────────────────────────────────────────────
  if (compact) {
    const field: React.CSSProperties = {
      height: 36, padding: "0 12px",
      border: "1px solid #e4e8f0", borderRadius: 8,
      fontSize: 13, color: "#0d1117", background: "#f6f7fb",
      outline: "none", fontFamily: "inherit", width: "100%",
      transition: "border-color 0.15s", boxSizing: "border-box",
    };
    const select: React.CSSProperties = {
      ...field, cursor: "pointer", paddingRight: 8,
      appearance: "none" as React.CSSProperties["appearance"],
    };
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", flexWrap: "nowrap", minWidth: 0 }}>
        <input
          style={{ ...field, flex: "2 1 0", minWidth: 140 }}
          placeholder="Condition or keyword"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Condition"
        />
        <input
          style={{ ...field, flex: "1 1 0", minWidth: 80 }}
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="City"
        />
        <select
          style={{ ...select, flex: "1 1 0", minWidth: 110 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s || "Any Status"}</option>)}
        </select>
        <button
          onClick={handleSubmit}
          disabled={btnDisabled}
          style={{
            height: 36, padding: "0 18px",
            background: btnDisabled ? "#cdd3e0" : "#2563eb",
            color: "#fff", border: "none", borderRadius: 8,
            fontSize: 13, fontWeight: 600,
            cursor: btnDisabled ? "not-allowed" : "pointer",
            whiteSpace: "nowrap", fontFamily: "inherit",
            transition: "background 0.15s", flexShrink: 0,
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <SearchIcon />
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
    );
  }

  // ── HERO (full form) ────────────────────────────────────────────────────────
  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: "0.6px",
    marginBottom: 6, display: "block",
  };

  const heroField: React.CSSProperties = {
    height: 48, padding: "0 16px",
    border: "1.5px solid #e4e8f0", borderRadius: 10,
    fontSize: 15, color: "#0d1117", background: "#fff",
    outline: "none", fontFamily: "inherit", width: "100%",
    transition: "border-color 0.15s, box-shadow 0.15s",
    boxSizing: "border-box",
  };

  const heroSelect: React.CSSProperties = {
    ...heroField,
    cursor: "pointer",
    appearance: "none" as React.CSSProperties["appearance"],
  };

  return (
    /* Light-blue full-width band — this IS the ~1-inch margin area */
    <div style={{
      width: "100%",
      padding: "0 96px",       /* ~1 inch side gaps, filled with light blue */
      boxSizing: "border-box",
      background: "#dbeafe",   /* light blue band */
      display: "flex",
      alignItems: "stretch",
    }}>
      {/* Outer border ring — first border of the "double border" */}
      <div style={{
        flex: 1,
        border: "2px solid #93c5fd",
        borderRadius: 20,
        padding: 4,             /* gap between the two borders */
        background: "#bfdbfe",  /* color of the gap between borders */
        boxSizing: "border-box",
        margin: "28px 0",       /* vertical breathing room */
      }}>
        {/* Inner white card — second border */}
        <div style={{
          background: "#fff",
          border: "1.5px solid #dce6f5",
          borderRadius: 16,
          padding: "28px 32px 24px",
          boxShadow: "0 4px 24px rgba(37,99,235,0.07)",
          boxSizing: "border-box",
        }}>

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22 }}>
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#2563eb",
                textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6,
              }}>
                ClinicalTrials.gov
              </div>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: "#0d1117", margin: 0, lineHeight: 1.2 }}>
                Find a <em style={{ color: "#2563eb", fontStyle: "italic" }}>clinical trial</em> near you
              </h2>
            </div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 20,
              border: "1px solid #bbf7d0", background: "#f0fdf4",
              fontSize: 11, fontWeight: 700, color: "#15803d",
              whiteSpace: "nowrap", flexShrink: 0, marginLeft: 16,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
              LIVE · 400,000+ TRIALS
            </div>
          </div>

          {/* Condition — full width */}
          <div style={{ marginBottom: 14 }}>
            <label style={label}>
              <span style={{ marginRight: 4 }}>📍</span>Condition / Disease *
            </label>
            <input
              style={{ ...heroField, fontSize: 16 }}
              placeholder="e.g. Breast Cancer, Diabetes, Alzheimer…"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            {!condition.trim() && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 5, fontStyle: "italic" }}>
                Enter a condition, disease, or keyword to search trials
              </div>
            )}
          </div>

          {/* CRITICAL FIX: Display city/state validation error as prominent popup */}
          {validationError && (
            <div style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9999,
              padding: "24px 32px",
              background: "#fef2f2",
              border: "2px solid #dc2626",
              borderRadius: 12,
              boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
              fontSize: 15,
              color: "#991b1b",
              fontWeight: 600,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              maxWidth: 400,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 32 }}>⚠️</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Invalid City/State</div>
              <div>{validationError}</div>
              <button
                onClick={() => setValidationError(null)}
                style={{
                  marginTop: 8,
                  padding: "8px 24px",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                OK
              </button>
            </div>
          )}

          {/* City · State · Phase · Status */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <div>
              <label style={label}>City</label>
              <input style={heroField} placeholder="e.g. Boston" value={city}
                onChange={(e) => setCity(e.target.value)} onKeyDown={handleKeyDown} />
            </div>
            <div>
              <label style={label}>State</label>
              <select style={heroSelect} value={state} onChange={(e) => setState_(e.target.value)}>
                {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Phase</label>
              <select style={heroSelect} value={phase} onChange={(e) => setPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p} value={p}>{p || "Any Phase"}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Status</label>
              <select style={heroSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s || "Any Status"}</option>)}
              </select>
            </div>
          </div>

          {/* Search button */}
          <button
            onClick={handleSubmit}
            disabled={btnDisabled}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", height: 52,
              background: btnDisabled ? "#cdd3e0" : "#2563eb",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 16, fontWeight: 700,
              cursor: btnDisabled ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "background 0.15s",
              letterSpacing: "0.2px",
            }}
            onMouseEnter={(e) => { if (!btnDisabled) e.currentTarget.style.background = "#1d4ed8"; }}
            onMouseLeave={(e) => { if (!btnDisabled) e.currentTarget.style.background = "#2563eb"; }}
          >
            <SearchIcon />
            {loading ? "Searching…" : "Search Trials"}
          </button>
        </div>
      </div>
    </div>
  );
}