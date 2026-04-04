# Modu Editor Refactor Plan

**Date:** 2026-04-04
**Scope:** Refactor the moddio/editor React app to work with Modu Engine
**Source:** /root/moddio-editor (clone of github.com/moddio/editor)

---

## 1. Current State

The editor is a React app (CRA + craco, TypeScript, Redux, Tailwind) that:
- Communicates with the game engine via `window.taro` and `window.inGameEditor` globals
- Saves game data via API calls (`POST /api/game/{id}/update-fragment`)
- Uses a visual action/trigger tree for scripting (generates JSON action trees)
- Has Monaco editor integrated (currently for raw JSON editing only)
- Uploads assets to S3, stores URLs in game data JSON (e.g., `cellSheet.url: "https://cache.modd.io/asset/..."`)

---

## 2. Game Data Storage Architecture

### The Problem

Currently everything lives in one monolithic `game.json` — entity defs, scripts (as JSON action trees), map data, variables, asset URLs, settings. This is what the API saves/loads.

### The New Format

**Game data stays as a single JSON document** — but with a cleaner structure and JS scripts instead of JSON actions.

```json
{
  "version": "2.0",
  "settings": {
    "physicsEngine": "rapier2d",
    "frameRate": 60,
    "maxPlayers": 32,
    "mapBackgroundColor": "#1a1a2e"
  },
  "map": {
    "width": 64, "height": 64, "tilewidth": 64, "tileheight": 64,
    "layers": [...],
    "tilesets": [...]
  },
  "entities": {
    "unitTypes": {
      "zombie": {
        "name": "Zombie",
        "cellSheet": { "url": "https://cache.modd.io/asset/.../zombie.png", "cols": 4, "rows": 4 },
        "body": { "type": "dynamic", "width": 58, "height": 58, "fixtures": [...] },
        "attributes": { "health": { "value": 100, "max": 100, "regen": 0 } },
        "animations": { "idle": { "frames": [0,1,2,3], "fps": 8 } },
        "scripts": ["onZombieDeath", "zombieAI"]
      }
    },
    "itemTypes": { ... },
    "projectileTypes": { ... },
    "playerTypes": { ... }
  },
  "scripts": {
    "initialize": {
      "name": "initialize",
      "triggers": ["gameStart"],
      "code": "const ai = vars.get('ai');\nworld.createUnit('zombie', { x: 1906, y: 2558, player: ai });\nworld.createUnit('zombie', { x: 1834, y: 2645, player: ai });"
    },
    "playerJoins": {
      "name": "playerJoins",
      "triggers": ["playerJoined"],
      "code": "on('playerJoined', (player) => {\n  player.createUnit('human', { x: 500, y: 500 });\n});"
    },
    "everySecond": {
      "name": "everySecond",
      "triggers": ["interval"],
      "interval": 1000,
      "code": "const timeLeft = vars.get('timeLeft');\nvars.set('timeLeft', timeLeft - 1);\nif (timeLeft <= 0) { world.emit('gameOver'); }"
    }
  },
  "variables": {
    "timeLeft": { "value": 300, "type": "number" },
    "ai": { "value": null, "type": "player" },
    "zombieTimerMessage": { "value": "", "type": "string" }
  },
  "abilities": { ... },
  "attributes": { ... },
  "assets": {
    "images": [
      { "key": "zombie_sprite", "url": "https://cache.modd.io/asset/.../zombie.png" }
    ],
    "sounds": [],
    "tilesets": [
      { "key": "tileset1", "url": "https://cache.modd.io/asset/.../tiles.png", "tileWidth": 64, "tileHeight": 64 }
    ]
  }
}
```

### Key Decisions

**Scripts are JS code strings inside the JSON**, not separate files. Why:
- The editor saves via API fragment updates — writing individual `.js` files to a filesystem doesn't fit this model
- The backend stores game data in a database, not a filesystem
- Keeping scripts as strings in the JSON means one API call updates a script — same pattern as today
- The engine reads `scripts.initialize.code`, passes the string to `ScriptEngine.load("initialize", code)` — done
- Monaco editor in the editor app edits these strings directly
- No transpilation at runtime — code is already JS

**Assets stay as S3 URLs**. No change needed. Upload flow remains:
1. Editor uploads file to S3 (via `react-s3-uploader`)
2. Gets back a URL (`https://cache.modd.io/asset/...`)
3. Stores URL in entity definition (`cellSheet.url`, `sound.url`, etc.)
4. Engine fetches assets at runtime via the URLs

**Entity-specific scripts** (e.g., "when this unit dies") are referenced by name in the entity definition (`"scripts": ["onZombieDeath"]`) and defined in the top-level `scripts` object. This replaces the old pattern of embedding action trees inside entity definitions.

