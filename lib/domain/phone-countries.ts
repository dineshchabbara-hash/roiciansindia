import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

/**
 * The country selector's option list.
 *
 * Names are a STATIC map, not computed from Intl.DisplayNames at runtime.
 * That was tried first and caused a real SSR/hydration mismatch: Node's
 * ICU data and a browser's ICU data can (and did, for at least "Falkland
 * Islands" vs "Falkland Islands (Islas Malvinas)") disagree on a region's
 * display name, so the exact same code running on the server during SSR
 * and again on the client during hydration produced different text for the
 * same <option>, which React/Next reports as a hydration error. Locale
 * data is explicitly NOT something two runtimes are guaranteed to agree
 * on, even for the same requested locale ("en") — only a value baked into
 * the source itself is guaranteed identical everywhere.
 *
 * COUNTRY_NAMES was generated once (from Intl.DisplayNames, as a one-time
 * authoring step, not at runtime) and is otherwise plain static data from
 * here on — every deployment renders the exact same string for a given
 * code, regardless of the runtime's ICU version or the Node/browser split.
 *
 * The code LIST itself still comes from libphonenumber-js's getCountries()
 * at module load, not from this map's keys — so if a future libphonenumber-js
 * version adds or removes a supported country, the selector automatically
 * stays in sync with what normalizeInternationalPhone() actually accepts.
 * A code getCountries() returns that isn't in COUNTRY_NAMES (only possible
 * after upgrading the library) falls back to the bare code as its label —
 * still fully static and deterministic, just less pretty until this map is
 * updated for the new code. getCountryCallingCode() is safe to call at
 * render time (unlike DisplayNames): calling codes are fixed numbering-plan
 * data baked into the library's metadata, not translated/locale-dependent
 * text, so it returns the identical string in every runtime.
 */

