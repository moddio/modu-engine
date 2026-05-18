# Differential Script Testing

Runs the same pure-logic script case through the current TS scripting engine
and the **real old taro `ActionComponent.js`**. taro is the oracle: any
mismatch on final variables, ordered output log, or control-flow trace fails
the build.

## Run

    cd packages/engine
    npx vitest run tests/differential          # whole suite
    npx vitest run tests/differential/differential.test.ts   # just the gate

## taro source

The harness loads taro from `$MODDIO_TARO_PATH` (default
`/app/data/home/moddio2`). If the three script files
(`src/gameClasses/components/script/{ActionComponent,ParameterComponent,ConditionComponent}.js`)
are absent the differential gate is **skipped** with a console warning, so
clones/CI without the sibling repo stay green. Point the env var elsewhere to
test another checkout.

**lodash dependency:** taro's `increase/decreaseVariableByNumber` use lodash
`_.isNaN`/`_.isNil`. The sibling taro checkout has no installed `node_modules`,
so the harness resolves `lodash` from this workspace's `node_modules` instead
(anchored to the harness file). If lodash is not resolvable there, the gate
fails loudly at load time (never silently). This is the one known
environmental limitation.

## Scope

In scope: setVariable, increase/decreaseVariableByNumber, condition, repeat,
while (curated only), break/continue/return, comment, calculate, and value
functions (getVariable, calculate, concat, comparisons). Nondeterministic
functions (random/time/playerCount) and all entity/physics/network actions are
deliberately OUT of scope.

## Condition encoding

Conditions MUST use taro's native array form:

    [ { "operator": ">" }, <leftOperand>, <rightOperand> ]

taro's `ConditionComponent.run` destructures `[opObj, left, right]` and accepts
no other shape. The TS `ConditionEvaluator` also accepts this array form, so a
single encoding feeds both engines. (The object form
`{operator, operandA, operandB}` works only on the TS side and will throw in
taro — do not use it in fixtures or the generator.)

## The fuzz generator is numeric-only by design

`fuzz/generator.ts` emits a **tamed, numeric-only** grammar: numeric variable
initial values, a numeric value pool, and arithmetic limited to `+ - *`. This
is deliberate: the gate measures genuine **logic** parity, not type-coercion
behaviour. taro and the TS port legitimately diverge on coercion / NaN /
divide-by-zero edges (e.g. taro string-concatenates `"" += 5` → `"5"`, returns
`undefined` on divide-by-zero; the TS engine coerces numerically). Those edges
are documented by dedicated **curated** fixtures (e.g.
`cases/05-string-concat-coercion.json`) and are never fuzzed, so a single
pathological generated input cannot swamp the gate.

## Adding cases

- Curated: drop a JSON file in `cases/` matching the `Case` shape in
  `types.ts`. Declare every variable in `initialVars` (taro's setVariable
  no-ops on undeclared names). Use array-form conditions.
- Fuzz: edit the `SEEDS` array in `differential.test.ts`. The generator is
  seeded and deterministic, so a failing seed is permanently reproducible.

## Known normalization

taro reads `action.variable` for increase/decrease; the TS engine reads
`action.variableName`. `caseAdapter.ts` mirrors the key so the gate compares
execution semantics, not action-schema naming. This and the array-form
condition encoding are the only intentional normalizations; there is no
behaviour waiver mechanism — taro is the oracle.
