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
};

const PHASES = [
  { label: "Any Phase", value: "" },
  { label: "Early Phase 1", value: "early phase 1" },
  { label: "Phase 1", value: "phase1" },
  { label: "Phase 2", value: "phase2" },
  { label: "Phase 3", value: "phase3" },
  { label: "Phase 4", value: "phase4" },
];

const STATUSES = [
  { label: "Any Status", value: "" },
  { label: "Recruiting", value: "recruiting" },
  { label: "Not Yet Recruiting", value: "not yet recruiting" },
  { label: "Active (not recruiting)", value: "active, not recruiting" },
  { label: "Completed", value: "completed" },
  { label: "Terminated", value: "terminated" },
];

const QUICK_CONDITIONS = [
  "Breast Cancer", "Lung Cancer", "Diabetes", "Alzheimer", "Heart Failure",
  "Depression", "COPD", "Leukemia", "COVID", "Stroke",
];

const US_STATES = [
  "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN",
  "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

export default function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [condition, setCondition] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!condition.trim()) return;
    onSearch({ condition: condition.trim(), city: city.trim(), state, status, phase });
  };

  const handleQuick = (quickCondition: string) => {
    setCondition(quickCondition);
    onSearch({ condition: quickCondition, city: city.trim(), state, status, phase });
  };

  return (
    <div className="search-form">
      <form onSubmit={handleSubmit}>
        <div className="field-group">
          <label className="field-label">Condition / Disease <span className="required">*</span></label>
          <input
            className="field-input"
            type="text"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
            placeholder="e.g. Breast Cancer, Diabetes, Alzheimer..."
            required
          />
        </div>

        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">City</label>
            <input
              className="field-input"
              type="text"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="e.g. Boston"
            />
          </div>
          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label">State</label>
            <select className="field-select" value={state} onChange={(event) => setState(event.target.value)}>
              {US_STATES.map((code) => <option key={code} value={code}>{code || "Any"}</option>)}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label">Phase</label>
            <select className="field-select" value={phase} onChange={(event) => setPhase(event.target.value)}>
              {PHASES.map((phaseOption) => (
                <option key={phaseOption.value} value={phaseOption.value}>
                  {phaseOption.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label">Status</label>
            <select className="field-select" value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUSES.map((statusOption) => (
                <option key={statusOption.value} value={statusOption.value}>
                  {statusOption.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button type="submit" className="btn-search" disabled={loading || !condition.trim()}>
          {loading ? (
            <><span className="btn-spinner" /> Searching...</>
          ) : (
            <>Search Trials</>
          )}
        </button>
      </form>

      <div className="quick-picks">
        <div className="quick-label">Quick search:</div>
        <div className="quick-pills">
          {QUICK_CONDITIONS.map((quickCondition) => (
            <button
              key={quickCondition}
              className="quick-pill"
              onClick={() => handleQuick(quickCondition)}
              type="button"
            >
              {quickCondition}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
