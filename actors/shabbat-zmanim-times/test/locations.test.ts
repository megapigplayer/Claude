import { describe, expect, it } from 'vitest';
import { isValidTzid, resolveLocation } from '../src/lib/locations.js';

describe('resolveLocation: built-in city names', () => {
  it('resolves the three default cities with sane coordinates/tzid/israel flag', () => {
    const jlm = resolveLocation('Jerusalem');
    expect(jlm.ok).toBe(true);
    if (jlm.ok) expect(jlm.info).toMatchObject({ name: 'Jerusalem', tzid: 'Asia/Jerusalem', israel: true });

    const tlv = resolveLocation('Tel Aviv');
    if (tlv.ok) expect(tlv.info.israel).toBe(true);

    const nyc = resolveLocation('New York');
    if (nyc.ok) expect(nyc.info).toMatchObject({ tzid: 'America/New_York', israel: false });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveLocation(' jerusalem ').ok).toBe(true);
    expect(resolveLocation('JERUSALEM').ok).toBe(true);
  });

  it('an unknown city name is a clear error, never a guess', () => {
    const r = resolveLocation('Atlantis');
    expect(r).toMatchObject({ ok: false, code: 'UNKNOWN_CITY' });
    if (!r.ok) expect(r.reason).toMatch(/latitude.*longitude/i);
  });

  it('blank input', () => {
    expect(resolveLocation('')).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(resolveLocation(null)).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(resolveLocation('   ')).toMatchObject({ ok: false, code: 'EMPTY' });
  });
});

describe('resolveLocation: custom coordinate objects', () => {
  const valid = { latitude: 41.85, longitude: -87.65, tzid: 'America/Chicago' };

  it('accepts a minimal valid object with sensible defaults', () => {
    const r = resolveLocation(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.info).toMatchObject({ latitude: 41.85, longitude: -87.65, tzid: 'America/Chicago', elevation: 0, israel: false });
  });

  it('accepts an explicit name, elevation and israel flag', () => {
    const r = resolveLocation({ ...valid, name: 'My Office', elevation: 200, israel: false, tzid: 'Asia/Jerusalem', latitude: 31.8, longitude: 35.2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.info).toMatchObject({ name: 'My Office', elevation: 200 });
  });

  it.each([
    [{ ...valid, latitude: 91 }, 'BAD_LATITUDE'],
    [{ ...valid, latitude: -91 }, 'BAD_LATITUDE'],
    [{ ...valid, latitude: 'north' }, 'BAD_LATITUDE'],
    [{ ...valid, longitude: 181 }, 'BAD_LONGITUDE'],
    [{ ...valid, tzid: 'Not/A_Timezone' }, 'BAD_TZID'],
    [{ ...valid, tzid: '' }, 'BAD_TZID'],
    [{ latitude: 41.85, longitude: -87.65 }, 'BAD_TZID'], // missing tzid entirely
    [{ ...valid, elevation: -5 }, 'BAD_ELEVATION'],
  ])('rejects %j with %s', (obj, code) => {
    expect(resolveLocation(obj)).toMatchObject({ ok: false, code });
  });

  it('an object without latitude/longitude/tzid is rejected, not silently guessed', () => {
    expect(resolveLocation({ city: 'Nowhere' }).ok).toBe(false);
  });
});

describe('resolveLocation: unsupported types', () => {
  it('an array or a number is UNSUPPORTED_ITEM', () => {
    expect(resolveLocation([1, 2])).toMatchObject({ ok: false, code: 'UNSUPPORTED_ITEM' });
    expect(resolveLocation(42)).toMatchObject({ ok: false, code: 'UNSUPPORTED_ITEM' });
  });
});

describe('isValidTzid', () => {
  it('accepts real IANA ids and rejects garbage', () => {
    expect(isValidTzid('Asia/Jerusalem')).toBe(true);
    expect(isValidTzid('America/New_York')).toBe(true);
    expect(isValidTzid('UTC')).toBe(true);
    expect(isValidTzid('Not/A_Zone')).toBe(false);
    expect(isValidTzid('')).toBe(false);
  });
});
