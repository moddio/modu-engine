/**
 * Command Processor
 *
 * Maps raw input state to game commands.
 * Handles edge detection (keyDown/keyUp) and calls callbacks.
 * All processing is deterministic - same input → same output.
 */
import { normalizeKey } from './keys';
// ============================================
// Command Processor
// ============================================
export class CommandProcessor {
    constructor() {
        /** Command definitions */
        this.definitions = new Map();
        /** Current state per command */
        this.states = new Map();
        /** Lookup: key → command names (one key can trigger multiple commands) */
        this.keyToCommands = new Map();
        /** Lookup: mouse button → command names */
        this.mouseToCommands = new Map();
        /** Commands that track mouse position */
        this.positionCommands = [];
    }
    /**
     * Register command definitions.
     * Replaces any existing commands.
     */
    setCommands(commands) {
        // Clear existing
        this.definitions.clear();
        this.states.clear();
        this.keyToCommands.clear();
        this.mouseToCommands.clear();
        this.positionCommands = [];
        // Build definitions and lookup tables
        for (const [name, def] of Object.entries(commands)) {
            this.definitions.set(name, def);
            // Initialize state (position commands start as null until mouse is active)
            const isPositionCommand = def.mouse?.includes('position') ?? false;
            const initialValue = isPositionCommand ? null : false;
            this.states.set(name, {
                value: initialValue,
                prevValue: initialValue
            });
            // Build key lookup
            if (def.keys) {
                for (const key of def.keys) {
                    const normalized = normalizeKey(key);
                    if (!this.keyToCommands.has(normalized)) {
                        this.keyToCommands.set(normalized, []);
                    }
                    this.keyToCommands.get(normalized).push(name);
                }
            }
            // Build mouse lookup
            if (def.mouse) {
                for (const button of def.mouse) {
                    if (button === 'position') {
                        this.positionCommands.push(name);
                    }
                    else {
                        if (!this.mouseToCommands.has(button)) {
                            this.mouseToCommands.set(button, []);
                        }
                        this.mouseToCommands.get(button).push(name);
                    }
                }
            }
        }
    }
    /**
     * Process raw input and update command states.
     * Detects edges and calls callbacks.
     *
     * @param rawInput - Current raw input state
     * @param entity - Entity to pass to callbacks (null for non-local players)
     * @returns Whether any command state changed (for network delta encoding)
     */
    processFrame(rawInput, entity) {
        let anyChanged = false;
        // First, save previous values and reset current values
        for (const [name, state] of this.states) {
            state.prevValue = state.value;
            // Reset buttons to false (will be set to true if pressed)
            // Keep position as-is (will be updated if position command)
            if (typeof state.value === 'boolean') {
                state.value = false;
            }
        }
        // Process keyboard inputs
        for (const key of rawInput.keysDown) {
            const commands = this.keyToCommands.get(key);
            if (commands) {
                for (const name of commands) {
                    const state = this.states.get(name);
                    state.value = true;
                }
            }
        }
        // Process mouse button inputs
        if (rawInput.mouseLeft) {
            const commands = this.mouseToCommands.get('left');
            if (commands) {
                for (const name of commands) {
                    const state = this.states.get(name);
                    state.value = true;
                }
            }
        }
        if (rawInput.mouseRight) {
            const commands = this.mouseToCommands.get('right');
            if (commands) {
                for (const name of commands) {
                    const state = this.states.get(name);
                    state.value = true;
                }
            }
        }
        if (rawInput.mouseMiddle) {
            const commands = this.mouseToCommands.get('middle');
            if (commands) {
                for (const name of commands) {
                    const state = this.states.get(name);
                    state.value = true;
                }
            }
        }
        // Process mouse position (only when mouse is active on canvas)
        for (const name of this.positionCommands) {
            const state = this.states.get(name);
            const prev = state.value;
            // Only update position when mouse has been on the canvas
            if (rawInput.mouseActive) {
                const curr = { x: rawInput.mouseX, y: rawInput.mouseY };
                if (!prev || prev.x !== curr.x || prev.y !== curr.y) {
                    anyChanged = true;
                }
                state.value = curr;
            }
            else if (prev !== null) {
                // Mouse not active yet, keep null
                state.value = null;
                anyChanged = true;
            }
        }
        // Detect edges and call callbacks
        for (const [name, state] of this.states) {
            const def = this.definitions.get(name);
            const prev = state.prevValue;
            const curr = state.value;
            // Skip position commands for edge detection (they don't have keyDown/keyUp)
            if (curr === null || (typeof curr === 'object' && 'x' in curr)) {
                continue;
            }
            // Check for state change
            if (prev !== curr) {
                anyChanged = true;
            }
            // Call callbacks if entity provided
            if (entity) {
                // keyDown: false → true
                if (!prev && curr && def.keyDown) {
                    def.keyDown(entity);
                }
                // keyUp: true → false
                if (prev && !curr && def.keyUp) {
                    def.keyUp(entity);
                }
                // always: while held
                if (curr && def.always) {
                    def.always(entity);
                }
            }
        }
        return anyChanged;
    }
    /**
     * Get current command states for network sync.
     * Returns a plain object that can be JSON serialized.
     */
    getCommandStates() {
        const result = {};
        for (const [name, state] of this.states) {
            // Copy position objects to prevent mutation
            if (typeof state.value === 'object') {
                result[name] = { x: state.value.x, y: state.value.y };
            }
            else {
                result[name] = state.value;
            }
        }
        return result;
    }
    /**
     * Set command states from network.
     * Used for remote players and rollback.
     *
     * @param states - Command states to apply
     * @param entity - Entity to pass to callbacks (for edge detection)
     */
    setCommandStates(states, entity) {
        for (const [name, value] of Object.entries(states)) {
            let state = this.states.get(name);
            // Auto-create state if it doesn't exist (for network-received commands)
            if (!state) {
                state = { value: null, prevValue: null };
                this.states.set(name, state);
            }
            // Save previous for edge detection
            state.prevValue = state.value;
            // Set new value
            if (typeof value === 'object') {
                state.value = { x: value.x, y: value.y };
            }
            else {
                state.value = value;
            }
            // Call callbacks for edge detection
            if (entity && typeof value === 'boolean') {
                const def = this.definitions.get(name);
                const prev = state.prevValue;
                const curr = value;
                if (!prev && curr && def.keyDown) {
                    def.keyDown(entity);
                }
                if (prev && !curr && def.keyUp) {
                    def.keyUp(entity);
                }
                if (curr && def.always) {
                    def.always(entity);
                }
            }
        }
    }
    /**
     * Get the value of a specific command.
     */
    getCommandValue(name) {
        const state = this.states.get(name);
        if (!state)
            return undefined;
        // Copy position objects (typeof null === 'object', so check for null)
        if (state.value !== null && typeof state.value === 'object') {
            return { x: state.value.x, y: state.value.y };
        }
        return state.value ?? undefined;
    }
    /**
     * Get all command names.
     */
    getCommandNames() {
        return [...this.definitions.keys()];
    }
    /**
     * Check if commands are defined.
     */
    hasCommands() {
        return this.definitions.size > 0;
    }
    /**
     * Reset all command states to defaults.
     */
    reset() {
        for (const [name, state] of this.states) {
            const def = this.definitions.get(name);
            const isPosition = def?.mouse?.includes('position') ?? false;
            const defaultValue = isPosition ? { x: 0, y: 0 } : false;
            state.value = defaultValue;
            state.prevValue = defaultValue;
        }
    }
    /**
     * Save state for snapshot.
     */
    saveState() {
        return {
            commands: this.getCommandStates()
        };
    }
    /**
     * Load state from snapshot.
     */
    loadState(state) {
        if (state?.commands) {
            for (const [name, value] of Object.entries(state.commands)) {
                const cmdState = this.states.get(name);
                if (cmdState) {
                    cmdState.value = value;
                    cmdState.prevValue = value;
                }
            }
        }
    }
}
