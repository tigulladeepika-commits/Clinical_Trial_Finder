// types/trial.ts

export interface TrialSite {
  facility:  string | null;
  city:      string | null;
  state:     string | null;
  country:   string | null;
  status:    string | null;
  lat:       number | null;
  lon:       number | null;
  zip?:      string | null;
}

export interface Trial {
  nctId:           string;
  title:           string;
  status:          string;
  phases?:         string[];
  sponsor?:        string | null;
  description?:    string | null;
  conditions?:     string[];
  interventions?:  string[];
  startDate?:      string | null;
  completionDate?: string | null;
  enrollment?:     number | null;
  studyType?:      string | null;
}

/**
 * Returned by fetchTrialSites() — wraps the site list with trial metadata
 * so page.tsx can store it in a single `siteData` state variable.
 */
export interface SiteData {
  nctId:  string;
  title:  string;
  sites:  TrialSite[];
}

/**
 * The filter object built from URL search params in page.tsx / HomeInner.
 * All fields are strings (empty string = unset) to make URLSearchParams easy.
 */
export interface TrialSearchFilters {
  condition: string;
  city:      string;
  state:     string;
  status:    string;
  phase:     string;
}

/** Parameters passed to fetchTrials() in lib/api.ts */
export interface TrialFetchParams {
  condition: string;
  city?:     string | null;
  state?:    string | null;
  status?:   string;
  phase?:    string;
  limit?:    number;
  offset?:   number;
}

/** Response shape from the /api/trials/search endpoint */
export interface TrialFetchResponse {
  trials: Trial[];
  total:  number;
}