/**
 * Command Processor
 *
 * Maps raw input state to game commands.
 * Handles edge detection (keyDown/keyUp) and calls callbacks.
 * All processing is deterministic - same input → same output.
 */
import type { Entity } from '../ecs/entity';
import type { RawInputState } from './input-capture';
export interface CommandDefinition {
    /** Keyboard keys that trigger this command (e.g., ['w', 'ArrowUp']) */
    keys?: string[];
    /** Mouse buttons/position that trigger this command */
    mouse?: ('left' | 'right' | 'middle' | 'position')[];
    /** Called on the frame the key/button is pressed */
    keyDown?(entity: Entity): void;
    /** Called on the frame the key/button is released */
    keyUp?(entity: Entity): void;
    /** Called every frame while key/button is held */
    always?(entity: Entity): void;
}
export interface CommandState {
    /** Current value (boolean for buttons, Vec2 for position, null for inactive position) */
    value: boolean | {
        x: number;
        y: number;
    } | null;
    /** Previous frame's value (for edge detection) */
    prevValue: boolean | {
        x: number;
        y: number;
    } | null;
}
export declare class CommandProcessor {
    /** Command definitions */
    private definitions;
    /** Current state per command */
    private states;
    /** Lookup: key → command names (one key can trigger multiple commands) */
    private keyToCommands;
    /** Lookup: mouse button → command names */
    private mouseToCommands;
    /** Commands that track mouse position */
    private positionCommands;
    constructor();
    /**
     * Register command definitions.
     * Replaces any existing commands.
     */
    setCommands(commands: Record<string, CommandDefinition>): void;
    /**
     * Process raw input and update command states.
     * Detects edges and calls callbacks.
     *
     * @param rawInput - Current raw input state
     * @param entity - Entity to pass to callbacks (null for non-local players)
     * @returns Whether any command state changed (for network delta encoding)
     */
    processFrame(rawInput: RawInputState, entity: Entity | null): boolean;
    /**
     * Get current command states for network sync.
     * Returns a plain object that can be JSON serialized.
     */
    getCommandStates(): Record<string, boolean | {
        x: number;
        y: number;
    }>;
    /**
     * Set command states from network.
     * Used for remote players and rollback.
     *
     * @param states - Command states to apply
     * @param entity - Entity to pass to callbacks (for edge detection)
     */
    setCommandStates(states: Record<string, boolean | {
        x: number;
        y: number;
    }>, entity: Entity | null): void;
    /**
     * Get the value of a specific command.
     */
    getCommandValue(name: string): boolean | {
        x: number;
        y: number;
    } | undefined;
    /**
     * Get all command names.
     */
    getCommandNames(): string[];
    /**
     * Check if commands are defined.
     */
    hasCommands(): boolean;
    /**
     * Reset all command states to defaults.
     */
    reset(): void;
    /**
     * Save state for snapshot.
     */
    saveState(): any;
    /**
     * Load state from snapshot.
     */
    loadState(state: any): void;
}
