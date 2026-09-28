/**
 * Shared helpers for the repo scripts (plain Node, no dependencies).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACTORS_DIR = process.env.APIFY_TOOLS_ACTORS_DIR
  ? resolve(process.env.APIFY_TOOLS_ACTORS_DIR)
  : join(REPO_ROOT, 'actors');
export const TEMPLATES_DIR = join(REPO_ROOT, 'templates');

export const ACTOR_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** True when the given module (pass import.meta.url) is the entry point, symlinks resolved. */
export function isMain(metaUrl) {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === metaUrl;
  } catch {
    return false;
  }
}

export function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every folder under actors/ and templates/ that has a package.json. */
export function listTargets({ only } = {}) {
  const targets = [];
  for (const [kind, base] of [
    ['actor', ACTORS_DIR],
    ['template', TEMPLATES_DIR],
  ]) {
    if (!isDir(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const dir = join(base, name);
      if (isDir(dir) && existsSync(join(dir, 'package.json'))) targets.push({ kind, name, dir });
    }
  }
  if (only && only.length > 0) {
    const wanted = new Set(only);
    const found = targets.filter((t) => wanted.has(t.name));
    const missing = only.filter((n) => !found.some((t) => t.name === n));
    if (missing.length > 0) throw new Error(`Unknown actor/template name(s): ${missing.join(', ')}`);
    return found;
  }
  return targets;
}

/** Resolve "<name>" to a target folder (actors/<name> first, then templates/<name>). */
export function resolveTarget(name) {
  const [target] = listTargets({ only: [name] });
  if (!target) throw new Error(`No actor or template named "${name}"`);
  return target;
}

/**
 * Run a command and collect its output. Never rejects: failures are reported through
 * `code` (null when killed by a signal / timeout) and `timedOut`.
 */
export function run(cmd, args, { cwd, env, timeoutMs, input } = {}) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: 127, stdout, stderr: `${stderr}${err.message}`, timedOut, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Run `npm <args>` (npm is a .cmd shim on Windows; the repo targets Linux/macOS CI). */
export function npm(args, opts = {}) {
  return run('npm', args, opts);
}

export function tail(text, lines = 25) {
  const all = String(text).trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

/** Render rows (array of arrays of strings) as an aligned plain-text table. */
export function renderTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

export function fmtMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
