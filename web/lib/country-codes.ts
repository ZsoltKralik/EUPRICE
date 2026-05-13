/**
 * Maps between ISO 3166-1 alpha-2 (what our DB uses) and ISO 3166-1 numeric
 * (what world-atlas topojson uses as `feature.id`). The topojson stores codes
 * as strings, sometimes zero-padded ("040"), sometimes not ("40") — we look up
 * both forms.
 */

export const NUMERIC_TO_ALPHA2: Record<string, string> = {
  "008": "AL", "020": "AD", "040": "AT", "056": "BE", "070": "BA",
  "100": "BG", "112": "BY", "191": "HR", "196": "CY", "203": "CZ",
  "208": "DK", "233": "EE", "234": "FO", "246": "FI", "250": "FR",
  "276": "DE", "292": "GI", "300": "GR", "348": "HU", "352": "IS",
  "372": "IE", "380": "IT", "428": "LV", "438": "LI", "440": "LT",
  "442": "LU", "470": "MT", "498": "MD", "499": "ME", "528": "NL",
  "578": "NO", "616": "PL", "620": "PT", "642": "RO", "643": "RU",
  "674": "SM", "688": "RS", "703": "SK", "705": "SI", "724": "ES",
  "752": "SE", "756": "CH", "792": "TR", "804": "UA", "807": "MK",
  "826": "GB", "999": "XK",
};

// Build the reverse map. Allow stripping leading zeros for unpadded matches.
export const ALPHA2_TO_NUMERIC: Record<string, string> = Object.fromEntries(
  Object.entries(NUMERIC_TO_ALPHA2).map(([num, a2]) => [a2, num]),
);

export function numericToAlpha2(id: string | number | null | undefined): string | undefined {
  if (id === null || id === undefined) return undefined;
  const s = String(id);
  return NUMERIC_TO_ALPHA2[s] || NUMERIC_TO_ALPHA2[s.padStart(3, "0")];
}
