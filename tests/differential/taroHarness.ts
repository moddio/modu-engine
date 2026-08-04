// packages/engine/tests/differential/taroHarness.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { adaptActions } from './caseAdapter';
import { sortKeys, type Case, type Trace } from './types';

const TARO_ROOT = process.env.MODDIO_TARO_PATH || '/app/data/home/moddio2';
const SCRIPT_DIR = join(TARO_ROOT, 'src/gameClasses/components/script');
const FILES = ['ActionComponent.js', 'ParameterComponent.js', 'ConditionComponent.js'];

export function taroAvailable(): boolean {
  return FILES.every((f) => existsSync(join(SCRIPT_DIR, f)));
}

/** Minimal TaroClass.extend — produces a constructor that calls init(). */
function makeTaroEntity() {
  function extend(this: any, proto: Record<string, unknown>) {
    function Ctor(this: any, ...args: unknown[]) {
      if (typeof this.init === 'function') this.init(...args);
    }
    Object.assign(Ctor.prototype, proto);
    (Ctor as any).extend = extend;
    return Ctor;
  }
  return { extend };
}

/** Build the mock taro global. `vars` is the live variable table both
 *  setVariable (ActionComponent) and getVariable (ParameterComponent) read. */
function makeTaro(variableTable: Record<string, { value: unknown }>) {
  return {
    isServer: true,
    isClient: false,
    runMode: 0,
    now: 0,
    profiler: { isEnabled: false },
    status: null,
    game: {
      lastUpdatedVariableName: '',
      data: { variables: variableTable, defaultData: { _id: 'diff', owner: 'diff' } },
      updateDevConsole() {},
    },
    script: {
      errorLog() {},
      scriptLog() {},
    },
  };
}

let loaded: {
  ActionComponent: any;
  ParameterComponent: any;
  ConditionComponent: any;
} | null = null;

function loadTaroClasses() {
  if (loaded) return loaded;
  const g = globalThis as any;
  g.TaroEntity = makeTaroEntity();
  // moddio2 has no node_modules (lodash not installed there), so we resolve
  // lodash from the engine workspace root instead.
  // DEVIATION: spec says createRequire(join(TARO_ROOT, 'package.json')) for
  // lodash, but moddio2 has no node_modules; using this file's URL as anchor
  // so Node walks up to the workspace root which has lodash installed.
  const reqLocal = createRequire(import.meta.url);
  const req = createRequire(join(TARO_ROOT, 'package.json'));
  g._ = reqLocal('lodash');
  const ActionComponent = req(join(SCRIPT_DIR, 'ActionComponent.js'));
  const ParameterComponent = req(join(SCRIPT_DIR, 'ParameterComponent.js'));
  const ConditionComponent = req(join(SCRIPT_DIR, 'ConditionComponent.js'));
  loaded = { ActionComponent, ParameterComponent, ConditionComponent };
  return loaded;
}

export function runTaroCase(rawCase: Case): Trace {
  const { ActionComponent, ParameterComponent, ConditionComponent } = loadTaroClasses();

  // taro variable table: declared names only (setVariable no-ops otherwise).
  const variableTable: Record<string, { value: unknown }> = {};
  for (const [name, v] of Object.entries(rawCase.initialVars)) {
    variableTable[name] = { value: v.value };
  }
  (globalThis as any).taro = makeTaro(variableTable);

  const outputLog: unknown[] = [];
  const flow: string[] = [];

  // Stub ScriptComponent: holds param + condition + the bookkeeping fields
  // ActionComponent/ParameterComponent reference.
  const entityStub = { _id: 'diff-entity' };
  const scriptStub: any = {
    _entity: entityStub,
    currentScriptId: 'diff',
    currentActionName: '',
    currentActionLineNumber: 0,
    recordLast50Action() {},
    errorLog() {},
  };
  scriptStub.param = new ParameterComponent(scriptStub, entityStub);
  scriptStub.condition = new ConditionComponent(scriptStub, entityStub);
  const action = new ActionComponent(scriptStub, entityStub);

  // The synthetic `log` action is not a taro action. Wrap `run` so a
  // `{type:'log'}` resolves its value via the real param.getValue and the
  // block markers are recorded, delegating everything else to taro's run.
  const taroRun = action.run.bind(action);

  const exec = (
    actions: any[],
    vars: any,
  ): 'break' | 'continue' | 'return' | undefined => {
    for (const a of actions) {
      if (!a || a.disabled) continue;
      const type = a.type;
      if (type === 'log') {
        outputLog.push(scriptStub.param.getValue(a.value, vars));
        continue;
      }
      if (type === 'break') { flow.push('break'); vars.break = true; return 'break'; }
      if (type === 'continue') { flow.push('continue'); return 'continue'; }
      if (type === 'return') { flow.push('return'); return 'return'; }
      if (type === 'comment') continue;
      if (type === 'condition') {
        const truthy = scriptStub.condition.run(a.conditions, vars, 'c');
        flow.push(`enter:condition:${truthy ? 'then' : 'else'}`);
        const sig = exec((truthy ? a.then : a.else) ?? [], vars);
        if (sig) return sig;
        continue;
      }
      if (type === 'repeat') {
        const count = scriptStub.param.getValue(a.count, vars);
        flow.push('enter:repeat');
        if (!isNaN(count) && count > 0) {
          for (let i = 0; i < count; i++) {
            flow.push(`iter:repeat#${i}`);
            const sig = exec(a.actions ?? [], vars);
            if (sig === 'break' || vars.break) { vars.break = false; break; }
            if (sig === 'return') return 'return';
          }
        }
        continue;
      }
      if (type === 'while') {
        flow.push('enter:while');
        let i = 0;
        while (i < 10000) {
          if (!scriptStub.condition.run(a.conditions, vars, 'w')) break;
          flow.push(`iter:while#${i}`);
          const sig = exec(a.actions ?? [], vars);
          if (sig === 'break' || vars.break) { vars.break = false; break; }
          if (sig === 'return') return 'return';
          i++;
        }
        continue;
      }
      // 'for' is intentionally NOT re-walked: it delegates to each engine's real
      // for-loop via the fallthrough below, so taro's (inclusive, named-var) and
      // the TS engine's (exclusive, local) real semantics are compared faithfully.
      // Consequence: per-iteration flow markers are not recorded for 'for'.

      // Leaf action: delegate to taro's real run for one action.
      taroRun([a], vars, 'p', scriptStub.currentActionLineNumber);
    }
    return undefined;
  };

  exec(adaptActions(rawCase.actions), {});

  const vars: Record<string, unknown> = {};
  for (const name of Object.keys(rawCase.initialVars)) {
    vars[name] = variableTable[name]?.value;
  }
  return { vars: sortKeys(vars), outputLog, flow };
}
