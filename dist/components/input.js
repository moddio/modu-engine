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
import { registerComponentFactory } from '../entity/entity-manager';
import { InputCapture } from '../input/input-capture';
import { CommandProcessor } from '../input/command-processor';
import { computeDelta } from '../input/prediction-buffer';
// ============================================
// Joining Client Context
// ============================================
/**
 * Context set by engine during onJoin callback.
 * This allows InputComponent to know which client it belongs to without
 * requiring the game to pass clientId manually.
 */
let joiningClientId = null;
/**
 * Set the current joining client context.
 * Called by engine before invoking gameAPI.onJoin().
 */
export function setJoiningClientContext(clientId) {
    joiningClientId = clientId;
}
// ============================================
// Engine Reference (for sending input)
// ============================================
let engineRef = null;
/**
 * Set engine reference for sending inputs.
 * Called by ModuEngine during initialization.
 */
export function setEngineRef(engine) {
    engineRef = engine;
}
export class InputComponent extends BaseComponent {
    constructor(options = {}) {
        super();
        this.type = 'input';
        /** The client ID that controls this entity */
        this._clientId = null;
        /** Canvas for auto-binding */
        this._canvas = null;
        /** Raw input capture (browser events) */
        this.capture = null;
        /** Last sent command states (for delta encoding) */
        this.lastSentStates = null;
        /** Whether this is the local player */
        this._isLocal = false;
        this._canvas = options.canvas ?? null;
        this.processor = new CommandProcessor();
        // Create proxy for dynamic command access (player.input.moveUp)
        this._proxy = new Proxy(this, {
            get: (target, prop) => {
                // First check if it's a real property/method
                if (prop in target) {
                    return target[prop];
                }
                // Then check if it's a command via processor
                const processorValue = target.processor.getCommandValue(prop);
                if (processorValue !== undefined) {
                    return processorValue;
                }
                // Fall back to entity.sync.input for restored players
                // (where setCommands wasn't called because onJoin was skipped)
                const syncInput = target.entity?.sync?.input;
                if (syncInput && prop in syncInput) {
                    return syncInput[prop];
                }
                return undefined;
            }
        });
    }
    /**
     * Get the proxy that allows command access via property names.
     * This is returned when accessing entity.input
     */
    get proxy() {
        return this._proxy;
    }
    /** Get the client ID for this input receiver */
    get clientId() {
        return this._clientId;
    }
    /** Check if this is the local player's input */
    get isLocal() {
        return this._isLocal;
    }
    /**
     * Define commands for this entity.
     * Must be called for ALL players (defines structure + callbacks for deterministic sim).
     * Command definitions are registered by entity type for auto-restore after snapshot.
     */
    setCommands(commands) {
        this.processor.setCommands(commands);
        // Register by entity type for snapshot restore
        if (this.entity?.manager) {
            const type = this.entity.type || 'player';
            this.entity.manager.inputCommands.set(type, commands);
        }
    }
    /**
     * Bind to a canvas for mouse input capture.
     * Only call for local player.
     */
    bind(canvas) {
        if (!this.capture) {
            this.capture = new InputCapture();
        }
        this.capture.bind(canvas);
        this._isLocal = true;
    }
    /**
     * Called when component is attached to entity.
     * Captures clientId from joining context and auto-binds if local player.
     */
    onAttach() {
        // Capture clientId from joining context (set by engine during onJoin)
        if (joiningClientId && !this._clientId) {
            this._clientId = joiningClientId;
        }
        // Check if we're the local player and auto-bind to canvas
        if (engineRef && this._clientId === engineRef.getClientId()) {
            this._isLocal = true;
            this.autoBindCanvas();
        }
        // Sync clientId to entity.sync for snapshot serialization
        if (this.entity && this._clientId) {
            this.entity.sync.clientId = this._clientId;
        }
    }
    /**
     * Auto-bind to canvas if local player.
     * Gets canvas from engine's renderer if not explicitly set.
     */
    autoBindCanvas() {
        if (this._isLocal && !this.capture) {
            // Get canvas from option or from engine's renderer
            const canvas = this._canvas ?? engineRef?.getCanvas();
            if (canvas) {
                this.bind(canvas);
            }
        }
    }
    /**
     * Called when component is detached from entity.
     */
    onDetach() {
        if (this.capture) {
            this.capture.destroy();
            this.capture = null;
        }
    }
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
    onUpdate(frame) {
        if (!this.entity?.manager)
            return;
        // Fall back to entity.sync.clientId if _clientId not set
        // This handles cases where player is created in onTick() instead of onJoin()
        if (!this._clientId && this.entity.sync.clientId) {
            this._clientId = this.entity.sync.clientId;
            // Re-check if we're the local player and auto-bind
            if (engineRef && this._clientId === engineRef.getClientId()) {
                this._isLocal = true;
                this.autoBindCanvas();
            }
        }
        if (!this._clientId)
            return;
        // === STEP 1: ALL players apply confirmed inputs from server ===
        const registry = this.entity.manager.inputRegistry;
        const input = registry.get(this._clientId);
        if (input !== undefined) {
            // Handle new command-based input format
            if (input.states) {
                this.processor.setCommandStates(input.states, this.entity);
                this.entity.sync.input = input.states;
            }
            else {
                // Legacy format: raw input object
                this.entity.sync.input = input;
            }
        }
        // === STEP 2: Local player captures NEW input and sends to server ===
        // This happens AFTER applying confirmed input, so it doesn't corrupt state
        // IMPORTANT: Only send ACTUAL raw input from browser events, not echoed server values
        if (this._isLocal && this.capture && this.processor.hasCommands()) {
            // Capture raw input
            const rawInput = this.capture.getState();
            // Build command states ONLY from raw browser input
            // Don't include processor state (that would echo server inputs back)
            const commandStates = {};
            // Process each command definition and check raw input
            for (const [name, def] of this.getCommandDefinitions()) {
                // Keys - check which commands should be active based on rawInput.keysDown
                if (def.keys) {
                    let active = false;
                    for (const key of def.keys) {
                        if (rawInput.keysDown.has(key.toLowerCase())) {
                            active = true;
                            break;
                        }
                    }
                    commandStates[name] = active;
                }
                // Mouse buttons and position
                if (def.mouse) {
                    for (const btn of def.mouse) {
                        if (btn === 'left') {
                            commandStates[name] = rawInput.mouseLeft;
                        }
                        else if (btn === 'right') {
                            commandStates[name] = rawInput.mouseRight;
                        }
                        else if (btn === 'middle') {
                            commandStates[name] = rawInput.mouseMiddle;
                        }
                        else if (btn === 'position' && rawInput.mouseActive) {
                            // Only include position if mouse is active on canvas
                            commandStates[name] = { x: rawInput.mouseX, y: rawInput.mouseY };
                        }
                    }
                }
            }
            // Compute delta and send if changed
            // Only send if commandStates has actual values (not empty)
            const hasValues = Object.keys(commandStates).length > 0;
            const delta = computeDelta(this.lastSentStates, commandStates);
            if (delta && hasValues && engineRef) {
                engineRef.sendInput({
                    frame,
                    states: commandStates
                });
                this.lastSentStates = { ...commandStates };
            }
        }
    }
    /**
     * Get command definitions (for building states from raw input).
     */
    getCommandDefinitions() {
        return this.processor.definitions;
    }
    /**
     * Get current command states.
     */
    getCommandStates() {
        return this.processor.getCommandStates();
    }
    /**
     * Apply command states (for remote players or rollback).
     */
    applyCommandStates(states) {
        this.processor.setCommandStates(states, this.entity);
        if (this.entity) {
            this.entity.sync.input = states;
        }
    }
    /**
     * Sync state from entity.sync (after snapshot restore).
     * Note: Command definitions are restored via EntityManager.loadState from registry.
     */
    syncFromEntity() {
        if (!this.entity)
            return;
        const sync = this.entity.sync;
        if (sync.clientId !== undefined) {
            this._clientId = sync.clientId;
        }
        if (sync.input !== undefined) {
            // Load command states if in new format
            if (typeof sync.input === 'object') {
                this.processor.loadState({ commands: sync.input });
            }
        }
        // Re-check if we're local and auto-bind
        if (engineRef && this._clientId === engineRef.getClientId()) {
            this._isLocal = true;
            this.autoBindCanvas();
        }
    }
    /**
     * Save state for snapshot.
     */
    saveState() {
        return {
            clientId: this._clientId,
            input: this.processor.getCommandStates()
        };
    }
    /**
     * Load state from snapshot.
     */
    loadState(state) {
        if (state?.clientId !== undefined) {
            this._clientId = state.clientId;
        }
        if (state?.input !== undefined) {
            this.processor.loadState({ commands: state.input });
        }
    }
    // ============================================
    // Legacy API (backwards compatibility)
    // ============================================
    /**
     * Get current input state (legacy API).
     * @deprecated Use command states instead
     */
    get input() {
        return this.entity?.sync?.input ?? null;
    }
}
// Register factory for snapshot deserialization
registerComponentFactory('input', (state) => {
    const comp = new InputComponent();
    if (state) {
        comp.loadState(state);
    }
    return comp;
});
