// packages/engine/tests/differential/types.ts

/** A pure-logic script case fed identically to both engines. */
export interface Case {
  name: string;
  /** Every variable the case reads or writes MUST be declared here.
   *  taro's setVariable is a no-op for undeclared names. */
  initialVars: Record<string, { value: unknown; type: string }>;
  /** Pure-logic action list. The synthetic `log` action records to the
   *  output log. The `variableName` key is used; the adapter mirrors it
   *  to `variable` for taro increase/decrease compatibility. */
  actions: Array<Record<string, unknown>>;
}

/** The three observable surfaces compared between engines. */
export interface Trace {
  /** Final value of every declared variable, key-sorted. */
  vars: Record<string, unknown>;
  /** Values passed to the synthetic `log` action, in execution order. */
  outputLog: unknown[];
  /** Ordered structural markers, e.g.
   *  "enter:repeat", "iter:repeat#0", "enter:condition:then",
   *  "break", "continue", "return". */
  flow: string[];
}

/** Sort an object's keys so vars comparison is order-independent. */
export function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}
