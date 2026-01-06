/**
 * Debug UI - Simple stats overlay for game instances
 *
 * Usage:
 *   Modu.enableDebugUI(game);  // Pass game instance
 *   Modu.setDebugHash(() => computeMyHash()); // Optional: show live state hash
 *
 * Also enables determinism guard to warn about non-deterministic function calls.
 */

import { enableDeterminismGuard } from './determinism-guard';
import type { Game } from '../game';
import { ENGINE_VERSION } from '../version';

/** Interface for objects that can be displayed in debug UI */
export interface DebugUITarget {
    getClientId(): string | null;
    getFrame(): number;
    getNodeUrl(): string | null;
    getLastSnapshot(): { hash: string | null; frame: number; size: number; entityCount: number };
    getServerFps(): number;
    getRoomId(): string | null;
    getUploadRate(): number;
    getDownloadRate(): number;
    getClients(): string[];
    getStateHash(): string;
    isAuthority?(): boolean;
    getDriftStats?(): { determinismPercent: number; totalChecks: number; matchingFieldCount: number; totalFieldCount: number };
}

export interface DebugUIOptions {
    /** Position: 'top-right' (default), 'top-left', 'bottom-right', 'bottom-left' */
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

let debugDiv: HTMLDivElement | null = null;
let updateInterval: number | null = null;
let hashCallback: (() => string | number) | null = null;
let debugTarget: DebugUITarget | null = null;

// FPS tracking
let lastFrameTime = 0;
let frameCount = 0;
let renderFps = 0;
let fpsUpdateTime = 0;

/**
 * Set a callback to compute the current state hash for debug display.
 * The hash will be shown in the debug UI and should change as bodies move.
 */
export function setDebugHash(callback: () => string | number): void {
    hashCallback = callback;
}

/**
 * Enable debug UI overlay - shows frame, client, node, snapshot info automatically
 * @param target - Object implementing DebugUITarget interface
 * @param options - UI options
 */
export function enableDebugUI(target?: DebugUITarget, options: DebugUIOptions = {}): HTMLDivElement {
    if (debugDiv) return debugDiv;

    // Store target reference for updates
    debugTarget = target || null;

    // Enable determinism guard if target is a Game instance
    if (target && 'world' in target) {
        enableDeterminismGuard(target as unknown as Game);
    }

    const pos = options.position || 'top-right';

    debugDiv = document.createElement('div');
    debugDiv.id = 'modu-debug-ui';
    debugDiv.style.cssText = `
        position: fixed;
        ${pos.includes('top') ? 'top: 10px' : 'bottom: 10px'};
        ${pos.includes('right') ? 'right: 10px' : 'left: 10px'};
        background: rgba(0, 0, 0, 0.8);
        color: #0f0;
        font: 12px monospace;
        padding: 8px 12px;
        border-radius: 4px;
        z-index: 10000;
        min-width: 180px;
        user-select: text;
        cursor: text;
        
    `;
    document.body.appendChild(debugDiv);

    // Update loop
    const update = (now: number) => {
        if (!debugDiv) return;

        // Calculate render FPS
        frameCount++;
        if (now - fpsUpdateTime >= 1000) {
            renderFps = frameCount;
            frameCount = 0;
            fpsUpdateTime = now;
        }

        const eng = debugTarget;
        if (!eng) {
            debugDiv.innerHTML = '<div style="color:#f00">No engine instance</div>';
            return;
        }

        const clientId = eng.getClientId();
        const frame = eng.getFrame();
        const nodeUrl = eng.getNodeUrl();
        const lastSnap = eng.getLastSnapshot();
        const fps = eng.getServerFps();
        const roomId = eng.getRoomId();
        const up = eng.getUploadRate();
        const down = eng.getDownloadRate();
        const clients = eng.getClients();
        const isAuthority = (eng as any).isAuthority?.() || false;

        // Compute live state hash (use custom callback if set, otherwise use engine's hash)
        let currentHash = '--------';
        try {
            if (hashCallback) {
                const hash = hashCallback();
                currentHash = typeof hash === 'number' ? hash.toString(16).padStart(8, '0') : String(hash).slice(0, 8);
            } else {
                currentHash = eng.getStateHash();
            }
        } catch (e) {
            currentHash = 'error';
        }

        // Format bandwidth with appropriate unit
        const formatBandwidth = (bytes: number): string => {
            if (bytes >= 1024) {
                return (bytes / 1024).toFixed(1) + ' kB/s';
            }
            return Math.round(bytes) + ' B/s';
        };
        const upStr = formatBandwidth(up);
        const downStr = formatBandwidth(down);

        // Get drift stats (field-by-field comparison)
        const driftStats = (eng as any).getDriftStats?.() || { determinismPercent: 100, totalChecks: 0, matchingFieldCount: 0, totalFieldCount: 0 };
        const detPct = (Math.floor(driftStats.determinismPercent * 10) / 10).toFixed(1);
        const detColor = driftStats.determinismPercent === 100 ? '#0f0' :
                        driftStats.determinismPercent >= 99 ? '#ff0' : '#f00';

        // Format sync status
        let syncStatus: string;
        if (isAuthority) {
            syncStatus = '<span style="color:#888">I\'m authority</span>';
        } else if (driftStats.totalChecks === 0) {
            syncStatus = '<span style="color:#888">waiting...</span>';
        } else {
            syncStatus = `<span style="color:${detColor}">${detPct}%</span> <span style="color:#888">(${driftStats.matchingFieldCount}/${driftStats.totalFieldCount})</span>`;
        }

        // Format received snapshot info with frames ago
        const framesAgo = lastSnap.frame ? frame - lastSnap.frame : 0;
        const snapInfo = lastSnap.hash ? `${lastSnap.hash.slice(0, 8)} <span style="color:#888">(${framesAgo} ago)</span>` : 'none';

        // Format size with appropriate units
        const formatSize = (bytes: number): string => {
            if (bytes >= 1024 * 1024) {
                return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (bytes >= 1024) {
                return (bytes / 1024).toFixed(1) + ' KB';
            }
            return bytes + ' B';
        };
        const sizeStr = lastSnap.size > 0 ? formatSize(lastSnap.size) : '-';
        const entityStr = lastSnap.entityCount > 0 ? String(lastSnap.entityCount) : '-';

        // Section header style
        const sectionStyle = 'color:#666;font-size:10px;margin-top:6px;margin-bottom:2px;border-bottom:1px solid #333;';

        debugDiv.innerHTML = `
            <div style="${sectionStyle}">ROOM</div>
            <div>ID: <span style="color:#fff">${roomId || '-'}</span></div>
            <div>Players: <span style="color:#ff0">${clients.length}</span></div>
            <div>Frame: <span style="color:#fff">${frame}</span></div>
            <div>URL: <span style="color:#0ff">${nodeUrl || '-'}</span></div>

            <div style="${sectionStyle}">ME</div>
            <div>Authority: <span style="color:${isAuthority ? '#0ff' : '#888'}">${isAuthority ? 'Yes' : 'No'}</span></div>
            <div>Client: <span style="color:#ff0">${clientId ? clientId.slice(0, 8) : '-'}</span></div>

            <div style="${sectionStyle}">ENGINE</div>
            <div>Commit: <span style="color:#888">${ENGINE_VERSION}</span></div>
            <div>FPS: <span style="color:#0f0">${renderFps}</span> render, <span style="color:#0f0">${fps}</span> tick</div>
            <div>Net: <span style="color:#0f0">${upStr}</span> up, <span style="color:#f80">${downStr}</span> down</div>

            <div style="${sectionStyle}">SNAPSHOT</div>
            <div>Current: <span style="color:#f0f">${currentHash}</span></div>
            <div>Received: <span style="color:#f80">${snapInfo}</span></div>
            <div>Size: <span style="color:#fff">${sizeStr}</span>, Entities: <span style="color:#fff">${entityStr}</span></div>
            <div>Last Sync: ${syncStatus}</div>
        `;
    };

    // Update every frame
    const loop = (now: number) => {
        update(now);
        updateInterval = requestAnimationFrame(loop) as unknown as number;
    };
    fpsUpdateTime = performance.now();
    requestAnimationFrame(loop);

    return debugDiv;
}

/**
 * Disable debug UI
 */
export function disableDebugUI(): void {
    if (updateInterval) {
        cancelAnimationFrame(updateInterval);
        updateInterval = null;
    }
    if (debugDiv) {
        debugDiv.remove();
        debugDiv = null;
    }
    debugTarget = null;
}

/**
 * Check if debug UI is enabled
 */
export function isDebugUIEnabled(): boolean {
    return debugDiv !== null;
}
