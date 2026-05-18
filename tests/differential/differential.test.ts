// packages/engine/tests/differential/differential.test.ts
import { describe, it } from 'vitest';
import { runTsCase } from './tsHarness';
import { runTaroCase, taroAvailable } from './taroHarness';
import { assertTracesEqual } from './oracle';
import { loadCases } from './cases/index';
import { generate } from './fuzz/generator';

// Pinned, deterministic seed budget. Adding seeds is a deliberate change.
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const gate = taroAvailable() ? describe : describe.skip;

if (!taroAvailable()) {
  // One clear line so a clone/CI without the sibling taro repo is unambiguous.
  // eslint-disable-next-line no-console
  console.warn(
    '[differential] taro source not found at $MODDIO_TARO_PATH ' +
      '(default /app/data/home/moddio2); differential suite SKIPPED.',
  );
}

gate('differential: TS engine vs old taro (taro is oracle)', () => {
  for (const c of loadCases()) {
    it(`fixture: ${c.name}`, () => {
      assertTracesEqual(`fixture:${c.name}`, runTaroCase(c), runTsCase(c), c);
    });
  }

  for (const seed of SEEDS) {
    it(`fuzz seed ${seed}`, () => {
      const c = generate(seed);
      assertTracesEqual(`seed:${seed}`, runTaroCase(c), runTsCase(c), c);
    });
  }
});
