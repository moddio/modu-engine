// packages/engine/tests/differential/tsHarness.ts
import { Engine } from '../../engine/core/Engine';
import { ScriptEngine } from '../../engine/core/scripting/ScriptEngine';
import { ConditionEvaluator } from '../../engine/core/scripting/ConditionEvaluator';
import { adaptActions } from './caseAdapter';
import { sortKeys, type Case, type Trace } from './types';

/** Re-implements ONLY block dispatch so we can record flow markers, while
 *  delegating every value resolution and leaf mutation to the real engine
 *  (ScriptEngine.actions.run for single leaf actions, ConditionEvaluator for
 *  conditions). The engine remains authoritative for behaviour. */
export function runTsCase(rawCase: Case): Trace {
  Engine.reset();
  const engine = Engine.instance();
  const se = new ScriptEngine(engine);
  const cond = new ConditionEvaluator();

  for (const [name, v] of Object.entries(rawCase.initialVars)) {
    se.variables.setGlobal(name, v.value, v.type);
  }

  const outputLog: unknown[] = [];
  const flow: string[] = [];

  // Access the real resolver through a one-off setVariable round-trip:
  // run a tiny script that stores the resolved expression into a scratch var.
  const SCRATCH = '__diff_scratch__';
  se.variables.setGlobal(SCRATCH, undefined, 'any');
  const resolve = (expr: unknown, vars: Record<string, unknown>): unknown => {
    se.actions.run([{ type: 'setVariable', variableName: SCRATCH, value: expr }], vars);
    return se.variables.getGlobal(SCRATCH);
  };

  type Sig = 'break' | 'continue' | 'return' | undefined;

  const exec = (
    actions: Array<Record<string, unknown>>,
    vars: Record<string, unknown>,
  ): Sig => {
    for (const action of actions) {
      if (action.disabled) continue;
      const type = action.type as string;

      if (type === 'log') {
        outputLog.push(resolve(action.value, vars));
        continue;
      }
      if (type === 'break') { flow.push('break'); return 'break'; }
      if (type === 'continue') { flow.push('continue'); return 'continue'; }
      if (type === 'return') { flow.push('return'); return 'return'; }
      if (type === 'comment') continue;

      if (type === 'condition') {
        const truthy = cond.evaluate(action.conditions, (v) => resolve(v, vars));
        flow.push(`enter:condition:${truthy ? 'then' : 'else'}`);
        const sig = exec(((truthy ? action.then : action.else) as any[]) ?? [], vars);
        if (sig) return sig;
        continue;
      }
      if (type === 'repeat') {
        const count = Number(resolve(action.count, vars)) || 0;
        flow.push('enter:repeat');
        for (let i = 0; i < count; i++) {
          flow.push(`iter:repeat#${i}`);
          const sig = exec((action.actions as any[]) ?? [], { ...vars, i });
          if (sig === 'break') break;
          if (sig === 'return') return 'return';
        }
        continue;
      }
      if (type === 'while') {
        flow.push('enter:while');
        let i = 0;
        while (i < 10000) {
          if (!cond.evaluate(action.conditions, (v) => resolve(v, vars))) break;
          flow.push(`iter:while#${i}`);
          const sig = exec((action.actions as any[]) ?? [], vars);
          if (sig === 'break') break;
          if (sig === 'return') return 'return';
          i++;
        }
        continue;
      }
      // 'for' is intentionally NOT re-walked: it delegates to each engine's real
      // for-loop via the fallthrough below, so taro's (inclusive, named-var) and
      // the TS engine's (exclusive, local) real semantics are compared faithfully.
      // Consequence: per-iteration flow markers are not recorded for 'for'.

      // Leaf action (setVariable / increase / decrease / calculate): delegate
      // to the real engine so its exact semantics are exercised.
      se.actions.run([action], vars);
    }
    return undefined;
  };

  exec(adaptActions(rawCase.actions), {});

  const vars: Record<string, unknown> = {};
  for (const name of Object.keys(rawCase.initialVars)) {
    vars[name] = se.variables.getGlobal(name);
  }
  return { vars: sortKeys(vars), outputLog, flow };
}
