/**
 * Pure business logic for __ACTOR_TITLE__.
 *
 * Nothing in this file imports "apify" or touches the network/filesystem: it is plain
 * logic that `test/example.test.ts` unit-tests directly, and that `src/main.ts` wraps
 * with Actor.init()/getInput()/pushData(). Replace this file's contents with your
 * Actor's real logic, keeping the same "pure function in, plain object out, never
 * throws on bad input" shape.
 */

export interface ProcessResult {
  input: string;
  ok: boolean;
  value: string | null;
  error: string | null;
}

/**
 * Process a single input item. Must never throw for "expected" bad input — return
 * `{ ok: false, error: '...' }` instead, so one bad item never fails the whole run.
 * See CONVENTIONS.md "Error handling that never fails the whole run".
 */
export function processItem(input: unknown): ProcessResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return {
      input: typeof input === 'string' ? input : String(input),
      ok: false,
      value: null,
      error: 'Input must be a non-empty string.',
    };
  }
  return { input, ok: true, value: input.trim().toUpperCase(), error: null };
}
