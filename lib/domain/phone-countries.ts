import type { CountryCode } from "libphonenumber-js";

/**
 * Plain data only — deliberately does NOT import libphonenumber-js itself
 * (only its type, which is erased at compile time). student-form.tsx is a
 * "use client" component that needs this list to render the country
 * selector; keeping it free of the runtime library means the phone-number
 * metadata never ships to the browser just to label a dropdown. The actual
 * validation library only ever runs server-side, from lib/domain/students.ts.
 */

export type PhoneCountryOption = {
  code: CountryCode;
  name: string;
  callingCode: string;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = "IN";

// A curated list relevant to this India-based training company's student
// base — not the full ISO 3166 list. India is first (and is the form's
// default); the rest are ordered alphabetically by name. Any country not
// listed here can still be entered by typing the full +<code> number —
// this list only controls the selector's options, not what
// normalizeInternationalPhone() will accept.
export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = [
  { code: "IN", name: "India", callingCode: "91" },
  { code: "AU", name: "Australia", callingCode: "61" },
  { code: "BH", name: "Bahrain", callingCode: "973" },
  { code: "BD", name: "Bangladesh", callingCode: "880" },
  { code: "CA", name: "Canada", callingCode: "1" },
  { code: "CN", name: "China", callingCode: "86" },
  { code: "FR", name: "France", callingCode: "33" },
  { code: "DE", name: "Germany", callingCode: "49" },
  { code: "HK", name: "Hong Kong", callingCode: "852" },
  { code: "ID", name: "Indonesia", callingCode: "62" },
  { code: "IE", name: "Ireland", callingCode: "353" },
  { code: "IT", name: "Italy", callingCode: "39" },
  { code: "JP", name: "Japan", callingCode: "81" },
  { code: "KE", name: "Kenya", callingCode: "254" },
  { code: "KW", name: "Kuwait", callingCode: "965" },
  { code: "MY", name: "Malaysia", callingCode: "60" },
  { code: "NP", name: "Nepal", callingCode: "977" },
  { code: "NL", name: "Netherlands", callingCode: "31" },
  { code: "NZ", name: "New Zealand", callingCode: "64" },
  { code: "NG", name: "Nigeria", callingCode: "234" },
  { code: "OM", name: "Oman", callingCode: "968" },
  { code: "PK", name: "Pakistan", callingCode: "92" },
  { code: "PH", name: "Philippines", callingCode: "63" },
  { code: "QA", name: "Qatar", callingCode: "974" },
  { code: "SA", name: "Saudi Arabia", callingCode: "966" },
  { code: "SG", name: "Singapore", callingCode: "65" },
  { code: "ZA", name: "South Africa", callingCode: "27" },
  { code: "KR", name: "South Korea", callingCode: "82" },
  { code: "ES", name: "Spain", callingCode: "34" },
  { code: "LK", name: "Sri Lanka", callingCode: "94" },
  { code: "SE", name: "Sweden", callingCode: "46" },
  { code: "CH", name: "Switzerland", callingCode: "41" },
  { code: "TH", name: "Thailand", callingCode: "66" },
  { code: "AE", name: "United Arab Emirates", callingCode: "971" },
  { code: "GB", name: "United Kingdom", callingCode: "44" },
  { code: "US", name: "United States", callingCode: "1" },
  { code: "VN", name: "Vietnam", callingCode: "84" },
];
