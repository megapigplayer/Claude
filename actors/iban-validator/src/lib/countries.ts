/**
 * IBAN country table: total length per ISO 13616 country code, plus the national BBAN
 * structure where this Actor knows it (used for the character-class check and for the
 * bank / branch / account extraction).
 *
 * PROVENANCE / VERIFICATION: written from the SWIFT IBAN Registry as remembered by the author in an
 * offline sandbox (no access to swift.com), then cross-checked three independent ways:
 * (1) test/iban.test.ts validates one registry example IBAN per country through the real ISO 7064
 *     mod-97 checksum and against this table's length and BBAN layout;
 * (2) test/oracle.test.ts compares every country's length, per-position character classes and
 *     bank/branch positions with the independently maintained `ibantools@4.5.4` package (dev
 *     dependency only, never shipped) and fuzzes valid/invalid IBANs against its validator;
 * (3) for every country with a BBAN spec the spec's total length equals `length - 4`.
 * Still NOT verified: a diff against the current registry PDF from swift.com (no network access),
 * and the role labels (bank/branch/account) for countries where ibantools defines no identifier.
 * Countries that ibantools also lists with `IBANRegistry: true` but which are deliberately not
 * included: the French overseas territories and Aland (their IBANs use the FR / FI prefix, the
 * territory's own ISO code is not an IBAN prefix). Non-registry "experimental" codes are not supported.
 *
 * Layout policy: never stricter than the independent oracle. Where the registry and ibantools disagree
 * on a character class (GE, IE, PK, TR) the more permissive class is used, so a real IBAN is never
 * rejected for its layout; the mod-97 checksum still catches virtually every typo.
 *
 * BBAN spec syntax: space-separated tokens "<length><class>[:<role>]"
 *   class: n = digits, a = upper-case letters, c = letters or digits
 *   role : bank | branch | account | check   (omitted = character class is checked but the part is not extracted)
 */

export interface CountryInfo {
  code: string;
  name: string;
  /** Total IBAN length including the 2-letter country code and 2 check digits. */
  length: number;
  /** BBAN structure spec (see file header); undefined = only length + checksum are checked. */
  bban?: string;
}

// [code, name, total length, optional BBAN spec]
type Row = readonly [string, string, number, string?];

