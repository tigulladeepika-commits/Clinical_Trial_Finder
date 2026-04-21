// types/physician.ts

export interface Physician {
  npi:            string;
  name:           string;
  taxonomy_desc?: string | null;   // specialty display label used in cards/map
  address?:       string | null;   // pre-formatted single-line address
  phone?:         string | null;
  lat?:           number | null;
  lng?:           number | null;
  distance_miles?: number | null;
}

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
  lat:       number;
  lng:       number;
  radius:    number;
  specialty?: string;
}

/** Response shape from the /api/physicians/search endpoint */
export interface PhysicianFetchResponse {
  physicians:   Physician[];
  total:        number;
  radius_miles: number;
  zips_searched: number;
}

/** Payload sent to the /api/leads endpoint from LeadCaptureModal */
export interface LeadPayload {
  name:    string;
  email:   string;
  phone?:  string;
  npi:     string;
  nct_id:  string;
  site?:   string;
  message?: string;
}