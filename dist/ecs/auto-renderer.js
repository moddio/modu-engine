/**
 * Auto-Renderer - Automatically renders entities with Sprite + Transform2D
 */
import { Sprite, SHAPE_RECT, SHAPE_CIRCLE, SPRITE_IMAGE } from './components';
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
export class AutoRenderer {
    constructor(game, canvas, options = {}) {
        this.imageCache = new Map();
        this.game = game;
        // Accept either element or selector
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
        this.options = {
            background: options.background ?? '#111',
            autoClear: options.autoClear ?? true
        };
        // Attach to game
        game.setRenderer(this);
    }
    /** Canvas width */
    get width() { return this.canvas.width; }
    /** Canvas height */
    get height() { return this.canvas.height; }
    /** The canvas element */
    get element() { return this.canvas; }
    /** The 2D context (for custom drawing) */
    get context() { return this.ctx; }
    /**
     * Render all entities with Sprite component.
     */
    render() {
        const { ctx, canvas, options, game } = this;
        // Clear
        if (options.autoClear) {
            ctx.fillStyle = options.background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // Get interpolation alpha (0-1 between physics ticks)
        const alpha = game.getRenderAlpha();
        // Collect entities with Sprite, sorted by layer
        const entities = [];
        for (const entity of game.getAllEntities()) {
            try {
                const sprite = entity.get(Sprite);
                if (sprite && sprite.visible) {
                    // Calculate interpolated position for smooth rendering
                    entity.interpolate(alpha);
                    entities.push({ entity, layer: sprite.layer });
                }
            }
            catch {
                // Entity doesn't have Sprite
            }
        }
        // Sort by layer (lower first)
        entities.sort((a, b) => a.layer - b.layer);
        // Draw each entity
        for (const { entity } of entities) {
            this.drawEntity(entity);
        }
    }
    /**
     * Draw a single entity.
     */
    drawEntity(entity) {
        const { ctx, game } = this;
        const sprite = entity.get(Sprite);
        // Use interpolated position for smooth rendering between physics ticks
        const x = entity.render.interpX + sprite.offsetX;
        const y = entity.render.interpY + sprite.offsetY;
        const scaleX = sprite.scaleX;
        const scaleY = sprite.scaleY;
        // Get color string
        const colorStr = game.getString('color', sprite.color) || '#fff';
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scaleX, scaleY);
        const shape = sprite.shape;
        if (shape === SHAPE_CIRCLE) {
            const radius = sprite.radius;
            ctx.fillStyle = colorStr;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        else if (shape === SHAPE_RECT) {
            const w = sprite.width;
            const h = sprite.height;
            ctx.fillStyle = colorStr;
            ctx.fillRect(-w / 2, -h / 2, w, h);
        }
        else if (shape === SPRITE_IMAGE) {
            const imageId = game.getString('sprite', sprite.spriteId);
            if (imageId) {
                const img = this.getImage(imageId);
                if (img && img.complete) {
                    const w = sprite.width || img.width;
                    const h = sprite.height || img.height;
                    ctx.drawImage(img, -w / 2, -h / 2, w, h);
                }
            }
        }
        ctx.restore();
    }
    /**
     * Get or load an image.
     */
    getImage(src) {
        let img = this.imageCache.get(src);
        if (!img) {
            img = new Image();
            img.src = src;
            this.imageCache.set(src, img);
        }
        return img;
    }
    /**
     * Preload images for faster rendering.
     */
    preload(images) {
        return Promise.all(images.map(src => new Promise((resolve) => {
            const img = this.getImage(src);
            if (img?.complete) {
                resolve();
            }
            else if (img) {
                img.onload = () => resolve();
                img.onerror = () => resolve();
            }
        }))).then(() => { });
    }
}