const ROWS: readonly Row[] = [
  ['AD', 'Andorra', 24, '4n:bank 4n:branch 12c:account'],
  ['AE', 'United Arab Emirates', 23, '3n:bank 16n:account'],
  ['AL', 'Albania', 28, '3n:bank 4n:branch 1n:check 16c:account'],
  ['AT', 'Austria', 20, '5n:bank 11n:account'],
  ['AZ', 'Azerbaijan', 28, '4a:bank 20c:account'],
  ['BA', 'Bosnia and Herzegovina', 20, '3n:bank 3n:branch 8n:account 2n:check'],
  ['BE', 'Belgium', 16, '3n:bank 7n:account 2n:check'],
  ['BG', 'Bulgaria', 22, '4a:bank 4n:branch 2n 8c:account'],
  ['BH', 'Bahrain', 22, '4a:bank 14c:account'],
  ['BR', 'Brazil', 29, '23n 1a 1c'],
  ['BY', 'Belarus', 28, '4c:bank 4n:branch 16c:account'],
  ['CH', 'Switzerland', 21, '5n:bank 12c:account'],
  ['CR', 'Costa Rica', 22, '18n'],
  ['CY', 'Cyprus', 28, '3n:bank 5n:branch 16c:account'],
  ['CZ', 'Czechia', 24, '4n:bank 16n:account'],
  ['DE', 'Germany', 22, '8n:bank 10n:account'],
  ['DK', 'Denmark', 18, '4n:bank 9n:account 1n:check'],
  ['DO', 'Dominican Republic', 28, '4a 20n'],
  ['EE', 'Estonia', 20, '2n:bank 2n:branch 11n:account 1n:check'],
  ['EG', 'Egypt', 29, '25n'],
  ['ES', 'Spain', 24, '4n:bank 4n:branch 2n:check 10n:account'],
  ['FI', 'Finland', 18, '3n:bank 3n 7n:account 1n:check'],
  ['FO', 'Faroe Islands', 18, '4n:bank 9n:account 1n:check'],
  ['FR', 'France', 27, '5n:bank 5n:branch 11c:account 2n:check'],
  ['GB', 'United Kingdom', 22, '4a:bank 6n:branch 8n:account'],
  ['GE', 'Georgia', 22, '2c:bank 16n:account'],
  ['GI', 'Gibraltar', 23, '4a:bank 15c:account'],
  ['GL', 'Greenland', 18, '4n:bank 9n:account 1n:check'],
  ['GR', 'Greece', 27, '3n:bank 4n:branch 16c:account'],
  ['GT', 'Guatemala', 28, '24c'],
  ['HR', 'Croatia', 21, '7n:bank 10n:account'],
  ['HU', 'Hungary', 28, '3n:bank 4n:branch 1n:check 15n:account 1n:check'],
  ['IE', 'Ireland', 22, '4c:bank 6n:branch 8n:account'],
  ['IL', 'Israel', 23, '3n:bank 3n:branch 13n:account'],
  ['IQ', 'Iraq', 23, '4a 15n'],
  ['IS', 'Iceland', 26, '2n:bank 2n:branch 2n 6n:account 10n'],
  ['IT', 'Italy', 27, '1a:check 5n:bank 5n:branch 12c:account'],
  ['JO', 'Jordan', 30, '4a:bank 4n:branch 18c:account'],
  ['KW', 'Kuwait', 30, '4a:bank 22c:account'],
  ['KZ', 'Kazakhstan', 20, '3n:bank 13c:account'],
  ['LB', 'Lebanon', 28, '4n:bank 20c:account'],
  ['LC', 'Saint Lucia', 32, '4a 24c'],
  ['LI', 'Liechtenstein', 21, '5n:bank 12c:account'],
  ['LT', 'Lithuania', 20, '5n:bank 11n:account'],
  ['LU', 'Luxembourg', 20, '3n:bank 13c:account'],
  ['LV', 'Latvia', 21, '4a:bank 13c:account'],
  ['LY', 'Libya', 25, '21n'],
  ['MC', 'Monaco', 27, '5n:bank 5n:branch 11c:account 2n:check'],
  ['MD', 'Moldova', 24, '20c'],
  ['ME', 'Montenegro', 22, '3n:bank 13n:account 2n:check'],
  ['MK', 'North Macedonia', 19, '3n:bank 10c:account 2n:check'],
  ['MN', 'Mongolia', 20, '16n'],
  ['MR', 'Mauritania', 27, '23n'],
  ['MT', 'Malta', 31, '4a:bank 5n:branch 18c:account'],
  ['MU', 'Mauritius', 30, '4a 19n 3a'],
  ['NI', 'Nicaragua', 28, '4a 20n'],
  ['NL', 'Netherlands', 18, '4a:bank 10n:account'],
  ['NO', 'Norway', 15, '4n:bank 6n:account 1n:check'],
  ['OM', 'Oman', 23, '3n 16c'],
  ['PK', 'Pakistan', 24, '4c:bank 16c:account'],
  ['PL', 'Poland', 28, '3n:bank 4n:branch 1n:check 16n:account'],
  ['PS', 'Palestine, State of', 29, '4c 21n'],
  ['PT', 'Portugal', 25, '4n:bank 4n:branch 11n:account 2n:check'],
  ['QA', 'Qatar', 29, '4a:bank 21c:account'],
  ['RO', 'Romania', 24, '4a:bank 16c:account'],
  ['RS', 'Serbia', 22, '3n:bank 13n:account 2n:check'],
  ['RU', 'Russia', 33, '14n 15c'],
  ['SA', 'Saudi Arabia', 24, '2n:bank 18c:account'],
  ['SC', 'Seychelles', 31, '4a 20n 3a'],
  ['SD', 'Sudan', 18, '14n'],
  ['SE', 'Sweden', 24, '3n:bank 16n:account 1n:check'],
  ['SI', 'Slovenia', 19, '2n:bank 3n:branch 8n:account 2n:check'],
  ['SK', 'Slovakia', 24, '4n:bank 16n:account'],
  ['SM', 'San Marino', 27, '1a:check 5n:bank 5n:branch 12c:account'],
  ['SO', 'Somalia', 23, '19n'],
  ['ST', 'Sao Tome and Principe', 25, '21n'],
  ['SV', 'El Salvador', 28, '4a 20n'],
  ['TL', 'Timor-Leste', 23, '19n'],
  ['TN', 'Tunisia', 24, '20n'],
  ['TR', 'Turkey', 26, '5n:bank 1c 16c:account'],
  ['UA', 'Ukraine', 29, '6n:bank 19c:account'],
  ['VA', 'Vatican City State', 22, '18n'],
  ['VG', 'Virgin Islands, British', 24, '4c 16n'],
  ['XK', 'Kosovo', 20, '2n:bank 2n:branch 10n:account 2n:check'],
  ['YE', 'Yemen', 30, '4a 4n 18c'],
];

export const COUNTRIES: Readonly<Record<string, CountryInfo>> = Object.freeze(
  Object.fromEntries(ROWS.map(([code, name, length, bban]) => [code, { code, name, length, bban }])),
);

export type CharClass = 'n' | 'a' | 'c';
export type PartRole = 'bank' | 'branch' | 'account' | 'check';

export interface BbanPart {
  length: number;
  charClass: CharClass;
  role?: PartRole;
}

export function parseBbanSpec(spec: string): BbanPart[] {
  return spec.split(/\s+/).map((token) => {
    const m = /^(\d+)([nac])(?::(bank|branch|account|check))?$/.exec(token);
    if (!m) throw new Error(`Invalid BBAN spec token "${token}" in "${spec}"`);
    return { length: Number(m[1]), charClass: m[2] as CharClass, role: m[3] as PartRole | undefined };
  });
}

const PARTS_CACHE = new Map<string, BbanPart[] | null>();

/** Parsed BBAN structure for a country, or null when the country has no spec. */
export function getBbanParts(countryCode: string): BbanPart[] | null {
  const cached = PARTS_CACHE.get(countryCode);
  if (cached !== undefined) return cached;
  const spec = COUNTRIES[countryCode]?.bban;
  const parts = spec ? parseBbanSpec(spec) : null;
  PARTS_CACHE.set(countryCode, parts);
  return parts;
}

export const CHAR_CLASS_PATTERN: Readonly<Record<CharClass, RegExp>> = {
  n: /^[0-9]$/,
  a: /^[A-Z]$/,
  c: /^[A-Z0-9]$/,
};

export const CHAR_CLASS_LABEL: Readonly<Record<CharClass, string>> = {
  n: 'a digit',
  a: 'a letter',
  c: 'a letter or digit',
};
