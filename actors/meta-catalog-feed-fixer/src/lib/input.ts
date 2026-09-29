/**
 * Input normalisation for Meta Catalog Feed Fixer for Facebook and Instagram (pure: no Apify imports, unit-tested).
 *
 * Rules every Actor in this repo follows (see CONVENTIONS.md "Input schema conventions"):
 * - The platform's daily health run (and a bare `apify run`) may start the Actor with no
 *   INPUT at all, `{}`, or only schema defaults. If the *work-defining* field is ABSENT
 *   (undefined/null), fall back to DEFAULT_INPUT, which MUST equal the prefill in
 *   `.actor/input_schema.json` (a unit test enforces that). Never fail the daily test.
 * - A work-defining field that is present but unusable (e.g. an empty list) is the caller's
 *   mistake: throw InputError with a readable message. Never silently run the demo input for
 *   a paying user whose own list happened to be empty.
 * - Do not put `default` on work-defining fields in the schema: the platform would inject it
 *   into API runs that only meant to set other fields.
 */

export interface ActorInput {
  items: string[];
  maxItems: number;
}

/** Mirror of the prefill/default values in .actor/input_schema.json. */
export const DEFAULT_INPUT: ActorInput = {
  items: ['example-1', 'example-2'],
  maxItems: 1000,
};

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export function normalizeInput(raw: unknown): ActorInput {
  if (raw === null || raw === undefined) return demoInput();
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InputError('Input must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  let maxItems = DEFAULT_INPUT.maxItems;
  if (obj.maxItems !== undefined && obj.maxItems !== null) {
    if (typeof obj.maxItems !== 'number' || !Number.isFinite(obj.maxItems) || obj.maxItems < 1) {
      throw new InputError('Input field "maxItems" must be a number >= 1.');
    }
    maxItems = Math.floor(obj.maxItems);
  }

  if (obj.items === undefined || obj.items === null) return { ...demoInput(), maxItems };
  if (!Array.isArray(obj.items)) {
    throw new InputError('Input field "items" must be an array of strings.');
  }
  const items = obj.items.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (items.length === 0) {
    throw new InputError('Input field "items" must contain at least one non-empty string.');
  }
  return { items, maxItems };
}

function demoInput(): ActorInput {
  return { items: [...DEFAULT_INPUT.items], maxItems: DEFAULT_INPUT.maxItems };
}
