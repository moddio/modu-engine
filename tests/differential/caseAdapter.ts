// packages/engine/tests/differential/caseAdapter.ts

const BLOCK_KEYS = ['actions', 'then', 'else'] as const;

/** Deep-clone an action list and, for increase/decrease actions, mirror
 *  `variableName` onto `variable` so the taro engine (which reads
 *  `action.variable`) and the TS engine (which reads `action.variableName`)
 *  operate on the same target. This normalizes a known action-schema naming
 *  difference; it is NOT hiding a logic divergence. */
export function adaptActions(
  actions: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return actions.map((a) => {
    const copy: Record<string, unknown> = { ...a };
    if (
      (copy.type === 'increaseVariableByNumber' ||
        copy.type === 'decreaseVariableByNumber') &&
      typeof copy.variableName === 'string'
    ) {
      copy.variable = copy.variableName;
    }
    for (const k of BLOCK_KEYS) {
      if (Array.isArray(copy[k])) {
        copy[k] = adaptActions(copy[k] as Array<Record<string, unknown>>);
      }
    }
    return copy;
  });
}
