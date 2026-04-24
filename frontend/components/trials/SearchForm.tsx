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
    fontSize:      11,
    fontWeight:    600,
    color:         "#8b95a1",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom:  5,
    display:       "block",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Row 1: condition (wide) + city + state */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "3 1 200px", minWidth: 180 }}>
          <label style={label}>Condition / Keyword *</label>
          <input
            style={field}
            placeholder="e.g. melanoma, diabetes, NSCLC"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div style={{ flex: "1 1 100px", minWidth: 90 }}>
          <label style={label}>City</label>
          <input
            style={field}
            placeholder="Any city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div style={{ flex: "1 1 120px", minWidth: 110 }}>
          <label style={label}>State</label>
          <select style={select} value={state} onChange={(e) => setState_(e.target.value)}>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: status + phase + button */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 150px", minWidth: 130 }}>
          <label style={label}>Status</label>
          <select style={select} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || "Any Status"}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "0 0 110px" }}>
          <label style={label}>Phase</label>
          <select style={select} value={phase} onChange={(e) => setPhase(e.target.value)}>
            {PHASES.map((p) => (
              <option key={p} value={p}>{p || "Any Phase"}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSubmit}
          disabled={btnDisabled}
          style={{
            height:       40,
            padding:      "0 28px",
            background:   btnDisabled ? "#cdd3e0" : "#2563eb",
            color:        "#fff",
            border:       "none",
            borderRadius: 8,
            fontSize:     14,
            fontWeight:   600,
            cursor:       btnDisabled ? "not-allowed" : "pointer",
            fontFamily:   "inherit",
            transition:   "background 0.15s",
            flexShrink:   0,
            display:      "flex",
            alignItems:   "center",
            gap:          7,
          }}
          onMouseEnter={(e) => { if (!btnDisabled) e.currentTarget.style.background = "#1d4ed8"; }}
          onMouseLeave={(e) => { if (!btnDisabled) e.currentTarget.style.background = "#2563eb"; }}
        >
          <SearchIcon />
          {loading ? "Searching…" : "Search Trials"}
        </button>
      </div>
    </div>
  );
}