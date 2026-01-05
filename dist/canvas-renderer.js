/**
 * Canvas Renderer - Simple 2D rendering for entities
 *
 * Usage:
 *   const renderer = new CanvasRenderer('#game');
 */
import { toFloat } from './math/fixed';
// Global engine reference (set by setCanvasRendererEngineRef)
let engineRef = null;
/** @internal Set engine reference for CanvasRenderer */
export function setCanvasRendererEngineRef(engine) {
    engineRef = engine;
}
export class CanvasRenderer {
    constructor(canvas, options = {}) {
        this.prevStates = new WeakMap();
        /**
         * Custom entity drawing callback. If set, replaces the default rendering.
         * Receives: (ctx, entity, interpolatedPosition, alpha)
         */
        this.drawEntity = null;
        // Accept either element or selector string
        if (typeof canvas === 'string') {
            const el = document.querySelector(canvas);
            if (!el)
                throw new Error(`Canvas not found: ${canvas}`);
            this.canvas = el;
        }
        else {
            this.canvas = canvas;
        }
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            throw new Error('Could not get 2d context');
        this.ctx = ctx;
        // Use global engine reference
        if (!engineRef) {
            throw new Error('CanvasRenderer: Engine not initialized. Call Modu.init() first.');
        }
        this.engine = engineRef;
        this.options = {
            background: options.background ?? '#1a1a2e',
            gridColor: options.gridColor ?? '#252540',
            gridSize: options.gridSize ?? 40
        };
        // Auto-attach to engine for automatic rendering
        this.engine.setRenderer(this);
    }
    /** Canvas width */
    get width() { return this.canvas.width; }
    /** Canvas height */
    get height() { return this.canvas.height; }
    /** The canvas element (for event listeners) */
    get element() { return this.canvas; }
    /**
     * Render all entities
     */
    render() {
        const { ctx, canvas, options } = this;
        const W = canvas.width, H = canvas.height;
        const alpha = this.engine.getRenderAlpha();
        const em = this.engine.entityManager;
        // Background
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, W, H);
        // Grid
        if (options.gridColor) {
            ctx.strokeStyle = options.gridColor;
            for (let x = 0; x < W; x += options.gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
            }
            for (let y = 0; y < H; y += options.gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
            }
        }
        // Render entities by type (sorted for deterministic ordering)
        const types = Object.keys(em.byType).sort();
        for (const type of types) {
            const entities = em.byType[type] || [];
            for (const entity of entities) {
                this.renderEntity(entity, alpha);
            }
        }
    }
    /**
     * Get interpolated position for smooth rendering.
     * Lerps between previous tick position and current position based on alpha.
     * This provides smooth 60fps rendering even when physics runs at 20fps.
     */
    getInterpolatedPos(entity, alpha) {
        const phys = entity.getComponent('physics2d');
        if (!phys?.body)
            return { x: 0, y: 0 };
        const currX = toFloat(phys.body.position.x);
        const currY = toFloat(phys.body.position.y);
        // Get previous position from physics component
        const prev = phys.getPreviousPosition?.();
        if (!prev) {
            return { x: currX, y: currY };
        }
        // Lerp between previous and current for smooth rendering
        // Client-side prediction updates currX/currY immediately, so this still feels responsive
        return {
            x: prev.x + (currX - prev.x) * alpha,
            y: prev.y + (currY - prev.y) * alpha
        };
    }
    /**
     * Get the raw (non-interpolated) position for an entity.
     * Use this for the local player to avoid input lag.
     */
    getRawPosition(entity) {
        const phys = entity.getComponent('physics2d');
        if (!phys?.body)
            return { x: 0, y: 0 };
        return {
            x: toFloat(phys.body.position.x),
            y: toFloat(phys.body.position.y)
        };
    }
    /**
     * Save current positions as previous (call at start of each tick)
     */
    savePrevState() {
        const em = this.engine.entityManager;
        for (const entity of Object.values(em.entities)) {
            const body = entity.body;
            if (body) {
                this.prevStates.set(entity, {
                    x: toFloat(body.position.x),
                    y: toFloat(body.position.y),
                    angle: toFloat(body.angle)
                });
            }
        }
    }
    /**
     * Render a single entity based on its sync properties
     */
    renderEntity(entity, alpha) {
        const { ctx } = this;
        const pos = this.getInterpolatedPos(entity, alpha);
        // Use custom draw callback if set
        if (this.drawEntity) {
            this.drawEntity(ctx, entity, pos, alpha);
            return;
        }
        const sync = entity.sync;
        // Skip entities without visual properties
        if (sync.radius === undefined && sync.width === undefined)
            return;
        // Circle (has radius)
        if (sync.radius !== undefined) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, sync.radius, 0, Math.PI * 2);
            if (sync.color) {
                ctx.fillStyle = sync.color;
                ctx.fill();
            }
            if (sync.strokeColor) {
                ctx.strokeStyle = sync.strokeColor;
                ctx.lineWidth = sync.strokeWidth || 2;
                ctx.stroke();
            }
            return;
        }
        // Rectangle (has width/height)
        if (sync.width !== undefined && sync.height !== undefined) {
            const x = pos.x - sync.width / 2;
            const y = pos.y - sync.height / 2;
            if (sync.color) {
                ctx.fillStyle = sync.color;
                ctx.fillRect(x, y, sync.width, sync.height);
            }
            if (sync.strokeColor) {
                ctx.strokeStyle = sync.strokeColor;
                ctx.lineWidth = sync.strokeWidth || 2;
                ctx.strokeRect(x, y, sync.width, sync.height);
            }
        }
    }
}
