// types/physician.ts

export interface Physician {
  npi:                string;
  name:               string;
  taxonomy_desc?:     string | null;
  address?:           string | null;
  phone?:             string | null;
  lat?:               number | null;
  lng?:               number | null;
  distance_miles?:    number | null;
  matched_specialty?: string | null;
}

export interface SelectedSite {
  lat:       number;
  lng:       number;
  facility:  string | null;
  city:      string | null;
  state:     string | null;
  nct_id:    string;
  condition: string | null;
}

export interface PhysicianSearchParams {
  lat:                number;
  lng:                number;
  radius:             number;
  specialty?:         string;
  initial_specialty?: string;
  user_specialty?:    string;
}

export interface SuggestedPhysicianParams {
  lat:          number;
  lng:          number;
  radius:       number;
  condition?:   string;
  /** NPIs already shown in the main list — backend excludes these */
  exclude_npis?: string[];
}

export interface PhysicianFetchResponse {
  physicians:         Physician[];
  total:              number;
  radius_miles:       number;
  zips_searched:      number;
  search_specialties: string[];
}

/** Identical shape to PhysicianFetchResponse — typed separately for clarity */
export type SuggestedPhysicianFetchResponse = PhysicianFetchResponse;

// ── PubMed Publications ───────────────────────────────────────────────────────

export interface Publication {
  pmid:     string;
  title:    string;
  journal:  string;
  year:     string;
  /** Up to 6 authors in "LastName Initials" format */
  authors:  string[];
  /** Direct link to the PubMed record */
  url:      string;
  /** First 600 chars of abstract — empty string when unavailable */
  abstract: string;
}

export interface PublicationFetchResponse {
  npi:          string;
  name:         string;
  count:        number;
  publications: Publication[];
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export interface LeadPayload {
  name:            string;
  email:           string;
  phone?:          string;
  npi?:            string;
  nct_id?:         string;
  site?:           string;
  message?:        string;
  company?:        string;
  lead_source?:    string;
  title?:          string;
  physician_name?: string;
  auto?:           boolean;
}

export type LeadModalTrigger = "card" | "load_more";

export type TrialStatus =
  | "Recruiting"
  | "Active, not recruiting"
  | "Not yet recruiting"
  | "Enrolling by invitation"
  | "Completed"
  | "Terminated"
  | "Suspended"
  | "Withdrawn"
  | "Unknown status";

export const STATUS_SORT_ORDER: Record<string, number> = {
  "Recruiting":              0,
  "Active, not recruiting":  1,
  "Enrolling by invitation": 2,
  "Not yet recruiting":      3,
  "Completed":               4,
  "Terminated":              5,
  "Suspended":               6,
  "Withdrawn":               7,
  "Unknown status":          8,
};

export function getStatusSortOrder(status: string): number {
  return STATUS_SORT_ORDER[status] ?? 8;
}

export const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  "Recruiting":              { bg: "#dcfce7", fg: "#15803d", border: "#bbf7d0" },
  "Enrolling by invitation": { bg: "#d1fae5", fg: "#065f46", border: "#a7f3d0" },
  "Active, not recruiting":  { bg: "#dbeafe", fg: "#1d4ed8", border: "#bfdbfe" },
  "Not yet recruiting":      { bg: "#fef9c3", fg: "#a16207", border: "#fde68a" },
  "Completed":               { bg: "#f1f5f9", fg: "#475569", border: "#e2e8f0" },
  "Terminated":              { bg: "#fee2e2", fg: "#dc2626", border: "#fecaca" },
  "Suspended":               { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },
  "Withdrawn":               { bg: "#f3f4f6", fg: "#6b7280", border: "#e5e7eb" },
  "Unknown status":          { bg: "#f3f4f6", fg: "#9ca3af", border: "#e5e7eb" },
};

export function getStatusColors(status: string): { bg: string; fg: string; border: string } {
  return STATUS_COLORS[status] ?? { bg: "#f3f4f6", fg: "#6b7280", border: "#e5e7eb" };
}