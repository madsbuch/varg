/**
 * The value, or a failed test that says what was missing. Tests use this
 * instead of `!`: an index past the end fails loudly at the line that
 * assumed it, never as "cannot read properties of undefined" three calls on.
 */
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`expected a ${what}, got ${value === null ? "null" : "undefined"}`);
  return value;
}
