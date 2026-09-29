#!/usr/bin/env node
/**
 * Regenerates the SYNTHETIC Bank of Israel fixtures in this folder (`node generate-fixtures.mjs`).
 *
 * Nothing here was recorded from the Bank of Israel: the layouts are hand-built from the documented
 * SDMX-CSV / PublicApi shapes (see VERIFY(BOI-nn) in src/lib/boi-adapter.ts) and the numbers are made
 * up. The publication calendar is an ASSUMPTION used only to create realistic gaps:
 *   - until the end of 2025: Sunday-Thursday, 2026 onwards: Monday-Friday;
 *   - a few Jewish holidays are left out (Rosh Hashana 2024, Sukkot 2024, Yom Kippur 2026).
 * The production code never assumes a calendar; it works on whatever dates the source returns.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HEADER = 'DATAFLOW,SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,TIME_PERIOD,OBS_VALUE,OBS_STATUS';
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const iso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const weekday = (isoDate) => new Date(day(isoDate) * 86400000).getUTCDay(); // 0 = Sunday

function* dates(from, to) {
  for (let d = day(from); d <= day(to); d++) yield iso(d);
}

const HOLIDAY_GAPS = new Set([
  '2024-10-03', '2024-10-04', // Rosh Hashana 2024
  '2024-10-17', '2024-10-24', // Sukkot 2024, Shemini Atzeret 2024
  '2026-09-21', // Yom Kippur 2026
]);

function isPublicationDay(date) {
  if (HOLIDAY_GAPS.has(date)) return false;
  const wd = weekday(date);
  return date < '2026-01-01' ? wd >= 0 && wd <= 4 : wd >= 1 && wd <= 5;
}

/** Hand-picked values for the 2025-01 window (three currencies), so tests can state exact numbers. */
const JAN_2025 = {
  USD: { '2025-01-01': 3.654, '2025-01-02': 3.642, '2025-01-05': 3.647, '2025-01-06': 3.655, '2025-01-07': 3.648, '2025-01-08': 3.641, '2025-01-09': 3.652, '2025-01-12': 3.66, '2025-01-13': 3.665, '2025-01-14': 3.658, '2025-01-15': 3.649, '2025-01-16': 3.653 },
  EUR: { '2025-01-01': 3.781, '2025-01-02': 3.772, '2025-01-05': 3.769, '2025-01-06': 3.79, '2025-01-07': 3.752, '2025-01-08': 3.741, '2025-01-09': 3.735, '2025-01-12': 3.742, '2025-01-13': 3.751, '2025-01-14': 3.744, '2025-01-15': 3.759, '2025-01-16': 3.762 },
  JPY: { '2025-01-01': 2.3312, '2025-01-02': 2.3208, '2025-01-05': 2.3167, '2025-01-06': 2.3241, '2025-01-07': 2.3118, '2025-01-08': 2.3089, '2025-01-09': 2.3196, '2025-01-12': 2.3254, '2025-01-13': 2.3301, '2025-01-14': 2.3227, '2025-01-15': 2.3177, '2025-01-16': 2.3244 },
};

const BASE = { USD: 3.7, EUR: 4.05, JPY: 2.4 };
const SYNTHETIC_WINDOWS = [
  ['2024-09-22', '2024-10-31', { USD: 3.72, EUR: 4.09, JPY: 2.62 }],
  ['2026-09-01', '2026-09-28', { USD: 3.21, EUR: 3.74, JPY: 2.18 }],
];

function synthetic(base, k) {
  return Math.round((base + 0.012 * Math.sin(k * 0.9) + 0.0008 * k) * 10000) / 10000;
}

function csvRows(currency, table) {
  return table.map(([date, value]) => `BOI.STATISTICS:EXR(1.0),RER_${currency}_ILS,D,${currency},ILS,ILS,OF00,${date},${value.toFixed(4)},A`);
}

const series = {};
for (const currency of ['USD', 'EUR', 'JPY']) {
  const rows = [];
  for (const [from, to, bases] of SYNTHETIC_WINDOWS.slice(0, 1)) {
    let k = 0;
    for (const d of dates(from, to)) if (isPublicationDay(d)) rows.push([d, synthetic(bases[currency], k++)]);
  }
  for (const [d, v] of Object.entries(JAN_2025[currency])) rows.push([d, v]);
  for (const [from, to, bases] of SYNTHETIC_WINDOWS.slice(1)) {
    let k = 0;
    for (const d of dates(from, to)) if (isPublicationDay(d)) rows.push([d, synthetic(bases[currency], k++)]);
  }
  series[currency] = rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  writeFileSync(join(here, 'sdmx', `RER_${currency}_ILS.csv`), `${[HEADER, ...csvRows(currency, series[currency])].join('\n')}\n`);
}

const write = (rel, text) => writeFileSync(join(here, rel), text);
const usd = (from, to) => series.USD.filter(([d]) => d >= from && d <= to);

