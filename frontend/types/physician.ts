// types/physician.ts
//
// Changes:
//  - (change #6)  Added `LeadModalTrigger` union type for modal trigger source.
//  - (change #7)  Added `TrialStatus` enum and `statusSortOrder` helper for
//                 ordered display when no status filter is active.
//  - (change #8)  Added `STATUS_COLORS` map for universal status color conventions.
//  - (change #9)  `PhysicianFetchResponse` now always returns the full dataset;
//                 pagination is handled client-side in usePhysicians.

// ── Physician ─────────────────────────────────────────────────────────────────

export interface Physician {
  npi:              string;
  name:             string;
  taxonomy_desc?:   string | null;   // specialty display label used in cards/map
  address?:         string | null;   // pre-formatted single-line address
  phone?:           string | null;
  lat?:             number | null;
  lng?:             number | null;
  distance_miles?:  number | null;
}

// ── Site / Search params ──────────────────────────────────────────────────────

/**
 * Passed to usePhysicians.search() and stored as selectedSite in page.tsx.
 * Carries the coordinates + display metadata for the chosen trial site.
 */
export interface SelectedSite {
  lat:      number;
  lng:      number;
  facility: string | null;
  city:     string | null;
  state:    string | null;
  nct_id:   string;
}

/** Parameters sent to fetchPhysicians() in lib/api.ts */
export interface PhysicianSearchParams {
  lat:        number;
  lng:        number;
  radius:     number;
  specialty?: string;
}

/**
 * Response shape from the /api/physicians/search endpoint.
 * The backend returns ALL matching physicians — no server-side paging.
 * Client-side pagination is handled in usePhysicians (change #9).
 */
export interface PhysicianFetchResponse {
  physicians:    Physician[];
  /** Total number of physicians in the full result set. */
  total:         number;
  radius_miles:  number;
  zips_searched: number;
}

// ── Lead capture ──────────────────────────────────────────────────────────────

/** Payload sent to the /api/leads endpoint from LeadCaptureModal */
export interface LeadPayload {
  name:     string;
  email:    string;
  phone?:   string;
  npi:      string;
  nct_id:   string;
  site?:    string;
  message?: string;
}

/**
 * Where the LeadCaptureModal was triggered from (change #6).
 * - "card"      → user clicked "Capture Lead" on a PhysicianCard
 * - "load_more" → user clicked the Load More button; modal appears before
 *                 the next page is revealed
 */
export type LeadModalTrigger = "card" | "load_more";

// ── Clinical trial status ─────────────────────────────────────────────────────

/**
 * Canonical trial status values (change #7).
 * Used for ordering results when no status filter is selected.
 */
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

/**
 * Display order when no status filter is active (change #7).
 * Maps each status to its sort priority (lower = shown first):
 *   Recruiting → Active → Not Actively Recruiting bucket → Completed →
 *   Terminated → Other
 */
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

/** Returns the sort priority for a given status string (change #7). */
export function getStatusSortOrder(status: string): number {
  return STATUS_SORT_ORDER[status] ?? 8;
}

/**
 * Universal status color conventions (change #8).
 * Each entry contains bg (background), fg (text), and border colors.
 */
export const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  // Green family — actively enrolling
  "Recruiting":              { bg: "#dcfce7", fg: "#15803d", border: "#bbf7d0" },
  "Enrolling by invitation": { bg: "#d1fae5", fg: "#065f46", border: "#a7f3d0" },

  // Blue family — active but not enrolling
  "Active, not recruiting":  { bg: "#dbeafe", fg: "#1d4ed8", border: "#bfdbfe" },

  // Yellow/amber — not yet started
  "Not yet recruiting":      { bg: "#fef9c3", fg: "#a16207", border: "#fde68a" },

  // Gray — completed
  "Completed":               { bg: "#f1f5f9", fg: "#475569", border: "#e2e8f0" },

  // Red family — terminated / stopped
  "Terminated":              { bg: "#fee2e2", fg: "#dc2626", border: "#fecaca" },
  "Suspended":               { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },

  // Muted — withdrawn / unknown
  "Withdrawn":               { bg: "#f3f4f6", fg: "#6b7280", border: "#e5e7eb" },
  "Unknown status":          { bg: "#f3f4f6", fg: "#9ca3af", border: "#e5e7eb" },
};

/**
 * Returns the color set for a given status, falling back to a neutral style
 * for unrecognised values (change #8).
 */
export function getStatusColors(status: string): { bg: string; fg: string; border: string } {
  return STATUS_COLORS[status] ?? { bg: "#f3f4f6", fg: "#6b7280", border: "#e5e7eb" };
}