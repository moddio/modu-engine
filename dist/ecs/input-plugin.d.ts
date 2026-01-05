/**
 * InputPlugin - Handles input collection and network sending
 *
 * Provides an action-based input system where:
 * - Game defines actions with default bindings
 * - Players can rebind actions to different keys
 * - Input is automatically sent to server at tick rate
 *
 * @example
 * const input = game.addPlugin(InputPlugin, canvas);
 *
 * input.action('move', { type: 'vector', bindings: ['keys:wasd+arrows'] });
 * input.action('boost', { type: 'button', bindings: ['key:shift'] });
 * input.action('target', { type: 'vector', bindings: ['mouse'] });
 *
 * // Player rebinds
 * input.rebind('boost', ['key:space']);
 *
 * // Save/load
 * localStorage.setItem('keybinds', JSON.stringify(input.getBindings()));
 * input.loadBindings(JSON.parse(localStorage.getItem('keybinds')));
 */
import { Game } from './game';
/** Action types */
export type ActionType = 'button' | 'vector';
/** Binding source - string shorthand or custom callback */
export type BindingSource = string | (() => any);
/** Action definition */
export interface ActionDef {
    type: ActionType;
    bindings: BindingSource[];
}
/** Vector value */
export interface Vec2 {
    x: number;
    y: number;
}
/**
 * InputPlugin - Action-based input system
 */
export declare class InputPlugin {
    private game;
    private canvas;
    /** Action definitions */
    private actions;
    /** Current bindings (may differ from defaults after rebind) */
    private bindings;
    /** Raw input state */
    private mousePos;
    private keysDown;
    private mouseButtons;
    /** Send interval handle */
    private sendInterval;
    /** Last sent input (for deduplication) */
    private lastSentInput;
    constructor(game: Game, canvas: HTMLCanvasElement | string);
    /**
     * Define an action with default bindings.
     */
    action(name: string, def: ActionDef): this;
    /**
     * Rebind an action to new bindings.
     */
    rebind(name: string, bindings: BindingSource[]): this;
    /**
     * Reset action to default bindings.
     */
    resetBinding(name: string): this;
    /**
     * Reset all bindings to defaults.
     */
    resetAllBindings(): this;
    /**
     * Get current bindings for serialization.
     * Only includes string bindings (callbacks can't be serialized).
     */
    getBindings(): Record<string, string[]>;
    /**
     * Load bindings from serialized data.
     */
    loadBindings(data: Record<string, string[]>): this;
    /**
     * Get current value of an action.
     */
    get(name: string): boolean | Vec2 | null;
    /**
     * Get all action values as an object.
     */
    getAll(): Record<string, any>;
    /**
     * Resolve button value from sources (OR logic).
     */
    private resolveButton;
    /**
     * Resolve vector value from sources (additive, clamped).
     */
    private resolveVector;
    /**
     * Resolve a string binding to button value.
     */
    private resolveStringButton;
    /**
     * Resolve a string binding to vector value.
     */
    private resolveStringVector;
    /**
     * Get WASD direction.
     */
    private getWASD;
    /**
     * Get arrow keys direction.
     */
    private getArrows;
    /**
     * Set up event listeners.
     */
    private setupListeners;
    /**
     * Start the send loop.
     */
    private startSendLoop;
    /**
     * Convert input to string for comparison.
     * Uses rounding for vectors to avoid sending tiny mouse movements.
     */
    private inputToString;
    /**
     * Stop the send loop.
     */
    destroy(): void;
}
