/**
 * Input Capture
 *
 * Captures raw browser input (keyboard, mouse) and normalizes it.
 * This module handles the messy browser event handling so the rest
 * of the input system can work with clean, normalized state.
 */
export interface RawInputState {
    /** Currently pressed keys (normalized to lowercase, except special keys) */
    keysDown: Set<string>;
    /** Mouse button states */
    mouseLeft: boolean;
    mouseRight: boolean;
    mouseMiddle: boolean;
    /** Mouse position (canvas-relative, quantized to integers for determinism) */
    mouseX: number;
    mouseY: number;
    /** Whether mouse has been on the canvas (false until first pointermove) */
    mouseActive: boolean;
}
export declare class InputCapture {
    private canvas;
    private state;
    private boundHandlers;
    constructor();
    /**
     * Bind to a canvas element for mouse coordinate tracking.
     * Also starts listening for keyboard events on window.
     */
    bind(canvas: HTMLCanvasElement): void;
    /**
     * Update mouse position from pointer event.
     * Converts to canvas coordinates and quantizes for determinism.
     */
    private updateMousePosition;
    /**
     * Get current raw input state.
     * Returns an immutable snapshot (keys are copied).
     */
    getState(): Readonly<RawInputState>;
    /**
     * Check if a specific key is currently pressed.
     */
    isKeyDown(key: string): boolean;
    /**
     * Clean up event listeners.
     */
    destroy(): void;
}
