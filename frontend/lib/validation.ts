/**
 * validation.ts
 * Frontend validation utilities for trials search
 *
 * CRITICAL FIX: City/State validation ensures users cannot search with
 * a city that doesn't belong to the selected state. This prevents
 * invalid search combinations that would waste backend resources or
 * return no results.
 */

/**
 * US state code to full name mapping
 */
const STATE_CODE_TO_FULL: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

/**
 * Common cities by state (subset for fast validation).
 * If city appears in this state's list, it's valid.
 * This is loaded from ZIP database and kept in sync.
 */
let CITIES_BY_STATE: Record<string, Set<string>> = {};

/**
 * Initialize city/state validation data
 * Call this once on app startup to load the ZIP database city mapping
 */
export async function initializeCityStateValidation(): Promise<void> {
  try {
    const response = await fetch("/api/trials/cities-by-state");
    if (!response.ok) {
      console.warn("Could not load city/state validation data");
      return;
    }
    const data = await response.json() as Record<string, string[]>;
    CITIES_BY_STATE = Object.fromEntries(
      Object.entries(data).map(([state, cities]) => [
        state,
        new Set(cities.map((c) => c.toLowerCase())),
      ])
    );
  } catch (err) {
    console.error("Error initializing city/state validation:", err);
  }
}

/**
 * Validate that a city belongs to the selected state
 *
 * Returns { isValid, error } where:
 * - isValid=true if city is valid for state or either is empty
 * - error=message if invalid (e.g., "Boston is not in California")
 * 
 * This function first checks local data, then falls back to backend validation
 * for more accurate and up-to-date city/state combinations.
 */
export async function validateCityStateAsync(
  city: string | null | undefined,
  state: string | null | undefined
): Promise<{ isValid: boolean; error?: string }> {
  // Both empty is valid (no filter applied)
  if (!city && !state) {
    return { isValid: true };
  }

  // If only city is provided (no state filter), allow it
  if (city && !state) {
    return { isValid: true };
  }

  // If only state is provided (no city filter), allow it
  if (!city && state) {
    return { isValid: true };
  }

  // Both provided — validate combination
  if (city && state) {
    const cityLower = city.trim().toLowerCase();
    const stateCities = CITIES_BY_STATE[state];

    // If we don't have data for this state, try backend validation
    if (!stateCities) {
      return validateWithBackend(city, state);
    }

    // Check if city is in this state's city list
    if (!stateCities.has(cityLower)) {
      // Try backend validation as fallback
      const backendResult = await validateWithBackend(city, state);
      if (backendResult.isValid) {
        return { isValid: true };
      }
      return {
        isValid: false,
        error: `"${city}" is not a city in ${STATE_CODE_TO_FULL[state] || state}`,
      };
    }

    return { isValid: true };
  }

  return { isValid: true };
}

/**
 * Validate city/state combination using the backend endpoint
 */
async function validateWithBackend(
  city: string | null | undefined,
  state: string | null | undefined
): Promise<{ isValid: boolean; error?: string }> {
  try {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (state) params.set("state", state);
    
    const response = await fetch(`/api/trials/validate-city-state?${params.toString()}`);
    if (response.ok) {
      const data = await response.json();
      return { isValid: data.isValid, error: data.error };
    }
  } catch (err) {
    console.warn("Backend city/state validation failed:", err);
  }
  
  // If backend fails, allow the search (fail open)
  return { isValid: true };
}

/**
 * Synchronous validation for immediate feedback (uses cached data only)
 */
export function validateCityState(
  city: string | null | undefined,
  state: string | null | undefined
): { isValid: boolean; error?: string } {
  // Both empty is valid (no filter applied)
  if (!city && !state) {
    return { isValid: true };
  }

  // If only city is provided (no state filter), allow it
  if (city && !state) {
    return { isValid: true };
  }

  // If only state is provided (no city filter), allow it
  if (!city && state) {
    return { isValid: true };
  }

  // Both provided — validate combination
  if (city && state) {
    const cityLower = city.trim().toLowerCase();
    const stateCities = CITIES_BY_STATE[state];

    // If we don't have data for this state, don't block (assume valid)
    if (!stateCities) {
      return { isValid: true };
    }

    // Check if city is in this state's city list
    if (!stateCities.has(cityLower)) {
      return {
        isValid: false,
        error: `"${city}" is not a city in ${STATE_CODE_TO_FULL[state] || state}`,
      };
    }

    return { isValid: true };
  }

  return { isValid: true };
}

/**
 * Format a validation error for display to the user
 */
export function formatValidationError(error: string | undefined): string {
  if (!error) return "";
  return error.charAt(0).toUpperCase() + error.slice(1);
}
