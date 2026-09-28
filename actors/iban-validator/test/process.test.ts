import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InputRecord } from '../src/lib/csv.js';
import { addToSummary, buildRow, emptySummary, internalErrorRow, safeBuildRow } from '../src/lib/process.js';

const datasetSchema = JSON.parse(readFileSync(new URL('../.actor/dataset_schema.json', import.meta.url), 'utf8')) as {
  fields: { properties: Record<string, unknown>; required: string[] };
  views: { overview: { transformation: { fields: string[] } } };
};
const smokeExpect = JSON.parse(readFileSync(new URL('./smoke.expect.json', import.meta.url), 'utf8')) as {
  requiredFields: string[];
  rows: Array<Record<string, unknown>>;
};

const rec = (input: string, bic: string | null = null, position = 1): InputRecord => ({ input, bic, source: 'ibans', position });

describe('buildRow', () => {
  it('valid IBAN without BIC', () => {
    expect(buildRow(rec('gb82 west 1234 5698 7654 32'))).toEqual({
      input: 'gb82 west 1234 5698 7654 32',
      source: 'ibans',
      position: 1,
      valid: true,
      reasonCode: 'OK',
      reason: 'Valid IBAN: length, national format and check digits are correct.',
      iban: 'GB82WEST12345698765432',
      ibanFormatted: 'GB82 WEST 1234 5698 7654 32',
      countryCode: 'GB',
      countryName: 'United Kingdom',
      checkDigits: '82',
      bban: 'WEST12345698765432',
      bankCode: 'WEST',
      branchCode: '123456',
      accountNumber: '98765432',
      bic: null,
      bicValid: null,
      bicReason: null,
    });
  });

  it('a bad BIC does not change the IBAN verdict', () => {
    const row = buildRow(rec('NL91ABNA0417164300', 'ABNANL2'));
    expect(row).toMatchObject({ valid: true, reasonCode: 'OK', bic: 'ABNANL2', bicValid: false });
    expect(row.bicReason).toContain('8 or 11');
  });

  it('a good BIC on an invalid IBAN', () => {
    expect(buildRow(rec('NL91ABNA0417164301', 'abnanl2a'))).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM', bic: 'ABNANL2A', bicValid: true, bicReason: null });
  });

  it('carries source and position through for joining', () => {
    expect(buildRow({ input: 'X', bic: null, source: 'csvText', position: 7 })).toMatchObject({ source: 'csvText', position: 7, input: 'X' });
  });
});

describe('error isolation', () => {
  it('safeBuildRow turns an exception into an INTERNAL_ERROR row and keeps the record identity', () => {
    const boom = () => {
      throw new Error('kaboom');
    };
    const row = safeBuildRow(rec('DE89370400440532013000', 'X', 4), boom);
    expect(row).toMatchObject({ input: 'DE89370400440532013000', position: 4, valid: false, reasonCode: 'INTERNAL_ERROR' });
    expect(row.reason).toContain('kaboom');
    expect(Object.keys(row)).toEqual(Object.keys(buildRow(rec('DE89370400440532013000')))); // same shape as normal rows
  });

  it('one throwing record does not affect its neighbours', () => {
    const rows = ['NL91ABNA0417164300', 'BOOM', 'DE89370400440532013000'].map((i) =>
      safeBuildRow(rec(i), (r) => {
        if (r.input === 'BOOM') throw new Error('x');
        return buildRow(r);
      }),
    );
    expect(rows.map((r) => r.reasonCode)).toEqual(['OK', 'INTERNAL_ERROR', 'OK']);
  });

  it('internalErrorRow copes with non-Error throwables', () => {
    expect(internalErrorRow(rec('X'), 'plain string').reason).toContain('plain string');
  });
});

describe('output field naming and schema drift guards', () => {
  const sampleRow = buildRow(rec('NL91ABNA0417164300', 'ABNANL2A'));

  it('every output key is camelCase', () => {
    for (const key of Object.keys(sampleRow)) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it('row keys and .actor/dataset_schema.json properties are exactly the same set', () => {
    expect(Object.keys(sampleRow).sort()).toEqual(Object.keys(datasetSchema.fields.properties).sort());
  });

  it('the dataset view, required fields and smoke expectations only reference real fields', () => {
    const keys = new Set(Object.keys(sampleRow));
    for (const f of datasetSchema.views.overview.transformation.fields) expect(keys.has(f), `view field ${f}`).toBe(true);
    for (const f of datasetSchema.fields.required) expect(keys.has(f), `required field ${f}`).toBe(true);
    for (const f of smokeExpect.requiredFields) expect(keys.has(f), `smoke field ${f}`).toBe(true);
    for (const row of smokeExpect.rows) for (const f of Object.keys(row)) expect(keys.has(f), `smoke row field ${f}`).toBe(true);
  });
});

describe('summary', () => {
  it('counts verdicts, reasons, countries and BIC results', () => {
    const summary = emptySummary();
    for (const r of [rec('NL91ABNA0417164300', 'ABNANL2A'), rec('DE89370400440532013001', 'bad'), rec('NOTANIBAN'), rec('GB82WEST12345698765432')]) {
      addToSummary(summary, buildRow(r));
    }
    expect(summary).toMatchObject({
      total: 4,
      valid: 2,
      invalid: 2,
      bicProvided: 2,
      bicInvalid: 1,
      byReasonCode: { OK: 2, BAD_CHECKSUM: 1, BAD_PREFIX: 1 },
      byCountry: { NL: 1, DE: 1, GB: 1 },
    });
  });
});
