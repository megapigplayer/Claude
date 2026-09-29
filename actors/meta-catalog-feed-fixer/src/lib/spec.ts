/**
 * Meta (Facebook / Instagram) catalog feed rules: ONE data table.
 *
 * Everything the fixer knows about Meta's catalog field specification lives here, so it can be
 * reviewed and re-verified in one place. The rule engine (rules.ts, price.ts, gtin.ts, ...)
 * contains algorithms only; limits, enums, synonym maps and patterns come from this file.
 *
 * VERIFICATION STATUS (read before trusting):
 * - Meta's own documentation (facebook.com/business/help/120325381656392 and developers.facebook.com)
 *   is NOT reachable from the sandbox this Actor was built in (egress proxy). Nothing below was
 *   read from Meta's pages.
 * - Entries without a `verify` note were cross-checked on SPEC_VERIFIED_ON against several
 *   independent third-party summaries of Meta's specification (web search; secondary sources).
 * - Entries WITH a `verify` note ("VERIFY: ...") come from the author's knowledge or from sources that
 *   disagree with each other. They are implemented conservatively: the Actor prefers the more
 *   permissive reading, reports instead of rewriting, or accepts the value untouched.
 * - Synonym maps (e.g. Hebrew "במלאי" -> "in stock") are NOT part of Meta's spec: they are the
 *   Actor's own deterministic normalisation tables (source: 'author').
 * - tests/spec.test.ts fails when SPEC_VERIFIED_ON is older than 90 days: re-verify, then bump it.
 */

export const SPEC_VERIFIED_ON = '2026-09-29';

export const SPEC_INFO = {
  version: 1,
  verifiedOn: SPEC_VERIFIED_ON,
  officialSource: 'https://www.facebook.com/business/help/120325381656392',
  officialSourceReachable: false,
  verificationMethod: 'secondary sources only (third-party guides via web search); official pages not reachable',
  effectiveFrom: '2026-09-29',
} as const;

