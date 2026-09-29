/**
 * Resolves one `locations` input entry (a built-in city name, or an object with coordinates) to a
 * `@hebcal/core` `Location` instance. Never throws: returns a result object with a `reasonCode` for
 * anything unusable, exactly like the other list-of-items Actors in this repo.
 *
 * City names are resolved with `Location.lookup()`, which ships ~65 "classic" Hebcal cities built
 * into `@hebcal/core` itself (Jerusalem, Tel Aviv, New York, ... - see README for the full list).
 * TOP60.md 4.4 notes that a full GeoNames city search needs a database file this repo does not have
 * offline; this built-in list plus caller-supplied coordinates is the v1 "bundled list".
 */
import { Location } from '@hebcal/core';

export interface LocationInfo {
  name: string;
  latitude: number;
  longitude: number;
  tzid: string;
  elevation: number;
  israel: boolean;
}

export type ResolveResult =
  | { ok: true; location: Location; info: LocationInfo }
  | { ok: false; code: string; reason: string };

function err(code: string, reason: string): ResolveResult {
  return { ok: false, code, reason };
}

function toLocationInfo(location: Location, fallbackName: string): LocationInfo {
  return {
    name: location.getName() ?? fallbackName,
    latitude: location.getLatitude(),
    longitude: location.getLongitude(),
    tzid: location.getTzid(),
    elevation: location.getElevation(),
    israel: location.getIsrael(),
  };
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when the runtime's ICU data recognizes this as a real IANA/Olson timezone id. */
export function isValidTzid(tzid: string): boolean {
  if (tzid === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

function resolveCustom(obj: Record<string, unknown>): ResolveResult {
  const latitude = toNumber(obj.latitude);
  if (latitude === null || latitude < -90 || latitude > 90) {
    return err('BAD_LATITUDE', '"latitude" must be a number between -90 and 90.');
  }
  const longitude = toNumber(obj.longitude);
  if (longitude === null || longitude < -180 || longitude > 180) {
    return err('BAD_LONGITUDE', '"longitude" must be a number between -180 and 180.');
  }
  const tzid = typeof obj.tzid === 'string' ? obj.tzid.trim() : '';
  if (!isValidTzid(tzid)) {
    return err('BAD_TZID', '"tzid" must be a real IANA/Olson timezone id, e.g. "Asia/Jerusalem" or "America/New_York".');
  }
  let elevation = 0;
  if (obj.elevation !== undefined && obj.elevation !== null) {
    const e = toNumber(obj.elevation);
    if (e === null || e < 0) return err('BAD_ELEVATION', '"elevation" must be a number >= 0 (meters).');
    elevation = e;
  }
  const israel = typeof obj.israel === 'boolean' ? obj.israel : false;
  const providedName = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim() : null;
  const name = providedName ?? `${latitude},${longitude}`;
  const location = new Location(latitude, longitude, israel, tzid, name, undefined, undefined, elevation);
  return { ok: true, location, info: toLocationInfo(location, name) };
}

/** Resolve one `locations` entry. Never throws. */
export function resolveLocation(raw: unknown): ResolveResult {
  if (raw === null || raw === undefined) return err('EMPTY', 'Blank location.');
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (name === '') return err('EMPTY', 'Blank location.');
    const location = Location.lookup(name);
    if (!location) {
      return err(
        'UNKNOWN_CITY',
        `"${name}" is not one of the built-in city names (e.g. "Jerusalem", "Tel Aviv", "New York"; see the README for the full list). ` +
          'Use an object with latitude/longitude/tzid instead for any other place.',
      );
    }
    return { ok: true, location, info: toLocationInfo(location, name) };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return resolveCustom(raw as Record<string, unknown>);
  return err('UNSUPPORTED_ITEM', 'A location must be a city name (string) or an object with latitude/longitude/tzid.');
}
