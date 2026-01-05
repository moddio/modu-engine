/**
 * Canvas Renderer - Simple 2D rendering for entities
 *
 * Usage:
 *   const renderer = new CanvasRenderer('#game');
 */
import { ModuEngine } from './engine';
import { Entity } from './entity';
/** @internal Set engine reference for CanvasRenderer */
export declare function setCanvasRendererEngineRef(engine: ModuEngine): void;
export interface RendererOptions {
    /** Background color (default: '#1a1a2e') */
    background?: string;
    /** Grid color (null to disable grid, default: '#252540') */
    gridColor?: string | null;
    /** Grid size in pixels (default: 40) */
    gridSize?: number;
}
export declare class CanvasRenderer {
    private canvas;
    private ctx;
    private engine;
    private options;
    private prevStates;
    /**
     * Custom entity drawing callback. If set, replaces the default rendering.
     * Receives: (ctx, entity, interpolatedPosition, alpha)
     */
    drawEntity: ((ctx: CanvasRenderingContext2D, entity: Entity, pos: {
        x: number;
        y: number;
    }, alpha: number) => void) | null;
    constructor(canvas: HTMLCanvasElement | string, options?: RendererOptions);
    /** Canvas width */
    get width(): number;
    /** Canvas height */
    get height(): number;
    /** The canvas element (for event listeners) */
    get element(): HTMLCanvasElement;
    /**
     * Render all entities
     */
    render(): void;
    /**
     * Get interpolated position for smooth rendering.
     * Lerps between previous tick position and current position based on alpha.
     * This provides smooth 60fps rendering even when physics runs at 20fps.
     */
    private getInterpolatedPos;
    /**
     * Get the raw (non-interpolated) position for an entity.
     * Use this for the local player to avoid input lag.
     */
    getRawPosition(entity: Entity): {
        x: number;
        y: number;
    };
    /**
     * Save current positions as previous (call at start of each tick)
     */
    savePrevState(): void;
    /**
     * Render a single entity based on its sync properties
     */
    private renderEntity;
}
