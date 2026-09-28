/**
 * Offline schema validation for one Actor folder.
 *
 * - `.actor/actor.json` is validated in-process against the official JSON schema shipped in
 *   the `@apify/json_schemas` npm package (https://apify.com/schemas/v1/actor.json).
 * - input / dataset schemas are validated by the official CLI (`apify validate-schema`,
 *   apify-cli devDependency). Both work with no network and no token (verified 2026-09-28).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, REPO_ROOT, run, tail } from './common.mjs';

export async function validateSchemas({ dir }) {
  const problems = [];
  let skipped = 0;

  try {
    const { getActorSchemaValidator } = await import('@apify/json_schemas');
    const validate = getActorSchemaValidator();
    const actorJson = readJson(join(dir, '.actor', 'actor.json'));
    if (!validate(actorJson)) problems.push(`actor.json does not match the official schema: ${JSON.stringify(validate.errors)}`);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') skipped += 1;
    else problems.push(`actor.json check crashed: ${err.message}`);
  }

  const bin = join(REPO_ROOT, 'node_modules', '.bin', 'apify');
  if (existsSync(bin)) {
    const r = await run(bin, ['validate-schema'], {
      cwd: dir,
      env: { ...process.env, APIFY_CLI_DISABLE_TELEMETRY: '1', CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
      timeoutMs: 90_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    const inputOk = /Input schema is valid/i.test(out);
    if (r.code !== 0 || !inputOk || /\b(invalid|not valid)\b/i.test(out.replace(/is valid/gi, ''))) {
      problems.push(`apify validate-schema failed (exit ${r.code}):\n${tail(out, 15)}`);
    }
  } else {
    skipped += 1;
  }

  return { problems, skipped };
}
