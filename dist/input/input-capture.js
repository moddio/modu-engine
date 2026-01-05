/**
 * Input Capture
 *
 * Captures raw browser input (keyboard, mouse) and normalizes it.
 * This module handles the messy browser event handling so the rest
 * of the input system can work with clean, normalized state.
 */
import { normalizeKey } from './keys';
// ============================================
// Input Capture Class
// ============================================
export class InputCapture {
    constructor() {
        this.canvas = null;
        this.boundHandlers = {};
        this.state = {
            keysDown: new Set(),
            mouseLeft: false,
            mouseRight: false,
            mouseMiddle: false,
            mouseX: 0,
            mouseY: 0,
            mouseActive: false
        };
    }
    /**
     * Bind to a canvas element for mouse coordinate tracking.
     * Also starts listening for keyboard events on window.
     */
    bind(canvas) {
        if (this.canvas) {
            this.destroy();
        }
        this.canvas = canvas;
        // Keyboard events on window (works even when canvas not focused)
        this.boundHandlers.keydown = (e) => {
            // Don't capture if user is typing in an input field
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            const key = normalizeKey(e.key);
            this.state.keysDown.add(key);
        };
        this.boundHandlers.keyup = (e) => {
            const key = normalizeKey(e.key);
            this.state.keysDown.delete(key);
        };
        // Mouse events on canvas
        this.boundHandlers.pointerdown = (e) => {
            if (e.button === 0)
                this.state.mouseLeft = true;
            if (e.button === 1)
                this.state.mouseMiddle = true;
            if (e.button === 2)
                this.state.mouseRight = true;
            this.updateMousePosition(e);
        };
        this.boundHandlers.pointerup = (e) => {
            if (e.button === 0)
                this.state.mouseLeft = false;
            if (e.button === 1)
                this.state.mouseMiddle = false;
            if (e.button === 2)
                this.state.mouseRight = false;
        };
        this.boundHandlers.pointermove = (e) => {
            this.state.mouseActive = true;
            this.updateMousePosition(e);
        };
        // Prevent context menu on right-click
        this.boundHandlers.contextmenu = (e) => {
            e.preventDefault();
        };
        // Clear all keys on blur (window loses focus)
        this.boundHandlers.blur = () => {
            this.state.keysDown.clear();
            this.state.mouseLeft = false;
            this.state.mouseRight = false;
            this.state.mouseMiddle = false;
        };
        // Attach listeners
        window.addEventListener('keydown', this.boundHandlers.keydown);
        window.addEventListener('keyup', this.boundHandlers.keyup);
        window.addEventListener('blur', this.boundHandlers.blur);
        canvas.addEventListener('pointerdown', this.boundHandlers.pointerdown);
        canvas.addEventListener('pointerup', this.boundHandlers.pointerup);
        canvas.addEventListener('pointermove', this.boundHandlers.pointermove);
        canvas.addEventListener('contextmenu', this.boundHandlers.contextmenu);
        // Capture pointer to track mouse even when leaving canvas
        canvas.addEventListener('pointerdown', () => {
            canvas.setPointerCapture(1);
        });
        canvas.addEventListener('pointerup', () => {
            canvas.releasePointerCapture(1);
        });
    }
    /**
     * Update mouse position from pointer event.
     * Converts to canvas coordinates and quantizes for determinism.
     */
    updateMousePosition(e) {
        if (!this.canvas)
            return;
        const rect = this.canvas.getBoundingClientRect();
        // Handle DPI scaling
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        // Convert to canvas coordinates
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        // Quantize to integers for determinism
        this.state.mouseX = Math.round(x);
        this.state.mouseY = Math.round(y);
    }
    /**
     * Get current raw input state.
     * Returns an immutable snapshot (keys are copied).
     */
    getState() {
        return {
            keysDown: new Set(this.state.keysDown),
            mouseLeft: this.state.mouseLeft,
            mouseRight: this.state.mouseRight,
            mouseMiddle: this.state.mouseMiddle,
            mouseX: this.state.mouseX,
            mouseY: this.state.mouseY,
            mouseActive: this.state.mouseActive
        };
    }
    /**
     * Check if a specific key is currently pressed.
     */
    isKeyDown(key) {
        return this.state.keysDown.has(normalizeKey(key));
    }
    /**
     * Clean up event listeners.
     */
    destroy() {
        if (this.boundHandlers.keydown) {
            window.removeEventListener('keydown', this.boundHandlers.keydown);
        }
        if (this.boundHandlers.keyup) {
            window.removeEventListener('keyup', this.boundHandlers.keyup);
        }
        if (this.boundHandlers.blur) {
            window.removeEventListener('blur', this.boundHandlers.blur);
        }
        if (this.canvas) {
            if (this.boundHandlers.pointerdown) {
                this.canvas.removeEventListener('pointerdown', this.boundHandlers.pointerdown);
            }
            if (this.boundHandlers.pointerup) {
                this.canvas.removeEventListener('pointerup', this.boundHandlers.pointerup);
            }
            if (this.boundHandlers.pointermove) {
                this.canvas.removeEventListener('pointermove', this.boundHandlers.pointermove);
            }
            if (this.boundHandlers.contextmenu) {
                this.canvas.removeEventListener('contextmenu', this.boundHandlers.contextmenu);
            }
        }
        this.boundHandlers = {};
        this.canvas = null;
        this.state.keysDown.clear();
    }
}