// ---- cases used by the adapter tests ---------------------------------------------------------------
write('cases/normal-day.csv', `${[HEADER, ...csvRows('USD', usd('2025-01-07', '2025-01-07'))].join('\n')}\n`);
write('cases/holiday-gap.csv', `${[HEADER, ...csvRows('USD', usd('2024-09-29', '2024-10-08'))].join('\n')}\n`);
write('cases/empty-header-only.csv', `${HEADER}\n`);
write('cases/unknown-series.txt', 'NoResultsFound: no data for the requested key\n');
write(
  'cases/multi-series.csv',
  `${[HEADER, ...csvRows('EUR', series.EUR.filter(([d]) => d >= '2025-01-06' && d <= '2025-01-07')), ...csvRows('USD', usd('2025-01-06', '2025-01-07'))].join('\n')}\n`,
);
write(
  'cases/semicolon-bom-quoted.csv',
  `﻿${['DATAFLOW;SERIES_CODE;TIME_PERIOD;OBS_VALUE;OBS_STATUS', '"BOI.STATISTICS:EXR(1.0)";"RER_USD_ILS";"2025-01-06";"3.6550";"A"', '"BOI.STATISTICS:EXR(1.0)";"RER_USD_ILS";"2025-01-07";"3.6480";"A"'].join('\r\n')}\r\n`,
);
write(
  'cases/missing-values.csv',
  `${[HEADER, 'BOI.STATISTICS:EXR(1.0),RER_USD_ILS,D,USD,ILS,ILS,OF00,2025-01-06,,M', 'BOI.STATISTICS:EXR(1.0),RER_USD_ILS,D,USD,ILS,ILS,OF00,2025-01-07,3.6480,A', 'BOI.STATISTICS:EXR(1.0),RER_USD_ILS,D,USD,ILS,ILS,OF00,2025-01-08,NaN,A'].join('\n')}\n`,
);
write('cases/malformed-no-columns.csv', 'code,name\nUSD,US Dollar\n');
write('cases/malformed-bad-rate.csv', `${[HEADER, 'BOI.STATISTICS:EXR(1.0),RER_USD_ILS,D,USD,ILS,ILS,OF00,2025-01-07,abc,A'].join('\n')}\n`);
write('cases/malformed-zero-rate.csv', `${[HEADER, 'BOI.STATISTICS:EXR(1.0),RER_USD_ILS,D,USD,ILS,ILS,OF00,2025-01-07,0,A'].join('\n')}\n`);
write('cases/malformed-period.csv', `${[HEADER, 'BOI.STATISTICS:EXR(1.0),RER_USD_ILS,M,USD,ILS,ILS,OF00,2025-01,3.6480,A'].join('\n')}\n`);
write('cases/html-block-page.html', '<!DOCTYPE html><html><head><title>Access denied</title></head><body>Request blocked.</body></html>\n');
write('cases/malformed-truncated.json', '{"dataSets":[{"series":{"0:0":{"observations":{"0":[3.6');
write(
  'cases/sdmx-json.json',
  `${JSON.stringify(
    {
      header: { id: 'synthetic-fixture' },
      dataSets: [{ series: { '0:0:0': { observations: { 0: [3.655, 0], 1: [3.648, 0], 2: [null, 1] } } } }],
      structure: { dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ id: '2025-01-06' }, { id: '2025-01-07' }, { id: '2025-01-08' }] }] } },
    },
    null,
    2,
  )}\n`,
);

// ---- PublicApi: latest rates (synthetic; 14 currencies) --------------------------------------------
const LATEST = [
  ['USD', 3.2111, 0.12, 1], ['GBP', 4.3402, -0.08, 1], ['JPY', 2.1834, 0.31, 100], ['EUR', 3.7521, 0.05, 1], ['AUD', 2.1345, 0.22, 1], ['CAD', 2.3118, -0.15, 1], ['DKK', 0.5031, 0.05, 1],
  ['NOK', 0.3092, -0.02, 1], ['ZAR', 0.1839, 0.4, 1], ['SEK', 0.3387, 0.11, 1], ['CHF', 4.0116, 0.09, 1], ['JOD', 4.5288, 0.12, 1], ['LBP', 0.0036, 0, 10], ['EGP', 0.0662, -0.06, 1],
];
const latestJson = { exchangeRates: LATEST.map(([key, rate, change, unit]) => ({ key, currentExchangeRate: rate, currentChange: change, unit, lastUpdate: '2026-09-28T12:30:04.51Z' })) };
write('publicapi/latest.json', `${JSON.stringify(latestJson, null, 2)}\n`);
write('cases/publicapi-latest.json', `${JSON.stringify(latestJson, null, 2)}\n`);
write(
  'cases/publicapi-latest.xml',
  `<?xml version="1.0" encoding="utf-8"?>\n<ExchangeRates>\n${LATEST.map(
    ([key, rate, change, unit]) =>
      `  <ExchangeRateResponseDTO>\n    <key>${key}</key>\n    <currentExchangeRate>${rate}</currentExchangeRate>\n    <currentChange>${change}</currentChange>\n    <unit>${unit}</unit>\n    <lastUpdate>2026-09-28T12:30:04.51Z</lastUpdate>\n  </ExchangeRateResponseDTO>`,
  ).join('\n')}\n</ExchangeRates>\n`,
);
write(
  'cases/publicapi-legacy.xml',
  `<?xml version="1.0" encoding="utf-8"?>\n<CURRENCIES>\n  <LAST_UPDATE>2026-09-28</LAST_UPDATE>\n${LATEST.slice(0, 3).map(
    ([key, rate, change, unit]) =>
      `  <CURRENCY>\n    <NAME>${key}</NAME>\n    <UNIT>${unit}</UNIT>\n    <CURRENCYCODE>${key}</CURRENCYCODE>\n    <COUNTRY>Synthetic</COUNTRY>\n    <RATE>${rate}</RATE>\n    <CHANGE>${change}</CHANGE>\n  </CURRENCY>`,
  ).join('\n')}\n</CURRENCIES>\n`,
);
write('cases/publicapi-malformed.json', '{"exchangeRates":[{"foo":"bar"}]}\n');
write('cases/publicapi-no-array.json', '{"status":"maintenance"}\n');
mkdirSync(join(here, 'sdmx'), { recursive: true });
console.log('fixtures written');
