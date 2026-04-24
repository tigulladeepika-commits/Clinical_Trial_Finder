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
  { code: "AL", label: "Alabama" },      { code: "AK", label: "Alaska" },
  { code: "AZ", label: "Arizona" },      { code: "AR", label: "Arkansas" },
  { code: "CA", label: "California" },   { code: "CO", label: "Colorado" },
  { code: "CT", label: "Connecticut" },  { code: "DE", label: "Delaware" },
  { code: "FL", label: "Florida" },      { code: "GA", label: "Georgia" },
  { code: "HI", label: "Hawaii" },       { code: "ID", label: "Idaho" },
  { code: "IL", label: "Illinois" },     { code: "IN", label: "Indiana" },
  { code: "IA", label: "Iowa" },         { code: "KS", label: "Kansas" },
  { code: "KY", label: "Kentucky" },     { code: "LA", label: "Louisiana" },
  { code: "ME", label: "Maine" },        { code: "MD", label: "Maryland" },
  { code: "MA", label: "Massachusetts"},{ code: "MI", label: "Michigan" },
  { code: "MN", label: "Minnesota" },    { code: "MS", label: "Mississippi" },
  { code: "MO", label: "Missouri" },     { code: "MT", label: "Montana" },
  { code: "NE", label: "Nebraska" },     { code: "NV", label: "Nevada" },
  { code: "NH", label: "New Hampshire"},{ code: "NJ", label: "New Jersey" },
  { code: "NM", label: "New Mexico" },   { code: "NY", label: "New York" },
  { code: "NC", label: "North Carolina"},{ code:"ND", label: "North Dakota" },
  { code: "OH", label: "Ohio" },         { code: "OK", label: "Oklahoma" },
  { code: "OR", label: "Oregon" },       { code: "PA", label: "Pennsylvania" },
  { code: "RI", label: "Rhode Island" }, { code: "SC", label: "South Carolina" },
  { code: "SD", label: "South Dakota" }, { code: "TN", label: "Tennessee" },
  { code: "TX", label: "Texas" },        { code: "UT", label: "Utah" },
  { code: "VT", label: "Vermont" },      { code: "VA", label: "Virginia" },
  { code: "WA", label: "Washington" },   { code: "WV", label: "West Virginia" },
  { code: "WI", label: "Wisconsin" },    { code: "WY", label: "Wyoming" },
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

  // Sync if initialValues change (e.g. URL-driven navigation)
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
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  const inputStyle: React.CSSProperties = {
    height:          36,
    padding:         "0 12px",
    border:          "1px solid #e4e8f0",
    borderRadius:    8,
    fontSize:        13,
    color:           "#0d1117",
    background:      "#f6f7fb",
    outline:         "none",
    fontFamily:      "inherit",
    width:           "100%",
    transition:      "border-color 0.15s",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
    paddingRight: 8,
  };

  const labelStyle: React.CSSProperties = {
    fontSize:      11,
    fontWeight:    600,
    color:         "#8b95a1",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom:  3,
    display:       "block",
  };

  if (compact) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          style={{ ...inputStyle, flex: "2 1 180px", minWidth: 160 }}
          placeholder="Condition, disease, or keyword"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Condition"
        />
        <input
          style={{ ...inputStyle, flex: "1 1 100px", minWidth: 90 }}
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="City"
        />
        <select
          style={{ ...selectStyle, flex: "1 1 120px", minWidth: 110 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || "Any Status"}</option>
          ))}
        </select>
        <select
          style={{ ...selectStyle, flex: "0 0 110px" }}
          value={phase}
          onChange={(e) => setPhase(e.target.value)}
          aria-label="Phase"
        >
          {PHASES.map((p) => (
            <option key={p} value={p}>{p || "Any Phase"}</option>
          ))}
        </select>
        <button
          onClick={handleSubmit}
          disabled={loading || !condition.trim()}
          style={{
            height:          36,
            padding:         "0 20px",
            background:      loading || !condition.trim() ? "#cdd3e0" : "#2563eb",
            color:           "#fff",
            border:          "none",
            borderRadius:    8,
            fontSize:        13,
            fontWeight:      600,
            cursor:          loading || !condition.trim() ? "not-allowed" : "pointer",
            whiteSpace:      "nowrap",
            fontFamily:      "inherit",
            transition:      "background 0.15s",
            flexShrink:      0,
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
    );
  }

  // Hero (full-size) form
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 200px", minWidth: 180 }}>
          <label style={labelStyle}>Condition / Keyword *</label>
          <input
            style={inputStyle}
            placeholder="e.g. melanoma, NSCLC, diabetes"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div style={{ flex: "1 1 110px", minWidth: 100 }}>
          <label style={labelStyle}>City</label>
          <input
            style={inputStyle}
            placeholder="Any city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div style={{ flex: "1 1 130px", minWidth: 120 }}>
          <label style={labelStyle}>State</label>
          <select
            style={selectStyle}
            value={state}
            onChange={(e) => setState_(e.target.value)}
          >
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 160px", minWidth: 140 }}>
          <label style={labelStyle}>Recruitment Status</label>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || "Any Status"}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "0 0 120px" }}>
          <label style={labelStyle}>Phase</label>
          <select style={selectStyle} value={phase} onChange={(e) => setPhase(e.target.value)}>
            {PHASES.map((p) => (
              <option key={p} value={p}>{p || "Any Phase"}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading || !condition.trim()}
          style={{
            height:       42,
            padding:      "0 28px",
            background:   loading || !condition.trim() ? "#cdd3e0" : "#2563eb",
            color:        "#fff",
            border:       "none",
            borderRadius: 8,
            fontSize:     14,
            fontWeight:   600,
            cursor:       loading || !condition.trim() ? "not-allowed" : "pointer",
            fontFamily:   "inherit",
            transition:   "background 0.15s",
            flexShrink:   0,
          }}
        >
          {loading ? "Searching…" : "Search Trials"}
        </button>
      </div>
    </div>
  );
}