'use strict';
// Preloaded into the Actor process (node --require) by scripts/lib/smoke.mjs when
// --measure is used. Writes peak RSS / CPU / wall time to $SMOKE_MEASURE_FILE on exit.
// It never touches Actor code, so measured numbers reflect the real production entry point.
const fs = require('node:fs');

process.on('exit', () => {
  const file = process.env.SMOKE_MEASURE_FILE;
  if (!file) return;
  try {
    const ru = process.resourceUsage(); // maxRSS in kilobytes; CPU times in microseconds
    fs.writeFileSync(
      file,
      JSON.stringify({
        maxRssKb: ru.maxRSS,
        userCpuMs: Math.round(ru.userCPUTime / 1000),
        systemCpuMs: Math.round(ru.systemCPUTime / 1000),
        wallMs: Math.round(process.uptime() * 1000),
      }),
    );
  } catch {
    /* measurement is best-effort */
  }
});
