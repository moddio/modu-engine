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
/**
 * InputPlugin - Action-based input system
 */
export class InputPlugin {
    constructor(game, canvas) {
        /** Action definitions */
        this.actions = new Map();
        /** Current bindings (may differ from defaults after rebind) */
        this.bindings = new Map();
        /** Raw input state */
        this.mousePos = { x: 0, y: 0 };
        this.keysDown = new Set();
        this.mouseButtons = new Set();
        /** Send interval handle */
        this.sendInterval = null;
        /** Last sent input (for deduplication) */
        this.lastSentInput = '';
        this.game = game;
        // Resolve canvas
        if (typeof canvas === 'string') {
            const el = document.querySelector(canvas);
            if (!el)
                throw new Error(`Canvas not found: ${canvas}`);
            this.canvas = el;
        }
        else {
            this.canvas = canvas;
        }
        this.setupListeners();
        this.startSendLoop();
    }
    /**
     * Define an action with default bindings.
     */
    action(name, def) {
        this.actions.set(name, def);
        // Set default bindings if not already rebound
        if (!this.bindings.has(name)) {
            this.bindings.set(name, [...def.bindings]);
        }
        return this;
    }
    /**
     * Rebind an action to new bindings.
     */
    rebind(name, bindings) {
        if (!this.actions.has(name)) {
            console.warn(`[InputPlugin] Unknown action: ${name}`);
            return this;
        }
        this.bindings.set(name, bindings);
        return this;
    }
    /**
     * Reset action to default bindings.
     */
    resetBinding(name) {
        const action = this.actions.get(name);
        if (action) {
            this.bindings.set(name, [...action.bindings]);
        }
        return this;
    }
    /**
     * Reset all bindings to defaults.
     */
    resetAllBindings() {
        for (const [name, action] of this.actions) {
            this.bindings.set(name, [...action.bindings]);
        }
        return this;
    }
    /**
     * Get current bindings for serialization.
     * Only includes string bindings (callbacks can't be serialized).
     */
    getBindings() {
        const result = {};
        for (const [name, sources] of this.bindings) {
            result[name] = sources.filter(s => typeof s === 'string');
        }
        return result;
    }
    /**
     * Load bindings from serialized data.
     */
    loadBindings(data) {
        for (const [name, sources] of Object.entries(data)) {
            if (this.actions.has(name)) {
                this.bindings.set(name, sources);
            }
        }
        return this;
    }
    /**
     * Get current value of an action.
     */
    get(name) {
        const action = this.actions.get(name);
        const sources = this.bindings.get(name);
        if (!action || !sources)
            return null;
        if (action.type === 'button') {
            return this.resolveButton(sources);
        }
        else {
            return this.resolveVector(sources);
        }
    }
    /**
     * Get all action values as an object.
     */
    getAll() {
        const result = {};
        for (const name of this.actions.keys()) {
            result[name] = this.get(name);
        }
        return result;
    }
    /**
     * Resolve button value from sources (OR logic).
     */
    resolveButton(sources) {
        for (const source of sources) {
            if (typeof source === 'function') {
                if (source())
                    return true;
            }
            else if (this.resolveStringButton(source)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Resolve vector value from sources (additive, clamped).
     */
    resolveVector(sources) {
        let x = 0, y = 0;
        for (const source of sources) {
            let vec = null;
            if (typeof source === 'function') {
                vec = source();
            }
            else {
                vec = this.resolveStringVector(source);
            }
            if (vec) {
                x += vec.x;
                y += vec.y;
            }
        }
        // Clamp to -1..1 for direction vectors, but not for mouse position
        // We detect mouse by checking if values are large
        if (Math.abs(x) <= 1 && Math.abs(y) <= 1) {
            const len = Math.sqrt(x * x + y * y);
            if (len > 1) {
                x /= len;
                y /= len;
            }
        }
        return { x, y };
    }
    /**
     * Resolve a string binding to button value.
     */
    resolveStringButton(source) {
        // key:X - single key
        if (source.startsWith('key:')) {
            const key = source.slice(4).toLowerCase();
            return this.keysDown.has(key);
        }
        // mouse:left, mouse:right, mouse:middle
        if (source.startsWith('mouse:')) {
            const button = source.slice(6);
            if (button === 'left')
                return this.mouseButtons.has(0);
            if (button === 'right')
                return this.mouseButtons.has(2);
            if (button === 'middle')
                return this.mouseButtons.has(1);
        }
        return false;
    }
    /**
     * Resolve a string binding to vector value.
     */
    resolveStringVector(source) {
        // mouse - current position
        if (source === 'mouse') {
            return { ...this.mousePos };
        }
        // keys:wasd
        if (source === 'keys:wasd') {
            return this.getWASD();
        }
        // keys:arrows
        if (source === 'keys:arrows') {
            return this.getArrows();
        }
        // keys:wasd+arrows
        if (source === 'keys:wasd+arrows') {
            const wasd = this.getWASD();
            const arrows = this.getArrows();
            return {
                x: Math.max(-1, Math.min(1, wasd.x + arrows.x)),
                y: Math.max(-1, Math.min(1, wasd.y + arrows.y))
            };
        }
        return null;
    }
    /**
     * Get WASD direction.
     */
    getWASD() {
        let x = 0, y = 0;
        if (this.keysDown.has('a'))
            x -= 1;
        if (this.keysDown.has('d'))
            x += 1;
        if (this.keysDown.has('w'))
            y -= 1;
        if (this.keysDown.has('s'))
            y += 1;
        return { x, y };
    }
    /**
     * Get arrow keys direction.
     */
    getArrows() {
        let x = 0, y = 0;
        if (this.keysDown.has('arrowleft'))
            x -= 1;
        if (this.keysDown.has('arrowright'))
            x += 1;
        if (this.keysDown.has('arrowup'))
            y -= 1;
        if (this.keysDown.has('arrowdown'))
            y += 1;
        return { x, y };
    }
    /**
     * Set up event listeners.
     */
    setupListeners() {
        // Mouse move
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mousePos.x = e.clientX - rect.left;
            this.mousePos.y = e.clientY - rect.top;
        });
        // Mouse buttons
        this.canvas.addEventListener('mousedown', (e) => {
            this.mouseButtons.add(e.button);
        });
        this.canvas.addEventListener('mouseup', (e) => {
            this.mouseButtons.delete(e.button);
        });
        // Keyboard - use window to catch all keys
        window.addEventListener('keydown', (e) => {
            this.keysDown.add(e.key.toLowerCase());
        });
        window.addEventListener('keyup', (e) => {
            this.keysDown.delete(e.key.toLowerCase());
        });
        // Clear keys on blur (prevent stuck keys)
        window.addEventListener('blur', () => {
            this.keysDown.clear();
            this.mouseButtons.clear();
        });
    }
    /**
     * Start the send loop.
     */
    startSendLoop() {
        // Send at server tick rate (default 50ms = 20fps)
        const sendRate = 1000 / (this.game.getServerFps?.() || 20);
        this.sendInterval = window.setInterval(() => {
            if (this.game.isConnected() && this.game.localClientId && this.actions.size > 0) {
                const input = this.getAll();
                // Only send if input changed (deduplication to save bandwidth)
                const inputStr = this.inputToString(input);
                if (inputStr !== this.lastSentInput) {
                    this.lastSentInput = inputStr;
                    this.game.sendInput(input);
                }
            }
        }, sendRate);
    }
    /**
     * Convert input to string for comparison.
     * Uses rounding for vectors to avoid sending tiny mouse movements.
     */
    inputToString(input) {
        const normalized = {};
        for (const [key, value] of Object.entries(input)) {
            if (value && typeof value === 'object' && 'x' in value && 'y' in value) {
                // Round vectors to avoid sending tiny movements
                normalized[key] = { x: Math.round(value.x / 10) * 10, y: Math.round(value.y / 10) * 10 };
            }
            else {
                normalized[key] = value;
            }
        }
        return JSON.stringify(normalized);
    }
    /**
     * Stop the send loop.
     */
    destroy() {
        if (this.sendInterval !== null) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }
    }
}
