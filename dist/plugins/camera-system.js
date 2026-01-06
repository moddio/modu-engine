/**
 * CameraSystem - 2D camera management for ECS
 *
 * Updates Camera2D component based on follow target.
 * Handles zoom smoothing and position interpolation.
 *
 * This system is client-only - Camera2D component has sync: false.
 */
import { Camera2D, Transform2D } from '../components';
/**
 * CameraSystem - manages Camera2D components.
 *
 * @example
 * // Add as plugin
 * const cameraSystem = game.addPlugin(CameraSystem);
 *
 * // Create a camera entity
 * game.defineEntity('camera').with(Camera2D).register();
 * const camera = game.spawn('camera');
 *
 * // Follow an entity
 * cameraSystem.follow(camera, playerEntity);
 *
 * // Or manually set position
 * const cam = camera.get(Camera2D);
 * cam.x = 100;
 * cam.y = 200;
 * cam.zoom = 1.5;
 */
export class CameraSystem {
    constructor(game, options = {}) {
        this.game = game;
        this.options = {
            defaultZoom: options.defaultZoom ?? 1,
            defaultSmoothing: options.defaultSmoothing ?? 0.1,
            minZoom: options.minZoom ?? 0.1,
            maxZoom: options.maxZoom ?? 10
        };
        // Register update system
        game.addSystem(this.update.bind(this), { phase: 'render' });
    }
    /**
     * Update all cameras.
     */
    update() {
        for (const entity of this.game.query('Camera2D')) {
            this.updateCamera(entity);
        }
    }
    /**
     * Update a single camera entity.
     */
    updateCamera(cameraEntity) {
        const cam = cameraEntity.get(Camera2D);
        // Follow target entity if set
        if (cam.followEntity !== 0) {
            const target = this.game.world.getEntity(cam.followEntity);
            if (target && !target.destroyed) {
                try {
                    const transform = target.get(Transform2D);
                    // Smooth follow
                    cam.x += (transform.x - cam.x) * cam.smoothing;
                    cam.y += (transform.y - cam.y) * cam.smoothing;
                }
                catch {
                    // Target doesn't have Transform2D
                }
            }
        }
        // Smooth zoom transition
        if (cam.zoom !== cam.targetZoom) {
            cam.zoom += (cam.targetZoom - cam.zoom) * cam.smoothing;
            // Clamp zoom
            cam.zoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, cam.zoom));
        }
    }
    /**
     * Set camera to follow an entity.
     */
    follow(cameraEntity, targetEntity) {
        const cam = cameraEntity.get(Camera2D);
        cam.followEntity = targetEntity ? targetEntity.eid : 0;
    }
    /**
     * Center camera on multiple entities (weighted by optional areas).
     */
    centerOn(cameraEntity, entities, weights) {
        if (entities.length === 0)
            return;
        const cam = cameraEntity.get(Camera2D);
        let totalWeight = 0;
        let centerX = 0;
        let centerY = 0;
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            if (entity.destroyed)
                continue;
            try {
                const transform = entity.get(Transform2D);
                const weight = weights?.[i] ?? 1;
                centerX += transform.x * weight;
                centerY += transform.y * weight;
                totalWeight += weight;
            }
            catch {
                // Entity doesn't have Transform2D
            }
        }
        if (totalWeight > 0) {
            cam.x += (centerX / totalWeight - cam.x) * cam.smoothing;
            cam.y += (centerY / totalWeight - cam.y) * cam.smoothing;
        }
    }
    /**
     * Convert world coordinates to screen coordinates.
     */
    worldToScreen(cameraEntity, worldX, worldY) {
        const cam = cameraEntity.get(Camera2D);
        return {
            x: (worldX - cam.x) * cam.zoom + cam.viewportWidth / 2,
            y: (worldY - cam.y) * cam.zoom + cam.viewportHeight / 2
        };
    }
    /**
     * Convert screen coordinates to world coordinates.
     */
    screenToWorld(cameraEntity, screenX, screenY) {
        const cam = cameraEntity.get(Camera2D);
        return {
            x: (screenX - cam.viewportWidth / 2) / cam.zoom + cam.x,
            y: (screenY - cam.viewportHeight / 2) / cam.zoom + cam.y
        };
    }
    /**
     * Set zoom with optional target position.
     */
    setZoom(cameraEntity, zoom, immediate = false) {
        const cam = cameraEntity.get(Camera2D);
        const clampedZoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, zoom));
        cam.targetZoom = clampedZoom;
        if (immediate) {
            cam.zoom = clampedZoom;
        }
    }
    /**
     * Get visible bounds in world coordinates.
     */
    getVisibleBounds(cameraEntity) {
        const cam = cameraEntity.get(Camera2D);
        const halfWidth = (cam.viewportWidth / 2) / cam.zoom;
        const halfHeight = (cam.viewportHeight / 2) / cam.zoom;
        return {
            left: cam.x - halfWidth,
            top: cam.y - halfHeight,
            right: cam.x + halfWidth,
            bottom: cam.y + halfHeight
        };
    }
    /**
     * Check if a world point is visible.
     */
    isPointVisible(cameraEntity, worldX, worldY, margin = 0) {
        const bounds = this.getVisibleBounds(cameraEntity);
        return worldX >= bounds.left - margin &&
            worldX <= bounds.right + margin &&
            worldY >= bounds.top - margin &&
            worldY <= bounds.bottom + margin;
    }
}
