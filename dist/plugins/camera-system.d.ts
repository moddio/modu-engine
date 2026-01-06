/**
 * CameraSystem - 2D camera management for ECS
 *
 * Updates Camera2D component based on follow target.
 * Handles zoom smoothing and position interpolation.
 *
 * This system is client-only - Camera2D component has sync: false.
 */
import { Game } from '../game';
import { Entity } from '../core/entity';
export interface CameraSystemOptions {
    /** Default zoom level (default: 1) */
    defaultZoom?: number;
    /** Default smoothing (default: 0.1) */
    defaultSmoothing?: number;
    /** Minimum zoom level (default: 0.1) */
    minZoom?: number;
    /** Maximum zoom level (default: 10) */
    maxZoom?: number;
}
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
export declare class CameraSystem {
    private game;
    private options;
    constructor(game: Game, options?: CameraSystemOptions);
    /**
     * Update all cameras.
     */
    private update;
    /**
     * Update a single camera entity.
     */
    private updateCamera;
    /**
     * Set camera to follow an entity.
     */
    follow(cameraEntity: Entity, targetEntity: Entity | null): void;
    /**
     * Center camera on multiple entities (weighted by optional areas).
     */
    centerOn(cameraEntity: Entity, entities: Entity[], weights?: number[]): void;
    /**
     * Convert world coordinates to screen coordinates.
     */
    worldToScreen(cameraEntity: Entity, worldX: number, worldY: number): {
        x: number;
        y: number;
    };
    /**
     * Convert screen coordinates to world coordinates.
     */
    screenToWorld(cameraEntity: Entity, screenX: number, screenY: number): {
        x: number;
        y: number;
    };
    /**
     * Set zoom with optional target position.
     */
    setZoom(cameraEntity: Entity, zoom: number, immediate?: boolean): void;
    /**
     * Get visible bounds in world coordinates.
     */
    getVisibleBounds(cameraEntity: Entity): {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
    /**
     * Check if a world point is visible.
     */
    isPointVisible(cameraEntity: Entity, worldX: number, worldY: number, margin?: number): boolean;
}
