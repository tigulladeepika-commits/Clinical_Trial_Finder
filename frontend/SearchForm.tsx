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
  "Breast Cancer", "Lung Cancer", "Diabetes", "Alzheimer",
  "Heart Failure", "Depression", "COPD", "Leukemia", "COVID", "Stroke",
];

const US_STATES = [
  "", "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY","DC",
];

export default function SearchForm({ onSearch, loading, compact }: SearchFormProps) {
  const [condition, setCondition] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!condition.trim()) return;
    onSearch({ condition: condition.trim(), city: city.trim(), state, status, phase });
  };

  const handleQuick = (q: string) => {
    setCondition(q);
    onSearch({ condition: q, city: city.trim(), state, status, phase });
  };

  return (
    <div className="search-form">
      <form onSubmit={handleSubmit}>
        {compact ? (
          /* ── COMPACT (inline row after results) ── */
          <div className="search-grid">
            <div className="field-group condition-field">
              <label className="field-label">Condition <span className="required">*</span></label>
              <input
                className="field-input"
                type="text"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g. Breast Cancer, Diabetes…"
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">City</label>
              <input className="field-input" type="text" value={city}
                onChange={(e) => setCity(e.target.value)} placeholder="Boston" />
            </div>
            <div className="field-group">
              <label className="field-label">State</label>
              <select className="field-select" value={state} onChange={(e) => setState(e.target.value)}>
                {US_STATES.map((s) => <option key={s} value={s}>{s || "Any"}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Phase</label>
              <select className="field-select" value={phase} onChange={(e) => setPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Status</label>
              <select className="field-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">&nbsp;</label>
              <button type="submit" className="btn-search" disabled={loading || !condition.trim()}>
                {loading ? <><span className="btn-spinner" /> Searching…</> : <>🔍 Search</>}
              </button>
            </div>
          </div>
        ) : (
          /* ── HERO (stacked layout) ── */
          <div className="search-grid">
            <div className="field-group condition-field">
              <label className="field-label">Condition / Disease <span className="required">*</span></label>
              <input
                className="field-input"
                type="text"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g. Breast Cancer, Diabetes, Alzheimer…"
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">City</label>
              <input className="field-input" type="text" value={city}
                onChange={(e) => setCity(e.target.value)} placeholder="e.g. Boston" />
            </div>
            <div className="field-group">
              <label className="field-label">State</label>
              <select className="field-select" value={state} onChange={(e) => setState(e.target.value)}>
                {US_STATES.map((s) => <option key={s} value={s}>{s || "Any State"}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Phase</label>
              <select className="field-select" value={phase} onChange={(e) => setPhase(e.target.value)}>
                {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Status</label>
              <select className="field-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-search" disabled={loading || !condition.trim()}>
              {loading ? <><span className="btn-spinner" /> Searching…</> : <>Search Trials</>}
            </button>
          </div>
        )}
      </form>

      {!compact && (
        <div className="quick-picks">
          <div className="quick-label">Quick:</div>
          <div className="quick-pills">
            {QUICK_CONDITIONS.map((q) => (
              <button key={q} className="quick-pill" onClick={() => handleQuick(q)} type="button">
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}