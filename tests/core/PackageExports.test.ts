import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/**
 * `modu-engine` is consumed by other workspaces through its `exports` map — notably
 * `packages/web`, whose `/play/[slug]` page imports `modu-engine/core/GameDenormalizer`
 * on the server. Nothing in this package's own build or test run touches that map, so a
 * rename or a moved file would break a *different* workspace's build with no signal
 * here. These guards give that signal.
 */
const pkgPath = path.resolve(__dirname, '../../package.json');
const pkgDir = path.dirname(pkgPath);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

describe('package exports', () => {
  it('declares an exports map', () => {
    expect(pkg.exports, 'modu-engine must stay importable as a package').toBeTruthy();
  });

  it('points its root export and types at files that exist', () => {
    for (const field of ['types'] as const) {
      const target = pkg[field];
      expect(target, `package.json "${field}" is missing`).toBeTruthy();
      expect(fs.existsSync(path.resolve(pkgDir, target)), `"${field}" → ${target} does not exist`).toBe(true);
    }
    const root = pkg.exports['.'];
    expect(fs.existsSync(path.resolve(pkgDir, root)), `exports["."] → ${root} does not exist`).toBe(true);
  });

  it('resolves the subpaths other workspaces actually import', () => {
    // Kept as a literal list rather than a glob: the point is to fail when one of
    // these specific import sites would break, and a glob over the tree would pass
    // vacuously if the file were deleted along with its importer.
    const consumed = [
      'modu-engine/core/GameDenormalizer', // packages/web → play/[slug]/page.tsx
      'modu-engine/core/GameMigrator',
      'modu-engine/server/GameServer',
    ];
    const require = createRequire(pkgPath);
    for (const spec of consumed) {
      expect(
        () => require.resolve(spec),
        `${spec} no longer resolves — a consumer's build will break, not this suite`,
      ).not.toThrow();
    }
  });

  it('exposes denormalize3DGameData through the subpath web imports', async () => {
    const mod = await import('../../engine/core/GameDenormalizer');
    expect(typeof mod.denormalize3DGameData).toBe('function');
  });

  it('is registered as a workspace so the subpaths link', () => {
    const root = JSON.parse(fs.readFileSync(path.resolve(pkgDir, '../../package.json'), 'utf8'));
    expect(root.workspaces).toContain('packages/engine');
  });
});
