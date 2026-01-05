/**
 * Auto-Renderer - Automatically renders entities with Sprite + Transform2D
 */
import { Game } from './game';
export interface AutoRendererOptions {
    /** Background color (default: '#111') */
    background?: string;
    /** Whether to clear canvas each frame (default: true) */
    autoClear?: boolean;
}
/**
 * Simple auto-renderer that draws all entities with Sprite + Transform2D.
 *
 * Can be used as a plugin via game.addPlugin() or standalone.
 *
 * @example
 * // Plugin pattern (recommended)
 * game.addPlugin(AutoRenderer, canvas);
 *
 * // Standalone pattern
 * new AutoRenderer(game, canvas);
 */
export declare class AutoRenderer {
    private canvas;
    private ctx;
    private game;
    private options;
    private imageCache;
    constructor(game: Game, canvas: HTMLCanvasElement | string, options?: AutoRendererOptions);
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
