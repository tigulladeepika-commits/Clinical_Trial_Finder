// components/trials/SearchForm.tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import type { TrialSearchFilters }           from "@/types/trial";

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
  { code: "",   label: "Any State" },
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

  const handleSubmit = useCallback(() => {
    if (!condition.trim()) return;
    onSearch({ condition, city, state, status, phase });
  }, [condition, city, state, status, phase, onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSubmit(); },
    [handleSubmit],
  );

  const btnDisabled = loading || !condition.trim();

  // ── Shared field style ──────────────────────────────────────────────────────
  const field: React.CSSProperties = {
    height:       36,
    padding:      "0 12px",
    border:       "1px solid #e4e8f0",
    borderRadius: 8,
    fontSize:     13,
    color:        "#0d1117",
    background:   "#f6f7fb",
    outline:      "none",
    fontFamily:   "inherit",
    width:        "100%",
    transition:   "border-color 0.15s, box-shadow 0.15s",
    boxSizing:    "border-box",
  };

  const select: React.CSSProperties = {
    ...field,
    cursor:      "pointer",
    paddingRight: 8,
    appearance:  "none" as React.CSSProperties["appearance"],
  };

  // ── Search button ───────────────────────────────────────────────────────────
  const SearchIcon = () => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );

  // ── COMPACT (results bar) ───────────────────────────────────────────────────
  // Condition · City · Status · Search — minimal, single row, no labels
  if (compact) {
    return (
      <div style={{
        display:    "flex",
        gap:        8,
        alignItems: "center",
        width:      "100%",
        flexWrap:   "nowrap",
        minWidth:   0,
      }}>
        {/* Condition — widest */}
        <input
          style={{ ...field, flex: "2 1 0", minWidth: 140 }}
          placeholder="Condition or keyword"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Condition"
        />

        {/* City */}
        <input
          style={{ ...field, flex: "1 1 0", minWidth: 80 }}
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="City"
        />

        {/* Status */}
        <select
          style={{ ...select, flex: "1 1 0", minWidth: 110 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || "Any Status"}</option>
          ))}
        </select>

        {/* Search button */}
        <button
          onClick={handleSubmit}
          disabled={btnDisabled}
          style={{
            height:       36,
            padding:      "0 18px",
            background:   btnDisabled ? "#cdd3e0" : "#2563eb",
            color:        "#fff",
            border:       "none",
            borderRadius: 8,
            fontSize:     13,
            fontWeight:   600,
            cursor:       btnDisabled ? "not-allowed" : "pointer",
            whiteSpace:   "nowrap",
            fontFamily:   "inherit",
            transition:   "background 0.15s",
            flexShrink:   0,
            display:      "flex",
            alignItems:   "center",
            gap:          6,
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
    fontSize:      10,
    fontWeight:    700,
    color:         "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    marginBottom:  6,
    display:       "block",
  };

  const heroField: React.CSSProperties = {
    height:       44,
    padding:      "0 14px",
    border:       "1px solid #e4e8f0",
    borderRadius: 8,
    fontSize:     14,
    color:        "#0d1117",
    background:   "#fff",
    outline:      "none",
    fontFamily:   "inherit",
    width:        "100%",
    transition:   "border-color 0.15s, box-shadow 0.15s",
    boxSizing:    "border-box",
  };

  const heroSelect: React.CSSProperties = {
    ...heroField,
    cursor:     "pointer",
    appearance: "none" as React.CSSProperties["appearance"],
  };

  return (
    /* Outer full-width band with ~1 inch padding */
    <div style={{
      width:      "100%",
      padding:    "32px 96px",   /* ~1 inch side margins */
      boxSizing:  "border-box",
      background: "#eef4fb",     /* light blue-tinted wash matching screenshot */
    }}>
      {/* Card */}
      <div style={{
        background:   "#fff",
        border:       "1px solid #dce6f5",
        borderRadius: 16,
        padding:      "28px 32px",
        boxShadow:    "0 2px 16px rgba(37,99,235,0.06)",
        borderLeft:   "4px solid #2563eb",
      }}>

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{
              fontSize:      11,
              fontWeight:    700,
              color:         "#2563eb",
              textTransform: "uppercase",
              letterSpacing: "0.8px",
              marginBottom:  6,
            }}>
            · ClinicalTrials.gov
            </div>
            <h2 style={{
              fontSize:   26,
              fontWeight: 700,
              color:      "#0d1117",
              margin:     0,
              lineHeight: 1.2,
            }}>
              Find a <em style={{ color: "#2563eb", fontStyle: "italic" }}>clinical trial</em> near you
            </h2>
          </div>

          {/* Live badge */}
          <div style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          6,
            padding:      "6px 14px",
            borderRadius: 20,
            border:       "1px solid #bbf7d0",
            background:   "#f0fdf4",
            fontSize:     11,
            fontWeight:   700,
            color:        "#15803d",
            whiteSpace:   "nowrap",
            flexShrink:   0,
            marginLeft:   16,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
            LIVE · 400,000+ TRIALS
          </div>
        </div>

        {/* Row 1: Condition — full width */}
        <div style={{ marginBottom: 12 }}>
          <label style={label}>
            <span style={{ marginRight: 4 }}>📍</span>Condition / Disease *
          </label>
          <input
            style={{ ...heroField, fontSize: 15 }}
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

        {/* Row 2: City · State · Phase · Status — equal columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          <div>
            <label style={label}>City</label>
            <input
              style={heroField}
              placeholder="e.g. Boston"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            <label style={label}>State</label>
            <select style={heroSelect} value={state} onChange={(e) => setState_(e.target.value)}>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Phase</label>
            <select style={heroSelect} value={phase} onChange={(e) => setPhase(e.target.value)}>
              {PHASES.map((p) => (
                <option key={p} value={p}>{p || "Any Phase"}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Status</label>
            <select style={heroSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s || "Any Status"}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Full-width search button */}
        <button
          onClick={handleSubmit}
          disabled={btnDisabled}
          style={{
            display:      "flex",
            alignItems:   "center",
            justifyContent: "center",
            gap:          8,
            width:        "100%",
            height:       48,
            background:   btnDisabled ? "#cdd3e0" : "#4f7be8",
            color:        "#fff",
            border:       "none",
            borderRadius: 10,
            fontSize:     15,
            fontWeight:   700,
            cursor:       btnDisabled ? "not-allowed" : "pointer",
            fontFamily:   "inherit",
            transition:   "background 0.15s",
            letterSpacing: "0.2px",
          }}
          onMouseEnter={(e) => { if (!btnDisabled) e.currentTarget.style.background = "#2563eb"; }}
          onMouseLeave={(e) => { if (!btnDisabled) e.currentTarget.style.background = "#4f7be8"; }}
        >
          <SearchIcon />
          {loading ? "Searching…" : "Search Trials"}
        </button>
      </div>
    </div>
  );
}