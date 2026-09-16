/** Reading a tool's arguments: the one place they stop being JSON.
 *
 *  A client sends whatever it sends. Every tool declares a JSON Schema for
 *  its inputs, which is what the model reads; what the handler reads is
 *  these, which refuse anything that is not the shape asked for and say
 *  which argument was wrong. A refusal is a protocol error (the request was
 *  malformed), not a tool result, so the model corrects the call rather than
 *  telling the learner something failed.
 */

export class InvalidArguments extends Error {}

const fail = (what: string): never => { throw new InvalidArguments(what); };

/** The arguments object itself, or `{}` where none were sent. */
export function argsOf(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return fail('arguments must be an object');
  return value as Record<string, unknown>;
}

/** A string, trimmed. Absent or empty is '' unless `required`. */
export function str(args: Record<string, unknown>, name: string, { required = false } = {}): string {
  const v = args[name];
  if (v === undefined || v === null) return required ? fail(`${name} is required`) : '';
  if (typeof v !== 'string') return fail(`${name} must be a string`);
  const out = v.trim();
  return !out && required ? fail(`${name} must not be empty`) : out;
}

/** A list of strings. A single string is accepted as a list of one, and
 *  "cat, tom; tomcat" as three: that is how glosses are written. */
export function strList(args: Record<string, unknown>, name: string): string[] {
  const v = args[name];
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return v.split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    return fail(`${name} must be a list of strings`);
  }
  return v.map((s) => s.trim()).filter(Boolean);
}

export function bool(args: Record<string, unknown>, name: string, fallback = false): boolean {
  const v = args[name];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') return fail(`${name} must be true or false`);
  return v;
}

/** A whole number within bounds; out of bounds is clamped, not refused. */
export function int(args: Record<string, unknown>, name: string,
  { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const v = args[name];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${name} must be a number`);
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** One of a closed set, or absent. */
export function oneOf<T extends string>(args: Record<string, unknown>, name: string,
  values: readonly T[]): T | undefined {
  const v = args[name];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    return fail(`${name} must be one of ${values.map((x) => JSON.stringify(x)).join(', ')}`);
  }
  return v as T;
}

/** A list of objects, each read by `each`; at least one unless `allowEmpty`. */
export function objList<T>(args: Record<string, unknown>, name: string,
  each: (item: Record<string, unknown>, index: number) => T, { max = 200 } = {}): T[] {
  const v = args[name];
  if (!Array.isArray(v)) return fail(`${name} must be a list`);
  if (!v.length) return fail(`${name} must not be empty`);
  if (v.length > max) return fail(`${name} may hold at most ${max} items per call`);
  return v.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return fail(`${name}[${i}] must be an object`);
    }
    return each(item as Record<string, unknown>, i);
  });
}

/** A nested object, or `{}` where absent. */
export function obj(args: Record<string, unknown>, name: string): Record<string, unknown> {
  const v = args[name];
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) return fail(`${name} must be an object`);
  return v as Record<string, unknown>;
}
