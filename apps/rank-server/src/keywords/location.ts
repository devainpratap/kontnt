/**
 * Resolving the search location for a keyword.
 *
 * A rank check is only correct if it runs from the right place. A hyperlocal
 * keyword ("digital marketing agency noida") checked from a national vantage
 * simply will not find a local business; a national keyword should be checked
 * country-wide. So the rule is: if the phrase names a place we recognise, use
 * that city; otherwise fall back to the country ("India" for gl=in). A location
 * the user set by hand always wins.
 *
 * Every canonical name here is verified against SerpApi's locations.json - the
 * exact "City,Region,Country" form with no spaces after commas. SerpApi rejects
 * an unknown location, so these must match. The same string doubles as the
 * Google `uule` input on the browser/ScrapingRobot path via
 * encodeCanonicalLocation, so one value serves every provider.
 */

/** City alias (lowercase) -> SerpApi canonical location. Extend as clients grow. */
const PLACE_LOCATIONS: Record<string, string> = {
  "greater noida": "Greater Noida,Uttar Pradesh,India",
  "navi mumbai": "Navi Mumbai,Maharashtra,India",
  "new delhi": "New Delhi,Delhi,India",
  noida: "Noida,Uttar Pradesh,India",
  delhi: "New Delhi,Delhi,India",
  gurugram: "Gurugram,Haryana,India",
  gurgaon: "Gurugram,Haryana,India",
  ghaziabad: "Ghaziabad,Uttar Pradesh,India",
  faridabad: "Faridabad,Haryana,India",
  mumbai: "Mumbai,Maharashtra,India",
  pune: "Pune,Maharashtra,India",
  bengaluru: "Bengaluru,Karnataka,India",
  bangalore: "Bengaluru,Karnataka,India",
  hyderabad: "Hyderabad,Telangana,India",
  chennai: "Chennai,Tamil Nadu,India",
  kolkata: "Kolkata,West Bengal,India",
  jaipur: "Jaipur,Rajasthan,India",
  ahmedabad: "Ahmedabad,Gujarat,India",
  chandigarh: "Chandigarh,Chandigarh,India",
  lucknow: "Lucknow,Uttar Pradesh,India",
  indore: "Indore,Madhya Pradesh,India"
};

/** Country (ISO alpha-2, lowercase) -> country-level canonical location. */
const COUNTRY_LOCATIONS: Record<string, string> = {
  in: "India",
  us: "United States",
  gb: "United Kingdom",
  uk: "United Kingdom",
  ae: "United Arab Emirates",
  ca: "Canada",
  au: "Australia",
  sg: "Singapore"
};

/**
 * Aliases checked most-specific first (more words, then longer) so "greater
 * noida" wins over "noida" and "new delhi" over "delhi" when both could match.
 */
const ALIASES_BY_SPECIFICITY = Object.keys(PLACE_LOCATIONS).sort((a, b) => {
  const wordsDelta = b.split(" ").length - a.split(" ").length;
  return wordsDelta !== 0 ? wordsDelta : b.length - a.length;
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The canonical local location named in the phrase, or null if none. Uses
 * word-boundary matching so "pune" does not match "puneet" and "noida" does not
 * match "noidaville".
 */
export function detectPlaceInPhrase(phrase: string): string | null {
  const haystack = phrase.toLowerCase();
  for (const alias of ALIASES_BY_SPECIFICITY) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(haystack)) {
      return PLACE_LOCATIONS[alias];
    }
  }
  return null;
}

/** Country-level fallback location, or null for an unmapped country. */
export function countryDefaultLocation(country: string): string | null {
  return COUNTRY_LOCATIONS[country.toLowerCase()] ?? null;
}

/**
 * The location to store for a keyword, in priority order:
 *   1. an explicit location the user set (always respected),
 *   2. a place named in the phrase (the local city),
 *   3. the client's primary market (its default vantage),
 *   4. the country default ("India" for gl=in).
 * Returns null only when none applies, which leaves the check gl-only rather
 * than guessing a location that might be wrong.
 *
 * The client-market tier is what makes tracking match reality: Google localizes
 * by city, so a national keyword checked from the client's actual market is the
 * rank its real prospects see - not a misleading country-level average.
 */
export function resolveKeywordLocation(
  phrase: string,
  country: string,
  explicit?: string | null,
  clientMarket?: string | null
): string | null {
  const override = explicit?.trim();
  if (override) {
    return override;
  }
  const place = detectPlaceInPhrase(phrase);
  if (place) {
    return place;
  }
  const market = clientMarket?.trim();
  if (market) {
    return market;
  }
  return countryDefaultLocation(country);
}