/** All rule ids, in the order they are documented. Keep in sync with README.md (docs.test.ts checks). */
export const RULE_IDS = [
  'header-normalize',
  'row-shape',
  'whitespace',
  'html-in-text',
  'required-fields',
  'availability-enum',
  'condition-enum',
  'attribute-enums',
  'price-format',
  'sale-price',
  'sale-price-dates',
  'id-length',
  'duplicate-id',
  'spreadsheet-damage',
  'url-absolute',
  'gtin-check',
  'numeric-fields',
  'length-limits',
  'shouting',
  'promo-text',
  'variant-attributes',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export type Severity = 'error' | 'warning' | 'info';

export interface RuleInfo {
  title: string;
  /** What the rule checks and what it repairs. */
  description: string;
  /** Default severity of the problem the rule reports (a fix keeps the severity of its problem). */
  severity: Severity;
  /** true = the rule can change values; false = it only reports. */
  repairs: boolean;
  verify?: string;
}

export const RULES: Record<RuleId, RuleInfo> = {
  'header-normalize': {
    title: 'Column names',
    description: 'Normalises column headers to Meta field names: case, spaces/hyphens to underscores, "g:" prefix removed (Image Link, g:image_link -> image_link). Unknown columns are kept untouched.',
    severity: 'info',
    repairs: true,
  },
  'row-shape': {
    title: 'Row shape',
    description: 'A row with more or fewer cells than the header is reported (usually an unquoted delimiter inside a value shifted the columns). Not repaired: which cell is wrong cannot be known.',
    severity: 'error',
    repairs: false,
  },
  whitespace: {
    title: 'Whitespace and invisible characters',
    description: 'Trims values, collapses runs of spaces in single-line fields, removes control characters, BOM and non-breaking spaces; strips bidi marks from code-like fields (id, gtin, price, urls).',
    severity: 'info',
    repairs: true,
  },
  'html-in-text': {
    title: 'HTML in text fields',
    description: 'Strips HTML tags and decodes entities in title, description and short_description (Meta expects plain text; use rich_text_description for markup).',
    severity: 'warning',
    repairs: true,
    verify: 'VERIFY: whether Meta rejects or merely displays raw tags is not confirmed; stripping is lossy formatting-wise but never changes wording.',
  },
  'required-fields': {
    title: 'Required fields',
    description: 'id, title, description, availability, condition, price, link, image_link and brand must be present. A missing value is filled ONLY from the explicit "defaults" input; otherwise the row is reported as unfixable. Placeholder values (N/A, none, -) count as missing.',
    severity: 'error',
    repairs: true,
    verify: 'VERIFY: Meta lists brand as required but also accepts an MPN or GTIN in its place; a missing brand with a valid gtin/mpn is reported as a warning only.',
  },
  'availability-enum': {
    title: 'Availability values',
    description: 'Maps synonyms (instock, In Stock, OutOfStock, schema.org URLs, Hebrew, German, French, Spanish, 1/0/yes/no ...) to Meta\'s values; anything else is reported.',
    severity: 'error',
    repairs: true,
  },
  'condition-enum': {
    title: 'Condition values',
    description: 'Maps synonyms (New, brand new, pre-owned, refurbished ..., Hebrew and other languages) to new / refurbished / used; anything else is reported.',
    severity: 'error',
    repairs: true,
  },
  'attribute-enums': {
    title: 'gender and age_group values',
    description: 'Maps common synonyms to gender (female/male/unisex) and age_group (adult/all ages/infant/kids/newborn/teen/toddler); unknown values are reported.',
    severity: 'error',
    repairs: true,
  },
  'price-format': {
    title: 'Price format',
    description: 'Normalises price to "9.99 USD": decimal comma, thousands separators, currency symbols and Hebrew shekel forms, lower-case or missing currency (from defaults.currency). Ranges, zero/negative prices and ambiguous separators are reported, never guessed.',
    severity: 'error',
    repairs: true,
  },
  'sale-price': {
    title: 'Sale price',
    description: 'sale_price gets the same normalisation as price and must not be higher than price or use another currency. A bad sale price can only be removed with clearInvalidOptional.',
    severity: 'error',
    repairs: true,
    verify: 'VERIFY: exact Meta behaviour for sale_price >= price is not confirmed; equality is accepted.',
  },
  'sale-price-dates': {
    title: 'Sale date range',
    description: 'sale_price_effective_date must be two ISO 8601 date-times with time zone separated by "/", start before end. Reported (a time zone cannot be guessed); removable with clearInvalidOptional.',
    severity: 'warning',
    repairs: true,
  },
  'id-length': {
    title: 'ID length and content',
    description: 'id must be at most 100 characters. IDs are never truncated or rewritten (they must match your pixel/API content ids).',
    severity: 'error',
    repairs: false,
  },
  'duplicate-id': {
    title: 'Duplicate IDs',
    description: 'Each id may appear once. Exact duplicate rows are removed (duplicateIds=remove-exact), later duplicates can be renamed with a suffix (rename) or only reported (flag). Duplicates with different content are always reported.',
    severity: 'error',
    repairs: true,
  },
  'spreadsheet-damage': {
    title: 'Spreadsheet damage',
    description: 'Values such as 4.00638E+12 or 4006381333931.0 in id, gtin or mpn come from a spreadsheet number format. ".0" floats are repaired, scientific notation is reported (the lost digits cannot be recovered).',
    severity: 'error',
    repairs: true,
  },
  'url-absolute': {
    title: 'Absolute URLs',
    description: 'link, image_link and additional_image_link must be absolute http(s) URLs. Repairs: protocol-relative and scheme-less URLs get https, relative URLs are resolved against defaults.baseUrl, spaces and non-ASCII characters are percent-encoded.',
    severity: 'error',
    repairs: true,
    verify: 'VERIFY: the 2000 character URL limit is from the author\'s knowledge; image format/size cannot be checked offline.',
  },
  'gtin-check': {
    title: 'GTIN check digits',
    description: 'gtin must be 8, 12, 13 or 14 digits with a valid GS1 check digit. Leading zeros dropped by spreadsheets are restored when that makes the check digit valid. A wrong check digit is never "corrected" (reported with the expected digit; removable with clearInvalidOptional).',
    severity: 'error',
    repairs: true,
  },
  'numeric-fields': {
    title: 'Integer fields',
    description: 'quantity_to_sell_on_facebook and inventory must be non-negative integers ("12.0" and "1,200" are repaired).',
    severity: 'error',
    repairs: true,
    verify: 'VERIFY: field semantics are from the author\'s knowledge.',
  },
  'length-limits': {
    title: 'Length limits',
    description: 'Over-long title, description, brand, custom labels ... are cut at a word boundary (never inside an emoji or letter+mark cluster); ids and URLs are never cut. Soft limits (title 150, description 5000) only warn.',
    severity: 'warning',
    repairs: true,
    verify: 'VERIFY: title/description limits differ between Meta pages and third-party guides (150 vs 200, 5000 vs 9999); hard limits use the larger value.',
  },
  shouting: {
    title: 'ALL-CAPS text',
    description: 'Titles and descriptions written entirely in capitals are reported (Meta does not support them). Never changed automatically.',
    severity: 'warning',
    repairs: false,
  },
  'promo-text': {
    title: 'Promotional text in titles',
    description: 'Titles containing sale/discount/free-shipping wording, prices, phone numbers or "!!" are reported (English and Hebrew patterns). Never changed automatically.',
    severity: 'warning',
    repairs: false,
    verify: 'VERIFY: the exact list of disallowed promotional phrases is not published as a list; the patterns here are a heuristic.',
  },
  'variant-attributes': {
    title: 'Variant attributes',
    description: 'Rows that share an item_group_id should differ in at least one of color, size, pattern, material, gender or age_group; rows without any of them are reported.',
    severity: 'warning',
    repairs: false,
    verify: 'VERIFY: Meta\'s exact variant requirements are from the author\'s knowledge.',
  },
};

/** Required fields (Commerce Manager catalog). */
export const REQUIRED_FIELDS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'] as const;

export type FieldKind = 'code' | 'text' | 'multiline' | 'url' | 'urlList' | 'enum' | 'price' | 'dateRange' | 'gtin' | 'int' | 'label' | 'other';

export interface FieldSpec {
  kind: FieldKind;
  /** Hard limit in Unicode code points. */
  maxLength?: number;
  /** Warning threshold in code points (no repair). */
  softMaxLength?: number;
  /** Maximum number of URLs in a list field. */
  maxUrls?: number;
  verify?: string;
}

const VERIFY_LIMIT = 'VERIFY: limit from the author\'s knowledge, not confirmed by a second source.';

/**
 * Fields the fixer knows. Columns not listed here are passed through untouched (only whitespace is
 * cleaned): Meta accepts many more fields (shipping, video, app links, ...) that this Actor does not police.
 */
export const FIELDS: Record<string, FieldSpec> = {
  id: { kind: 'code', maxLength: 100 },
  title: {
    kind: 'text',
    maxLength: 200,
    softMaxLength: 150,
    verify: 'VERIFY: sources disagree (150 vs 200 characters). Hard limit 200, warning above 150.',
  },
  description: {
    kind: 'multiline',
    maxLength: 9999,
    softMaxLength: 5000,
    verify: 'VERIFY: older Meta pages and some guides still say 5000 characters; hard limit 9999, warning above 5000.',
  },
  rich_text_description: { kind: 'multiline', maxLength: 9999, verify: VERIFY_LIMIT },
  short_description: { kind: 'text' },
  availability: { kind: 'enum' },
  condition: { kind: 'enum' },
  price: { kind: 'price' },
  sale_price: { kind: 'price' },
  sale_price_effective_date: { kind: 'dateRange' },
  link: { kind: 'url', maxLength: 2000, verify: VERIFY_LIMIT },
  image_link: { kind: 'url', maxLength: 2000, verify: VERIFY_LIMIT },
  additional_image_link: { kind: 'urlList', maxUrls: 20 },
  brand: { kind: 'text', maxLength: 100, verify: VERIFY_LIMIT },
  gtin: { kind: 'gtin' },
  mpn: { kind: 'code', maxLength: 100, verify: VERIFY_LIMIT },
  item_group_id: { kind: 'code', maxLength: 100, verify: VERIFY_LIMIT },
  gender: { kind: 'enum' },
  age_group: { kind: 'enum' },
  color: { kind: 'label', maxLength: 200, verify: VERIFY_LIMIT },
  size: { kind: 'label', maxLength: 200, verify: VERIFY_LIMIT },
  material: { kind: 'label', maxLength: 200, verify: VERIFY_LIMIT },
  pattern: { kind: 'label', maxLength: 100, verify: VERIFY_LIMIT },
  product_type: { kind: 'label', maxLength: 750, verify: VERIFY_LIMIT },
  google_product_category: { kind: 'other' },
  fb_product_category: { kind: 'other' },
  custom_label_0: { kind: 'label', maxLength: 100, verify: VERIFY_LIMIT },
  custom_label_1: { kind: 'label', maxLength: 100, verify: VERIFY_LIMIT },
  custom_label_2: { kind: 'label', maxLength: 100, verify: VERIFY_LIMIT },
  custom_label_3: { kind: 'label', maxLength: 100, verify: VERIFY_LIMIT },
  custom_label_4: { kind: 'label', maxLength: 100, verify: VERIFY_LIMIT },
  quantity_to_sell_on_facebook: { kind: 'int', verify: 'VERIFY: field semantics from the author\'s knowledge.' },
  inventory: { kind: 'int', verify: 'VERIFY: field semantics from the author\'s knowledge.' },
  // Known names without checks (recognised for header normalisation only):
  availability_date: { kind: 'other' },
  expiration_date: { kind: 'other' },
  shipping: { kind: 'other' },
  shipping_weight: { kind: 'other' },
  status: { kind: 'other' },
  visibility: { kind: 'other' },
  product_tags: { kind: 'other' },
  return_policy_days: { kind: 'other' },
  origin_country: { kind: 'other' },
  manufacturer_info: { kind: 'other' },
  style: { kind: 'other' },
  size_system: { kind: 'other' },
  size_type: { kind: 'other' },
};

/** Fields whose values are codes/URLs: invisible bidi marks are stripped there (spreadsheet exports add them around numbers). */
export const CODE_LIKE_FIELDS: readonly string[] = ['id', 'gtin', 'mpn', 'item_group_id', 'price', 'sale_price', 'sale_price_effective_date', 'link', 'image_link', 'additional_image_link', 'availability', 'condition', 'gender', 'age_group', 'quantity_to_sell_on_facebook', 'inventory'];

/** Fields where line breaks are meaningful and runs of spaces are only trimmed at the ends. */
export const MULTILINE_FIELDS: readonly string[] = ['description', 'rich_text_description'];

/** Fields whose HTML is stripped (rich_text_description is meant to carry markup). */
export const HTML_STRIP_FIELDS: readonly string[] = ['title', 'description', 'short_description'];

/** Variant attributes: rows sharing an item_group_id should differ in at least one (VERIFY). */
export const VARIANT_ATTRIBUTES: readonly string[] = ['color', 'size', 'pattern', 'material', 'gender', 'age_group'];

/** Values that mean "nothing" (treated as missing for brand and cleared for gtin/mpn). Matched on the compact key; a value made only of punctuation counts too. */
export const PLACEHOLDER_VALUES: readonly string[] = ['n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'tbd', 'tba', 'nan', 'not applicable', 'אין', 'לא ידוע'];

/** Meta enum data: canonical values, extra accepted values, and the Actor's own synonym lists. */
export interface EnumSpec {
  /** Values documented for the field (the repair targets). */
  values: readonly string[];
  /** Accepted as-is (only case/space normalised), never offered as a repair target. */
  acceptedExtra?: readonly string[];
  /**
   * canonical value -> phrases that mean it (high confidence: applied as a normal repair).
   * Phrases are matched on their compact key (lower case, accents/marks and everything except letters and
   * digits removed), so "In Stock", "in_stock" and "InStock" are one entry. A schema.org URL prefix is removed first.
   */
  synonyms: Record<string, readonly string[]>;
  /** canonical value -> phrases with a looser meaning: applied, but reported as a warning to review. */
  heuristic: Record<string, readonly string[]>;
  verify?: string;
}

export const AVAILABILITY: EnumSpec = {
  values: ['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'],
  acceptedExtra: ['pending', 'mark_as_sold'],
  verify: 'VERIFY: "pending" and "mark_as_sold" appear in Meta\'s Graph API enum in the author\'s recollection but not in the third-party summaries; they are accepted untouched.',
  synonyms: {
    'in stock': [
      'in stock', 'instock', 'in_stock', 'available', 'avail', 'y', 'yes', 'true', '1', 'available now', 'ready to ship', 'ships immediately',
      'immediately available', 'on stock', 'in stock online', 'inventory available',
      'במלאי', 'יש במלאי', 'זמין', 'זמין במלאי', 'קיים במלאי', 'זמין למשלוח',
      'auf lager', 'lieferbar', 'verfügbar', 'sofort lieferbar', 'en stock', 'disponible', 'en disponibilité', 'en existencia',
      'em estoque', 'disponível', 'disponibile', 'op voorraad', 'beschikbaar', 'в наличии',
    ],
    'out of stock': [
      'out of stock', 'outofstock', 'out_of_stock', 'sold out', 'soldout', 'unavailable', 'not available', 'n', 'no', 'false', '0', 'no stock',
      'zero stock', 'oos', 'not in stock', 'out of inventory', 'currently unavailable', 'temporarily out of stock',
      'אזל', 'אזל המלאי', 'אזל מהמלאי', 'אזל מלאי', 'אין במלאי', 'לא במלאי', 'לא זמין', 'חסר במלאי', 'מלאי אזל', 'אין מלאי',
      'nicht auf lager', 'nicht lieferbar', 'ausverkauft', 'nicht verfügbar', 'rupture de stock', 'épuisé', 'indisponible',
      'agotado', 'sin stock', 'sin existencias', 'esgotado', 'sem estoque', 'esaurito', 'niet op voorraad', 'uitverkocht', 'нет в наличии',
    ],
    preorder: [
      'preorder', 'pre-order', 'pre order', 'presale', 'pre-sale', 'available for preorder', 'preorder only',
      'הזמנה מראש', 'בהזמנה מראש', 'הזמנות מראש', 'מכירה מוקדמת', 'vorbestellung', 'vorbestellbar', 'précommande', 'preventa', 'prenotazione',
    ],
    'available for order': [
      'available for order', 'available to order', 'backorder', 'back order', 'back-order', 'on backorder', 'made to order', 'special order', 'order only',
      'זמין להזמנה', 'ניתן להזמין', 'ניתן להזמנה', 'על פי הזמנה', 'להזמנה', 'под заказ',
    ],
    discontinued: [
      'discontinued', 'discontinued item', 'no longer available', 'end of life', 'eol',
      'הופסק', 'הופסק ייצורו', 'לא מיוצר', 'המוצר הופסק', 'eingestellt', 'abgekündigt', 'discontinué', 'descatalogado', 'discontinuato',
    ],
  },
  heuristic: {
    'in stock': ['limited stock', 'low stock', 'limited availability', 'few left'],
  },
};

export const CONDITION: EnumSpec = {
  values: ['new', 'refurbished', 'used'],
  acceptedExtra: ['used_like_new', 'used_good', 'used_fair', 'cpo', 'open_box_new'],
  verify: 'VERIFY: only new/refurbished/used appear in the third-party summaries; used_like_new, used_good, used_fair, cpo and open_box_new are accepted untouched (they exist in the Graph API enum in the author\'s recollection).',
  synonyms: {
    new: [
      'new', 'brand new', 'new item', 'new with tags', 'nwt', 'new in box', 'nib', 'factory new', 'new condition', 'NewCondition',
      'חדש', 'חדשה', 'חדש באריזה', 'חדש בקופסה', 'חדשים', 'neu', 'neuware', 'neuf', 'nuevo', 'nuovo', 'novo', 'nieuw', 'новый',
    ],
    used: [
      'used', 'pre-owned', 'preowned', 'second hand', 'secondhand', 'pre loved', 'used condition', 'UsedCondition',
      'משומש', 'משומשת', 'יד שנייה', 'יד שניה', 'משומשים', 'gebraucht', 'occasion', 'usado', 'usato', 'gebruikt', 'seminovo', 'б/у',
    ],
    refurbished: [
      'refurbished', 'refurb', 'renewed', 'reconditioned', 'remanufactured', 'certified refurbished', 'RefurbishedCondition',
      'מחודש', 'מחודשת', 'משופץ', 'generalüberholt', 'aufbereitet', 'reconditionné', 'remis à neuf', 'reacondicionado', 'ricondizionato', 'recondicionado', 'gereviseerd', 'восстановленный',
    ],
  },
  heuristic: {
    new: ['unused'],
    used: ['like new', 'almost new', 'open box', 'good condition'],
  },
};

export const GENDER: EnumSpec = {
  values: ['female', 'male', 'unisex'],
  synonyms: {
    female: [
      'female', 'f', 'woman', 'women', "women's", 'womens', 'ladies', 'lady', 'damen', 'femme', 'mujer', 'donna', 'dames', 'femenino', 'femminile',
      'נשים', 'אישה', 'נקבה', 'לנשים', 'נשי',
    ],
    male: [
      'male', 'm', 'man', 'men', "men's", 'mens', 'gentlemen', 'herren', 'homme', 'hombre', 'uomo', 'heren', 'masculino', 'maschile',
      'גברים', 'גבר', 'זכר', 'לגברים', 'גברי',
    ],
    unisex: ['unisex', 'uni', 'both', 'everyone', 'mixed', 'gender neutral', 'neutral', 'יוניסקס', 'לכולם', 'שניהם'],
  },
  heuristic: {},
};

export const AGE_GROUP: EnumSpec = {
  values: ['adult', 'all ages', 'infant', 'kids', 'newborn', 'teen', 'toddler'],
  synonyms: {
    adult: ['adult', 'adults', 'erwachsene', 'adulte', 'adulto', 'מבוגרים', 'מבוגר'],
    'all ages': ['all ages', 'all', 'כל הגילאים', 'כל הגילים'],
    teen: ['teen', 'teens', 'teenager', 'teenagers', 'adolescent', 'נוער', 'נערים', 'בני נוער'],
    kids: ['kid', 'kids', 'child', 'children', 'kinder', 'enfants', 'ninos', 'ילדים', 'ילד', 'ילדה', 'לילדים'],
    toddler: ['toddler', 'toddlers', 'פעוט', 'פעוטות', 'לפעוטות'],
    infant: ['infant', 'infants', 'תינוק', 'תינוקות', 'לתינוקות'],
    newborn: ['newborn', 'newborns', 'new born', 'יילוד', 'ילודים'],
  },
  heuristic: {
    infant: ['baby', 'babies'],
    kids: ['youth', 'boys', 'girls', 'junior', 'לבנים', 'לבנות'],
  },
};

/** Enum fields by name. */
export const ENUM_FIELDS: Record<'availability' | 'condition' | 'gender' | 'age_group', EnumSpec> = {
  availability: AVAILABILITY,
  condition: CONDITION,
  gender: GENDER,
  age_group: AGE_GROUP,
};

/**
 * ISO 4217 currency codes (active in 2026). Bulgarian lev, Croatian kuna etc. follow the ISO list at the
 * time of writing: HRK is retired (euro since 2023) and therefore absent.
 */
export const ISO_4217: readonly string[] = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS',
  'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG',
];

/** ISO 4217 minor units that are not 2. Independent oracle in the tests: Intl.NumberFormat. */
export const MINOR_UNITS_ZERO: readonly string[] = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
export const MINOR_UNITS_THREE: readonly string[] = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

/**
 * Currency symbols and words -> ISO code (currency -> tokens). A token is matched with case, dots, spaces and
 * quotes removed ("ש\"ח", "ש״ח" and "שח" are one token). "$", "kr", "Rs" and "¥" are ambiguous and live in
 * AMBIGUOUS_SYMBOLS: they only resolve through an explicit defaults.currency.
 */
export const CURRENCY_TOKENS: Record<string, readonly string[]> = {
  EUR: ['€', 'euro', 'euros', 'אירו', 'יורו'],
  GBP: ['£', 'pound', 'pounds', 'לישט'],
  ILS: ['₪', 'nis', 'ש"ח', 'שח', 'שקל', 'שקלים', 'שקל חדש', 'שקלים חדשים'],
  INR: ['₹'],
  KRW: ['₩'],
  RUB: ['₽', 'руб'],
  TRY: ['₺'],
  VND: ['₫'],
  THB: ['฿'],
  UAH: ['₴'],
  PHP: ['₱'],
  NGN: ['₦'],
  CRC: ['₡'],
  PYG: ['₲'],
  KZT: ['₸'],
  AZN: ['₼'],
  GEL: ['₾'],
  PLN: ['zł', 'zl'],
  CZK: ['kč', 'kc'],
  RON: ['lei'],
  BGN: ['лв'],
  CHF: ['sfr', 'fr'],
  BRL: ['r$'],
  USD: ['us$'],
  AUD: ['a$', 'au$'],
  CAD: ['c$', 'ca$', 'can$'],
  NZD: ['nz$'],
  HKD: ['hk$'],
  SGD: ['s$', 'sg$'],
  MXN: ['mx$', 'mxn$'],
  TWD: ['nt$'],
  JPY: ['円'],
  CNY: ['元', 'rmb'],
};

/** Ambiguous symbols (compact form) -> currencies they can stand for (an explicit defaults.currency must be one of them). */
export const AMBIGUOUS_SYMBOLS: Record<string, readonly string[]> = {
  $: ['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'MXN', 'ARS', 'CLP', 'COP', 'UYU', 'BRL', 'TWD', 'BSD', 'BBD', 'BZD', 'BMD', 'BND', 'DOP', 'FJD', 'GYD', 'JMD', 'KYD', 'LRD', 'NAD', 'SBD', 'SRD', 'TTD', 'XCD', 'CUP', 'PHP'],
  '¥': ['JPY', 'CNY'],
  '￥': ['JPY', 'CNY'],
  kr: ['SEK', 'NOK', 'DKK', 'ISK'],
  rs: ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
};

/** Zero-width / invisible characters removed everywhere (BOM, zero width space/joiners are NOT removed: they matter in some scripts). */
export const BOM = '\uFEFF';

/** Bidi controls stripped from code-like fields. */
export const BIDI_MARKS_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;

/** Promotional / policy patterns for titles: the Actor only REPORTS these. `re` uses the u flag. */
export interface PromoPattern {
  id: string;
  re: RegExp;
  label: string;
}

const NB = '(?<![\\p{L}\\p{N}_])';
const NA = '(?![\\p{L}\\p{N}_])';
const words = (alt: string): RegExp => new RegExp(`${NB}(?:${alt})${NA}`, 'iu');

export const PROMO_PATTERNS: readonly PromoPattern[] = [
  { id: 'discount-percent', re: /(?:\d{1,3}\s?%\s?(?:off|discount|הנחה)|%\s?off|up\s+to\s+\d{1,3}\s?%)/iu, label: 'discount percentage' },
  {
    id: 'sale-wording',
    re: words('on\\s+sale|sale|clearance|discount|special\\s+offer|limited\\s+(?:time|offer)|best\\s+price|lowest\\s+price|best\\s+seller|bestseller|hot\\s+(?:deal|item)|buy\\s+now|shop\\s+now|order\\s+now|click\\s+here|free\\s+gift|מבצע|במבצע|הנחה|הנחות|מחיר\\s+מיוחד|במחיר\\s+מיוחד|קנה\\s+עכשיו|הזמן\\s+עכשיו|מתנה\\s+חינם|הכי\\s+נמכר|מוצר\\s+מבוקש'),
    label: 'sale wording',
  },
  { id: 'free-shipping', re: words('free\\s+(?:shipping|delivery|postage)|משלוח\\s+(?:ב)?חינם|versandkostenfrei|livraison\\s+gratuite|env[ií]o\\s+gratis'), label: 'free shipping' },
  { id: 'price-in-text', re: /(?:[$€£₪]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£₪]|usd\b|eur\b|gbp\b|ils\b|nis\b|ש"ח|שח))/iu, label: 'price' },
  { id: 'phone-number', re: /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3}[\s.-]\d{3,4}(?!\d)/u, label: 'phone number' },
  { id: 'excess-punctuation', re: /[!?]{2,}|(?:!\s*){3,}/u, label: 'repeated punctuation' },
];

/** Return every VERIFY marker in this table as `path: note`, for the README/limitations and the tests. */
export function listVerifyMarkers(): string[] {
  const out: string[] = [];
  for (const [id, r] of Object.entries(RULES)) if (r.verify) out.push(`rules.${id}: ${r.verify}`);
  for (const [name, f] of Object.entries(FIELDS)) if (f.verify) out.push(`fields.${name}: ${f.verify}`);
  for (const [name, e] of Object.entries(ENUM_FIELDS)) if (e.verify) out.push(`enums.${name}: ${e.verify}`);
  return out;
}
