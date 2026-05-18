// packages/engine/tests/differential/oracle.ts
import type { Case, Trace } from './types';

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Returns a human-readable diff string, or null if traces match.
 *  Convention: `taro` is the oracle (expected), `ts` is under test. */
export function diffTraces(taro: Trace, ts: Trace): string | null {
  const keys = new Set([...Object.keys(taro.vars), ...Object.keys(ts.vars)]);
  for (const k of [...keys].sort()) {
    if (!eq(taro.vars[k], ts.vars[k])) {
      return `vars.${k} differs — taro: ${JSON.stringify(taro.vars[k])} | ts: ${JSON.stringify(ts.vars[k])}`;
    }
  }
  const n = Math.max(taro.outputLog.length, ts.outputLog.length);
  for (let i = 0; i < n; i++) {
    if (!eq(taro.outputLog[i], ts.outputLog[i])) {
      return `outputLog[${i}] differs — taro: ${JSON.stringify(taro.outputLog[i])} | ts: ${JSON.stringify(ts.outputLog[i])}`;
    }
  }
  const m = Math.max(taro.flow.length, ts.flow.length);
  for (let i = 0; i < m; i++) {
    if (taro.flow[i] !== ts.flow[i]) {
      return `flow[${i}] differs — taro: ${JSON.stringify(taro.flow[i])} | ts: ${JSON.stringify(ts.flow[i])}`;
    }
  }
  return null;
}

/** Throws with full reproduction context on any mismatch. */
export function assertTracesEqual(
  source: string,
  taro: Trace,
  ts: Trace,
  caseOrActions: Case | Trace,
): void {
  const msg = diffTraces(taro, ts);
  if (!msg) return;
  const detail =
    'name' in (caseOrActions as Case)
      ? JSON.stringify((caseOrActions as Case).actions)
      : '(trace-only)';
  throw new Error(
    `[differential] ${source}\n${msg}\nactions: ${detail}`,
  );
}
