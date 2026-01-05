/**
 * SimpleRenderer - Basic 2D canvas renderer for entities with Sprite component
 */
import { Game } from '../game';
export interface SimpleRendererOptions {
    /** Background color (default: '#111') */
    background?: string;
    /** Whether to clear canvas each frame (default: true) */
    autoClear?: boolean;
}
/**
 * Simple 2D renderer that draws all entities with Sprite component.
 *
 * Can be used as a plugin via game.addPlugin() or standalone.
 *
 * @example
 * // Plugin pattern (recommended)
 * game.addPlugin(SimpleRenderer, canvas);
 *
 * // Standalone pattern
 * new SimpleRenderer(game, canvas);
 */
export declare class SimpleRenderer {
    private canvas;
    private ctx;
    private game;
    private options;
    private imageCache;
    constructor(game: Game, canvas: HTMLCanvasElement | string, options?: SimpleRendererOptions);
    /** Canvas width */
    get width(): number;
    /** Canvas height */
    get height(): number;
    /** The canvas element */
    get element(): HTMLCanvasElement;
    /** The 2D context (for custom drawing) */
    get context(): CanvasRenderingContext2D;
    /**
     * Render all entities with Sprite component.
     */
    render(): void;
    /**
     * Draw a single entity.
     */
    private drawEntity;
    /**
     * Get or load an image.
     */
    private getImage;
    /**
     * Preload images for faster rendering.
     */
    preload(images: string[]): Promise<void>;
}
