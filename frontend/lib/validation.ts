/**
 * lib/validation.ts
 * Frontend validation utilities for trials search.
 *
 * v3 fixes:
 *  - STATE_CODE_TO_FULL values are now plain state names ("Oregon") not
 *    "Oregon(OR)" — the old format leaked the code into error messages.
 *  - initializeCityStateValidation() now normalises stored city names to
 *    lowercase at write-time so lookups never case-mismatch.
 *  - validateCityStateAsync() local check now uses the normalised city
 *    string directly (already lowercased) — no double-normalisation.
 *  - validateWithBackend() is now the PRIMARY path when local data is
 *    absent; it fails OPEN (isValid: true) on any network/server error
 *    so a backend outage never blocks a legitimate search.
 *  - Removed the erroneous second isValid check inside the local-miss
 *    branch that caused valid cities to be rejected when the backend
 *    returned isValid:true but the local set was stale/empty.
 */

const STATE_CODE_TO_FULL: Record<string, string> = {
  AL: "Alabama",        AK: "Alaska",         AZ: "Arizona",
  AR: "Arkansas",       CA: "California",     CO: "Colorado",
  CT: "Connecticut",    DE: "Delaware",       FL: "Florida",
  GA: "Georgia",        HI: "Hawaii",         ID: "Idaho",
  IL: "Illinois",       IN: "Indiana",        IA: "Iowa",
  KS: "Kansas",         KY: "Kentucky",       LA: "Louisiana",
  ME: "Maine",          MD: "Maryland",       MA: "Massachusetts",
  MI: "Michigan",       MN: "Minnesota",      MS: "Mississippi",
  MO: "Missouri",       MT: "Montana",        NE: "Nebraska",
  NV: "Nevada",         NH: "New Hampshire",  NJ: "New Jersey",
  NM: "New Mexico",     NY: "New York",       NC: "North Carolina",
  ND: "North Dakota",   OH: "Ohio",           OK: "Oklahoma",
  OR: "Oregon",         PA: "Pennsylvania",   RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota",   TN: "Tennessee",
  TX: "Texas",          UT: "Utah",           VT: "Vermont",
  VA: "Virginia",       WA: "Washington",     WV: "West Virginia",
  WI: "Wisconsin",      WY: "Wyoming",        DC: "District of Columbia",
};

/**
 * Cities by state — keys are 2-letter state codes (e.g. "OR"),
 * values are Sets of lowercased city names populated from the ZIP database.
 * Empty until initializeCityStateValidation() resolves.
 */
let CITIES_BY_STATE: Record<string, Set<string>> = {};
let _initStarted = false;

/**
 * Load the cities-by-state mapping from the backend (ZIP database).
 * Safe to call multiple times — only fetches once.
 * Called from page.tsx on mount.
 */
export async function initializeCityStateValidation(): Promise<void> {
  if (_initStarted) return;
  _initStarted = true;

  try {
    const response = await fetch("/api/trials/cities-by-state");
    if (!response.ok) {
      console.warn("[validation] cities-by-state fetch failed:", response.status);
      return;
    }
    const data = (await response.json()) as Record<string, string[]>;

    // Normalise at write-time: lowercase every city name so lookups never
    // need to case-fold again. Keys stay as uppercase state codes (e.g. "OR").
    CITIES_BY_STATE = Object.fromEntries(
      Object.entries(data).map(([stateCode, cities]) => [
        stateCode.toUpperCase(),
        new Set(cities.map((c) => c.toLowerCase())),
      ])
    );
    console.info(
      `[validation] Loaded city/state data for ${Object.keys(CITIES_BY_STATE).length} states`
    );
  } catch (err) {
    console.error("[validation] Error loading city/state data:", err);
    // Leave CITIES_BY_STATE empty — all validations will fall back to backend.
  }
}

