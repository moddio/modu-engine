import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

const docsDir = path.join(process.cwd(), '..', 'docs', 'public', 'sdk');
const distDir = path.join(process.cwd(), 'dist');

// Ensure output directories exist
if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
}
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

console.log('Building Modu Engine for Browser...\n');

// Generate build timestamp banner
const buildDate = new Date().toISOString();
const banner = `/* Modu Engine - Built: ${buildDate} */\n`;

// Read network SDK source
const networkSdkPath = path.join(process.cwd(), '..', 'network', 'sdk', 'dist', 'modu-network.iife.js');
let networkSdkCode = '';
if (fs.existsSync(networkSdkPath)) {
    networkSdkCode = fs.readFileSync(networkSdkPath, 'utf-8');
    console.log('Loaded network SDK from:', networkSdkPath);
} else {
    console.log('Warning: Network SDK not found at', networkSdkPath);
}

// Footer to expose common APIs directly on window
const globalExports = `
// Expose common APIs directly on window for cleaner usage
if (typeof window !== 'undefined') {
    // Game creation
    window.createGame = Modu.createGame;

    // Components
    window.Transform2D = Modu.Transform2D;
    window.Body2D = Modu.Body2D;
    window.Player = Modu.Player;
    window.Sprite = Modu.Sprite;

    // Constants
    window.SHAPE_CIRCLE = Modu.SHAPE_CIRCLE;
    window.SHAPE_RECT = Modu.SHAPE_RECT;
    window.SPRITE_IMAGE = Modu.SPRITE_IMAGE;
    window.BODY_DYNAMIC = Modu.BODY_DYNAMIC;
    window.BODY_STATIC = Modu.BODY_STATIC;
    window.BODY_KINEMATIC = Modu.BODY_KINEMATIC;

    // Plugins
    window.Physics2DSystem = Modu.Physics2DSystem;
    window.Simple2DRenderer = Modu.Simple2DRenderer;
    window.InputPlugin = Modu.InputPlugin;

    // Utilities
    window.defineComponent = Modu.defineComponent;
    window.dRandom = Modu.dRandom;
    window.dSqrt = Modu.dSqrt;
    window.toFixed = Modu.toFixed;
    window.toFloat = Modu.toFloat;
    window.fpMul = Modu.fpMul;
    window.fpDiv = Modu.fpDiv;
    window.fpSqrt = Modu.fpSqrt;
    window.fpAbs = Modu.fpAbs;
}
`;

// Build standalone IIFE bundle (engine only)
async function buildEngineIIFE() {
    const result = await esbuild.build({
        entryPoints: ['src/index.ts'],
        bundle: true,
        format: 'iife',
        globalName: 'Modu',
        write: false,
        platform: 'browser',
        target: 'es2020',
        define: {
            'process.env.NODE_ENV': '"production"',
        },
    });
    return result.outputFiles[0].text + globalExports;
}

// Build combined IIFE (network + engine)
async function buildCombinedIIFE(outDir, filename) {
    const engineCode = await buildEngineIIFE();

    // Combine: network SDK first (sets window.moduNetwork), then engine
    const combined = `${banner}// Modu Engine + Network SDK Combined Bundle
${networkSdkCode}
${engineCode}`;

    fs.writeFileSync(path.join(outDir, filename), combined);
    console.log('Built:', path.join(outDir, filename));
}

// Build minified combined IIFE
async function buildMinifiedCombined(outDir, filename) {
    const engineResult = await esbuild.build({
        entryPoints: ['src/index.ts'],
        bundle: true,
        format: 'iife',
        globalName: 'Modu',
        write: false,
        platform: 'browser',
        target: 'es2020',
        minify: true,
        define: {
            'process.env.NODE_ENV': '"production"',
        },
    });
    const engineCode = engineResult.outputFiles[0].text;

    // Minify network SDK too
    const networkMinified = networkSdkCode ? (await esbuild.transform(networkSdkCode, { minify: true })).code : '';

    const combined = `${banner}${networkMinified}${engineCode}`;
    fs.writeFileSync(path.join(outDir, filename), combined);
    console.log('Built:', path.join(outDir, filename));
}

// Build ESM bundle (for module imports)
async function buildESM(outDir, filename) {
    await esbuild.build({
        entryPoints: ['src/index.ts'],
        bundle: true,
        format: 'esm',
        outfile: path.join(outDir, filename),
        platform: 'browser',
        target: 'es2020',
        define: {
            'process.env.NODE_ENV': '"production"',
        },
    });
    console.log('Built:', path.join(outDir, filename));
}

// Build to docs/public/sdk (for website)
await buildCombinedIIFE(docsDir, 'modu.iife.js');
await buildMinifiedCombined(docsDir, 'modu.min.js');
await buildESM(docsDir, 'modu.js');

// Build to dist (for examples and CDN)
await buildCombinedIIFE(distDir, 'modu.iife.js');
await buildMinifiedCombined(distDir, 'modu.min.js');
await buildESM(distDir, 'modu.js');

console.log('\nBuild complete!');
