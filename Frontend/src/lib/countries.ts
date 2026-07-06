const PRIORITY_COUNTRY_CODES = ["SG", "MY"];

const FALLBACK_COUNTRY_CODES = [
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR",
  "IO", "BN", "BG", "BF", "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
  "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO",
  "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF",
  "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY",
  "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM",
  "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "LA", "KW", "KG", "LV", "LB", "LS", "LR", "LY",
  "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
  "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI",
  "NE", "NG", "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH",
  "PN", "PL", "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC",
  "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS",
  "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK",
  "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU",
  "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW",
];

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

function getSupportedRegionCodes() {
  try {
    return (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("region");
  } catch {
    return undefined;
  }
}

const supportedRegionCodes = getSupportedRegionCodes();
const countryCodes = supportedRegionCodes?.filter((code) => /^[A-Z]{2}$/.test(code)) ?? FALLBACK_COUNTRY_CODES;

export const NATIONALITY_OPTIONS = Array.from(new Set([...PRIORITY_COUNTRY_CODES, ...countryCodes]))
  .map((code) => ({ code, label: regionNames?.of(code) ?? code }))
  .sort((a, b) => {
    const pa = PRIORITY_COUNTRY_CODES.indexOf(a.code);
    const pb = PRIORITY_COUNTRY_CODES.indexOf(b.code);
    if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    return a.label.localeCompare(b.label);
  });

const COUNTRY_NAME_TO_CODE = new Map(NATIONALITY_OPTIONS.map(({ code, label }) => [label.toLowerCase(), code]));

export function toCountryCode(value: string) {
  const clean = value.trim();
  if (/^[A-Z]{2}$/.test(clean)) return clean;
  return COUNTRY_NAME_TO_CODE.get(clean.toLowerCase()) ?? clean;
}

export function toCountryName(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  const code = toCountryCode(clean);
  if (/^[A-Z]{2}$/.test(code)) return regionNames?.of(code) ?? code;
  return clean;
}

export function formatTournamentSoftwareCountry(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  const code = toCountryCode(clean);
  if (code === "SG" || clean.toLowerCase() === "singaporean/ singapore pr") {
    return "Singaporean/ Singapore PR";
  }
  return toCountryName(clean);
}