export type PhoneCountryOption = {
  code: CountryCode;
  name: string;
  callingCode: string;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = "IN";

// Generated once from Intl.DisplayNames(["en"], { type: "region" }) as an
// authoring step — not evaluated at runtime. Covers every code
// libphonenumber-js supported as of writing (245 entries); see the module
// comment above for what happens if the library ever adds a new one.
const COUNTRY_NAMES: Record<string, string> = {
  AC: "Ascension Island",
  AD: "Andorra",
  AE: "United Arab Emirates",
  AF: "Afghanistan",
  AG: "Antigua & Barbuda",
  AI: "Anguilla",
  AL: "Albania",
  AM: "Armenia",
  AO: "Angola",
  AR: "Argentina",
  AS: "American Samoa",
  AT: "Austria",
  AU: "Australia",
  AW: "Aruba",
  AX: "Åland Islands",
  AZ: "Azerbaijan",
  BA: "Bosnia & Herzegovina",
  BB: "Barbados",
  BD: "Bangladesh",
  BE: "Belgium",
  BF: "Burkina Faso",
  BG: "Bulgaria",
  BH: "Bahrain",
  BI: "Burundi",
  BJ: "Benin",
  BL: "St. Barthélemy",
  BM: "Bermuda",
  BN: "Brunei",
  BO: "Bolivia",
  BQ: "Caribbean Netherlands",
  BR: "Brazil",
  BS: "Bahamas",
  BT: "Bhutan",
  BW: "Botswana",
  BY: "Belarus",
  BZ: "Belize",
  CA: "Canada",
  CC: "Cocos (Keeling) Islands",
  CD: "Congo - Kinshasa",
  CF: "Central African Republic",
  CG: "Congo - Brazzaville",
  CH: "Switzerland",
  CI: "Côte d’Ivoire",
  CK: "Cook Islands",
  CL: "Chile",
  CM: "Cameroon",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  CV: "Cape Verde",
  CW: "Curaçao",
  CX: "Christmas Island",
  CY: "Cyprus",
  CZ: "Czechia",
  DE: "Germany",
  DJ: "Djibouti",
  DK: "Denmark",
  DM: "Dominica",
  DO: "Dominican Republic",
  DZ: "Algeria",
  EC: "Ecuador",
  EE: "Estonia",
  EG: "Egypt",
  EH: "Western Sahara",
  ER: "Eritrea",
  ES: "Spain",
  ET: "Ethiopia",
  FI: "Finland",
  FJ: "Fiji",
  FK: "Falkland Islands",
  FM: "Micronesia",
  FO: "Faroe Islands",
  FR: "France",
  GA: "Gabon",
  GB: "United Kingdom",
  GD: "Grenada",
  GE: "Georgia",
  GF: "French Guiana",
  GG: "Guernsey",
  GH: "Ghana",
  GI: "Gibraltar",
  GL: "Greenland",
  GM: "Gambia",
  GN: "Guinea",
  GP: "Guadeloupe",
  GQ: "Equatorial Guinea",
  GR: "Greece",
  GT: "Guatemala",
  GU: "Guam",
  GW: "Guinea-Bissau",
  GY: "Guyana",
  HK: "Hong Kong SAR China",
  HN: "Honduras",
  HR: "Croatia",
  HT: "Haiti",
  HU: "Hungary",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IM: "Isle of Man",
  IN: "India",
  IO: "British Indian Ocean Territory",
  IQ: "Iraq",
  IR: "Iran",
  IS: "Iceland",
  IT: "Italy",
  JE: "Jersey",
  JM: "Jamaica",
  JO: "Jordan",
  JP: "Japan",
  KE: "Kenya",
  KG: "Kyrgyzstan",
  KH: "Cambodia",
  KI: "Kiribati",
  KM: "Comoros",
  KN: "St. Kitts & Nevis",
  KP: "North Korea",
  KR: "South Korea",
  KW: "Kuwait",
  KY: "Cayman Islands",
  KZ: "Kazakhstan",
  LA: "Laos",
  LB: "Lebanon",
  LC: "St. Lucia",
  LI: "Liechtenstein",
  LK: "Sri Lanka",
  LR: "Liberia",
  LS: "Lesotho",
  LT: "Lithuania",
  LU: "Luxembourg",
  LV: "Latvia",
  LY: "Libya",
  MA: "Morocco",
  MC: "Monaco",
  MD: "Moldova",
  ME: "Montenegro",
  MF: "St. Martin",
  MG: "Madagascar",
  MH: "Marshall Islands",
  MK: "North Macedonia",
  ML: "Mali",
  MM: "Myanmar (Burma)",
  MN: "Mongolia",
  MO: "Macao SAR China",
  MP: "Northern Mariana Islands",
  MQ: "Martinique",
  MR: "Mauritania",
  MS: "Montserrat",
  MT: "Malta",
  MU: "Mauritius",
  MV: "Maldives",
  MW: "Malawi",
  MX: "Mexico",
  MY: "Malaysia",
  MZ: "Mozambique",
  NA: "Namibia",
  NC: "New Caledonia",
  NE: "Niger",
  NF: "Norfolk Island",
  NG: "Nigeria",
  NI: "Nicaragua",
  NL: "Netherlands",
  NO: "Norway",
  NP: "Nepal",
  NR: "Nauru",
  NU: "Niue",
  NZ: "New Zealand",
  OM: "Oman",
  PA: "Panama",
  PE: "Peru",
  PF: "French Polynesia",
  PG: "Papua New Guinea",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland",
  PM: "St. Pierre & Miquelon",
  PR: "Puerto Rico",
  PS: "Palestinian Territories",
  PT: "Portugal",
  PW: "Palau",
  PY: "Paraguay",
  QA: "Qatar",
  RE: "Réunion",
  RO: "Romania",
  RS: "Serbia",
  RU: "Russia",
  RW: "Rwanda",
  SA: "Saudi Arabia",
  SB: "Solomon Islands",
  SC: "Seychelles",
  SD: "Sudan",
  SE: "Sweden",
  SG: "Singapore",
  SH: "St. Helena",
  SI: "Slovenia",
  SJ: "Svalbard & Jan Mayen",
  SK: "Slovakia",
  SL: "Sierra Leone",
  SM: "San Marino",
  SN: "Senegal",
  SO: "Somalia",
  SR: "Suriname",
  SS: "South Sudan",
  ST: "São Tomé & Príncipe",
  SV: "El Salvador",
  SX: "Sint Maarten",
  SY: "Syria",
  SZ: "Eswatini",
  TA: "Tristan da Cunha",
  TC: "Turks & Caicos Islands",
  TD: "Chad",
  TG: "Togo",
  TH: "Thailand",
  TJ: "Tajikistan",
  TK: "Tokelau",
  TL: "Timor-Leste",
  TM: "Turkmenistan",
  TN: "Tunisia",
  TO: "Tonga",
  TR: "Türkiye",
  TT: "Trinidad & Tobago",
  TV: "Tuvalu",
  TW: "Taiwan",
  TZ: "Tanzania",
  UA: "Ukraine",
  UG: "Uganda",
  US: "United States",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VA: "Vatican City",
  VC: "St. Vincent & Grenadines",
  VE: "Venezuela",
  VG: "British Virgin Islands",
  VI: "U.S. Virgin Islands",
  VN: "Vietnam",
  VU: "Vanuatu",
  WF: "Wallis & Futuna",
  WS: "Samoa",
  XK: "Kosovo",
  YE: "Yemen",
  YT: "Mayotte",
  ZA: "South Africa",
  ZM: "Zambia",
  ZW: "Zimbabwe",
};

function buildPhoneCountryOptions(): PhoneCountryOption[] {
  const options = getCountries().map((code) => ({
    code,
    name: COUNTRY_NAMES[code] ?? code,
    callingCode: getCountryCallingCode(code),
  }));

  // Plain lexicographic comparison, not localeCompare() — localeCompare's
  // collation is itself ICU-version-dependent, which is exactly the kind
  // of cross-runtime nondeterminism this file exists to avoid. `<`/`>` on
  // strings is UTF-16 code-unit order, defined by the JS spec itself, so
  // it sorts identically on every engine.
  options.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // India is the form's default — pinned to the top rather than found
  // alphabetically, so it's always the first (and pre-selected) option.
  const indiaIndex = options.findIndex((option) => option.code === DEFAULT_PHONE_COUNTRY);
  if (indiaIndex > 0) {
    const [india] = options.splice(indiaIndex, 1);
    options.unshift(india);
  }

  return options;
}

export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = buildPhoneCountryOptions();