### Migration from Old Format

One-time migration (run once per game):

```
Old game.json
    |
    v
migrate command
    |
    ├─> scripts.initialize.actions (JSON tree) → scripts.initialize.code (JS string)
    ├─> Entity-embedded scripts → extracted to top-level scripts, referenced by name
    ├─> Asset URLs → moved to assets section (also kept inline for backward compat)
    ├─> Top-level metadata stripped (playCount, owner, etc. — that's platform data, not game data)
    └─> Version set to "2.0"
    |
    v
New game.json (v2.0)
```

---

## 3. Editor Refactor Scope

### 3.1 Bridge Rename (`taro` → `modu`)

**Files affected:**
- `src/components/InitFunctions.js` — bridge setup (27 refs to `taro`)
- `src/lib/helpers.js` — `editEntity()`, 50+ refs to `taro`
- `src/helpers/scripting.ts` — script emit, 15+ refs
- `src/components/UpdateEntity.tsx` — script sync, 10+ refs
- `src/contexts/editor-context.js` — dev mode calls
- `src/ts/types/globals.d.ts` — TypeScript declarations

**Change:** Global find-replace `window.taro` → `window.modu`, update TypeScript declarations.

**Bridge mapping:**
| Old (taro) | New (modu) |
|------------|-----------|
| `taro.game.data` | `modu.gameData` |
| `taro.developerMode.editEntity(data)` | `modu.editor.editEntity(data)` |
| `taro.developerMode.editTile(data)` | `modu.editor.editTile(data)` |
| `taro.client.emit('applyScriptChanges', data)` | `modu.events.emit('applyScriptChanges', data)` |
| `taro.client.emit('applyVariableChanges', data)` | `modu.events.emit('applyVariableChanges', data)` |
| `taro.developerMode.serverScriptData` | `modu.editor.serverScriptData` |

### 3.2 Script Editor: JSON Actions → JS Code

**Current:** Visual tree UI generates JSON action objects. Monaco shows raw JSON.

**New:** The script editor becomes a **dual-mode editor**:

1. **Visual mode** (default for beginners) — same tree UI, but the output is JS code. Each action node maps to a JS function call:

| JSON Action | JS Output |
|-------------|-----------|
| `{ type: "createEntityForPlayerAtPositionWithDimensions", entityType: "unitTypes", entity: "zombie", position: { function: "xyCoordinate", x: 100, y: 200 } }` | `world.createUnit('zombie', { x: 100, y: 200, player: vars.get('ai') });` |
| `{ type: "condition", conditions: [...], then: [...], else: [...] }` | `if (unit.attr('health') > 50) { ... } else { ... }` |
| `{ type: "setEntityAttribute", attributeType: "health", value: 100 }` | `self.attr('health', 100);` |

The visual UI still works the same way for users — they pick actions from dropdowns, set parameters. But under the hood, the output stored in the JSON is JS code, not a JSON action tree.

2. **Code mode** (for advanced users / AI) — full Monaco editor with JS syntax highlighting, autocomplete for the Modu scripting API (`on`, `every`, `world.*`, `self.*`, `vars.*`). Users edit JS directly.

**Implementation:** The visual tree UI becomes a code generator. Each action node has a `toJS()` method that produces a JS string. When the user adds/modifies an action in the visual tree, the tree rebuilds the full JS code string and saves it.

### 3.3 Save Format Update

**Current:** `game.service.js` calls `POST /api/game/{id}/update-fragment` with keys like `['data.unitTypes.zombie']` and fragment values.

**New:** Same API pattern, but:
- Script fragments contain `code` (JS string) instead of `actions` (JSON tree)
- Entity fragments no longer contain embedded action trees
- New `version: "2.0"` field in game data

**File:** `src/services/old-sandbox/services/game.service.js`

