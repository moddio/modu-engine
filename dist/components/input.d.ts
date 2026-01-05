/**
 * Input Component
 *
 * Unified input handling for multiplayer games with:
 * - Command-based input mapping (keys/mouse → commands)
 * - Client-side prediction (apply locally, send to server)
 * - Automatic rollback when prediction differs from server
 * - Delta encoding for bandwidth efficiency
 *
 * Usage:
 *   // Define commands for ALL players (deterministic simulation):
 *   function createPlayer() {
 *       const player = em.create('player');
 *       player.addComponent(new InputComponent());
 *
 *       player.input.setCommands({
 *           moveUp: {
 *               keys: ['w', 'ArrowUp'],
 *               always(entity) { entity.moveBy(0, -SPEED); }
 *           },
 *           fire: {
 *               keys: ['Space'],
 *               mouse: ['left'],
 *               keyDown(entity) { spawnProjectile(entity); }
 *           },
 *           aim: { mouse: ['position'] }
 *       });
 *       return player;
 *   }
 *
 *   // Bind to canvas ONLY for local player:
 *   if (clientId === game.getClientId()) {
 *       player.input.bind(canvas);
 *   }
 *
 *   // Access command states (works for ALL players):
 *   player.input.moveUp   // boolean
 *   player.input.fire     // boolean
 *   player.input.aim      // { x, y }
 */
import { BaseComponent } from '../entity/component';
import { CommandDefinition } from '../input/command-processor';
/**
 * Set the current joining client context.
 * Called by engine before invoking gameAPI.onJoin().
 */
export declare function setJoiningClientContext(clientId: string | null): void;
/**
 * Set engine reference for sending inputs.
 * Called by ModuEngine during initialization.
 */
export declare function setEngineRef(engine: any): void;
export interface InputComponentOptions {
    /** Canvas for input capture (auto-binds when local player) */
    canvas?: HTMLCanvasElement;
}
export declare class InputComponent extends BaseComponent {
    readonly type = "input";
    /** The client ID that controls this entity */
    private _clientId;
    /** Canvas for auto-binding */
    private _canvas;
    /** Raw input capture (browser events) */
    private capture;
    /** Command processor (maps raw → commands) */
    private processor;
    /** Last sent command states (for delta encoding) */
    private lastSentStates;
    /** Whether this is the local player */
    private _isLocal;
    /** Dynamic property proxy for command access */
    private _proxy;
    constructor(options?: InputComponentOptions);
    /**
     * Get the proxy that allows command access via property names.
     * This is returned when accessing entity.input
     */
    get proxy(): InputComponent & Record<string, any>;
    /** Get the client ID for this input receiver */
    get clientId(): string | null;
    /** Check if this is the local player's input */
    get isLocal(): boolean;
    /**
     * Define commands for this entity.
     * Must be called for ALL players (defines structure + callbacks for deterministic sim).
     * Command definitions are registered by entity type for auto-restore after snapshot.
     */
    setCommands(commands: Record<string, CommandDefinition>): void;
    /**
     * Bind to a canvas for mouse input capture.
     * Only call for local player.
     */
    bind(canvas: HTMLCanvasElement): void;
    /**
     * Called when component is attached to entity.
     * Captures clientId from joining context and auto-binds if local player.
     */
    onAttach(): void;
    /**
     * Auto-bind to canvas if local player.
     * Gets canvas from engine's renderer if not explicitly set.
     */
    private autoBindCanvas;
    /**
     * Called when component is detached from entity.
     */
    onDetach(): void;
    /**
     * Called each frame by EntityManager.update().
     *
     * For determinism, we DO NOT apply inputs locally (no client-side prediction).
     * Instead:
     * - All players: apply from server-echoed registry FIRST
     * - Local player: then capture new input and send to server
     *
     * This ensures all clients process inputs at the same frame.
     */
    onUpdate(frame: number): void;
    /**
     * Get command definitions (for building states from raw input).
     */
    private getCommandDefinitions;
    /**
     * Get current command states.
     */
    getCommandStates(): Record<string, boolean | {
        x: number;
        y: number;
    }>;
    /**
     * Apply command states (for remote players or rollback).
     */
    applyCommandStates(states: Record<string, boolean | {
        x: number;
        y: number;
    }>): void;
    /**
     * Sync state from entity.sync (after snapshot restore).
     * Note: Command definitions are restored via EntityManager.loadState from registry.
     */
    syncFromEntity(): void;
    /**
     * Save state for snapshot.
     */
    saveState(): any;
    /**
     * Load state from snapshot.
     */
    loadState(state: any): void;
    /**
     * Get current input state (legacy API).
     * @deprecated Use command states instead
     */
    get input(): any;
}