/**
 * Async city/state validation used by SearchForm before submitting.
 *
 * Logic:
 *  1. If either field is blank → valid (no filter to validate).
 *  2. Local check: if we have data for this state, check the city set.
 *     - Hit  → valid immediately, no network call.
 *     - Miss → fall through to backend (city may be valid but absent from
 *               our cached set, e.g. very small towns).
 *  3. No local data for this state → go straight to backend.
 *  4. Backend check: calls /api/trials/validate-city-state.
 *     - Returns backend result on success.
 *     - Returns isValid:true on any network/server error (fail open).
 */
export async function validateCityStateAsync(
  city:  string | null | undefined,
  state: string | null | undefined,
): Promise<{ isValid: boolean; error?: string }> {
  const cityTrimmed  = city?.trim()  ?? "";
  const stateTrimmed = state?.trim() ?? "";

  // Rule 1: no filter on either → always valid
  if (!cityTrimmed || !stateTrimmed) return { isValid: true };

  const cityLower  = cityTrimmed.toLowerCase();
  const stateUpper = stateTrimmed.toUpperCase();

  // Rule 2: local cache hit
  const stateCities = CITIES_BY_STATE[stateUpper];
  if (stateCities) {
    if (stateCities.has(cityLower)) {
      // Local confirmed valid — no backend call needed
      return { isValid: true };
    }
    // Local miss — verify with backend before rejecting (stale/small-town edge case)
    const backendResult = await validateWithBackend(cityTrimmed, stateTrimmed);
    if (backendResult.isValid) return { isValid: true };

    // Both local and backend say invalid → show error
    const stateName = STATE_CODE_TO_FULL[stateUpper] ?? stateTrimmed;
    return {
      isValid: false,
      error:   `Invalid city/state combination: "${cityTrimmed}" is not a city in ${stateName}`,
    };
  }

  // Rule 3: no local data for this state → backend is authoritative
  return validateWithBackend(cityTrimmed, stateTrimmed);
}

/**
 * Validate city/state via the backend endpoint.
 * Always fails OPEN on network/server errors so a backend outage never
 * blocks a legitimate search.
 */
async function validateWithBackend(
  city:  string,
  state: string,
): Promise<{ isValid: boolean; error?: string }> {
  try {
    const params = new URLSearchParams({ city, state });
    const response = await fetch(`/api/trials/validate-city-state?${params.toString()}`);
    if (!response.ok) {
      console.warn("[validation] Backend validate-city-state returned", response.status);
      return { isValid: true }; // fail open
    }
    const data = (await response.json()) as { isValid: boolean; error?: string };
    return { isValid: data.isValid, error: data.error };
  } catch (err) {
    console.warn("[validation] Backend validation request failed:", err);
    return { isValid: true }; // fail open
  }
}

/**
 * Synchronous validation using the local cache only.
 * Used for instant feedback while the user is typing.
 * Never blocks — returns isValid:true if cache is empty or state is absent.
 */
export function validateCityState(
  city:  string | null | undefined,
  state: string | null | undefined,
): { isValid: boolean; error?: string } {
  const cityTrimmed  = city?.trim()  ?? "";
  const stateTrimmed = state?.trim() ?? "";

  if (!cityTrimmed || !stateTrimmed) return { isValid: true };

  const cityLower  = cityTrimmed.toLowerCase();
  const stateUpper = stateTrimmed.toUpperCase();
  const stateCities = CITIES_BY_STATE[stateUpper];

  if (!stateCities) return { isValid: true }; // no data → fail open

  if (!stateCities.has(cityLower)) {
    const stateName = STATE_CODE_TO_FULL[stateUpper] ?? stateTrimmed;
    return {
      isValid: false,
      error:   `"${cityTrimmed}" is not a city in ${stateName}`,
    };
  }

  return { isValid: true };
}

/**
 * Capitalise the first letter of a validation error string for display.
 */
export function formatValidationError(error: string | undefined): string {
  if (!error) return "";
  return error.charAt(0).toUpperCase() + error.slice(1);
}