Changes:
- `updateFragment()` stays the same (it's already key-based patching)
- `processGameJson()` needs to handle v2.0 format
- `readGameJson()` needs to detect version and auto-migrate v1 → v2

### 3.4 Asset Management

**No changes needed.** The existing flow works:

```
User uploads image in editor
    → react-s3-uploader → S3
    → Returns URL (https://cache.modd.io/asset/...)
    → Stored in entity definition (cellSheet.url)
    → Engine fetches at runtime
```

The only cleanup: consolidate all asset URLs into an `assets` section in the game data for easier preloading. Entity definitions still reference assets by URL inline — the `assets` section is an index for the asset loader, not a replacement.

### 3.5 Engine-Side Bridge Implementation

**File:** `~/modu-engine/engine/client/EditorIntegration.ts` (new)

```ts
// Exposes window.modu with the API the editor expects
export class EditorIntegration {
  // Set up window.modu.editor, window.modu.events, window.modu.gameData
  // Handle incoming editor commands
  // Sync game state back to editor via window.inGameEditor callbacks
}
```

**File:** Update `~/modu-engine/editor/EditorBridge.ts`

Add methods matching the bridge mapping table above. The editor calls `window.modu.editor.editEntity(data)` → EditorBridge receives it → applies to engine state → syncs back via `window.inGameEditor.updateEntity()`.

---

## 4. Migration Strategy

### Phase 1: Engine-side bridge (Modu Engine repo)
1. Create `EditorIntegration.ts` that exposes `window.modu` with the API surface the editor expects
2. Update `EditorBridge.ts` to handle all editor commands
3. Create `GameLoader.ts` that reads v2.0 game data JSON and bootstraps the engine
4. Create `GameMigrator.ts` that converts v1 (old) game.json to v2.0 format
5. Test with the sample game.json already in the repo

### Phase 2: Editor bridge rename (Editor repo)
1. Fork or branch the editor repo
2. Global rename `window.taro` → `window.modu` with updated API paths
3. Update TypeScript declarations (`globals.d.ts`)
4. Update `InitFunctions.js` bridge setup
5. Test that the editor loads and connects to Modu Engine

### Phase 3: Script editor upgrade (Editor repo)
1. Add `toJS()` code generation to each action node type
2. Add dual-mode toggle (visual ↔ code) to the script editor panel
3. Configure Monaco for JS with Modu API autocomplete
4. Update `scripting.ts` helpers to work with JS code strings
5. Update `emitScriptChangesToNetwork()` to send code strings

### Phase 4: Save format migration (Editor repo + Backend)
1. Update `processGameJson()` to handle v2.0 format
2. Add auto-migration in `readGameJson()` (detect v1, run migrator)
3. Update `updateFragment()` calls for new script format
4. Backend API: accept v2.0 game data format

### Phase 5: Testing & rollout
1. Migrate sample games using GameMigrator
2. Test full editor → engine → save → reload cycle
3. Test visual scripting → JS output → engine execution
4. Test code editor → save → engine execution
5. Test asset upload → reference → render
6. Gradual rollout: new games use v2.0, existing games auto-migrate on first edit

---

## 5. File-by-File Change List (Editor Repo)

| File | Changes |
|------|---------|
| `src/components/InitFunctions.js` | Rename `taro` → `modu`, update bridge method names |
| `src/lib/helpers.js` | Rename `taro` → `modu`, update `editEntity()` to new API |
| `src/helpers/scripting.ts` | Add `toJS()` code generation, update emit to send JS code |
| `src/components/UpdateEntity.tsx` | Rename bridge calls, handle JS code format |
| `src/contexts/editor-context.js` | Rename dev mode references |
| `src/ts/types/globals.d.ts` | Replace `taro` type declarations with `modu` |
| `src/components/EntityScriptWindow.js` | Add visual/code mode toggle |
| `src/components/custom/CustomMonacoEditor.tsx` | Configure JS language, add Modu API autocomplete |
| `src/services/old-sandbox/services/game.service.js` | Update `processGameJson()` for v2.0 |
| `src/services/old-sandbox/services/read-game-json.service.js` | Add v1→v2 migration detection |

---

## 6. File-by-File Change List (Modu Engine Repo)

| File | Changes |
|------|---------|
| `engine/client/EditorIntegration.ts` | NEW — expose `window.modu` API for editor |
| `engine/core/GameLoader.ts` | NEW — read v2.0 game.json, bootstrap engine |
| `engine/core/GameMigrator.ts` | NEW — convert v1 game.json to v2.0 |
| `editor/EditorBridge.ts` | UPDATE — add all bridge methods matching editor expectations |
| `editor/DevMode.ts` | UPDATE — wire up to EditorIntegration |

---

## 7. Summary

| Aspect | Old | New |
|--------|-----|-----|
| Game data format | Monolithic game.json v1 | Cleaner game.json v2.0 |
| Script format | JSON action trees | JS code strings |
| Script storage | Embedded in game.json `scripts` | Same location, but `code` field instead of `actions` |
| Asset storage | S3 URLs in entity definitions | Same (no change) |
| Asset index | None | Optional `assets` section for preloading |
| Editor ↔ Engine bridge | `window.taro` | `window.modu` |
| Script editor | Visual tree only | Visual tree + code editor (dual mode) |
| Visual tree output | JSON action objects | JS code strings |
| Save mechanism | API fragment updates | Same API, new format |
| Migration | N/A | One-time auto-migration v1 → v2 |
