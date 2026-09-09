import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

/**
 * The country selector's option list — every country libphonenumber-js
 * itself supports, so this can never drift out of sync with what
 * normalizeInternationalPhone() (lib/domain/students.ts) actually accepts.
 * A hand-maintained subset would eventually diverge from the library's own
 * supported list; deriving it from getCountries() instead makes "every
 * libphonenumber-js country is selectable" true by construction, not by
 * upkeep.
 *
 * Display names come from the standard Intl.DisplayNames API — built into
 * the JS runtime, so no separate country-name dataset needs maintaining
 * (or shipping) either. This does mean this module now carries
 * libphonenumber-js's real metadata into the client bundle for
 * student-form.tsx's dropdown, unlike the previous hand-curated list —
 * an accepted, explained tradeoff for guaranteeing full parity with the
 * library's supported countries.
 */

export type PhoneCountryOption = {
  code: CountryCode;
  name: string;
  callingCode: string;
};

export const DEFAULT_PHONE_COUNTRY: CountryCode = "IN";

function buildPhoneCountryOptions(): PhoneCountryOption[] {
  const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

  const options = getCountries().map((code) => ({
    code,
    name: regionNames.of(code) ?? code,
    callingCode: getCountryCallingCode(code),
  }));

  options.sort((a, b) => a.name.localeCompare(b.name));

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
