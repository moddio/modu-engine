/**
 * Key Normalization Utilities
 *
 * Provides consistent key name handling across input capture and command processing.
 */
/** Map of special keys to their normalized names */
const SPECIAL_KEYS = {
    ' ': 'Space',
    'space': 'Space',
    'ArrowUp': 'ArrowUp',
    'arrowup': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'arrowdown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'arrowleft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'arrowright': 'ArrowRight',
    'Enter': 'Enter',
    'enter': 'Enter',
    'Escape': 'Escape',
    'escape': 'Escape',
    'Tab': 'Tab',
    'tab': 'Tab',
    'Shift': 'Shift',
    'shift': 'Shift',
    'Control': 'Control',
    'control': 'Control',
    'Alt': 'Alt',
    'alt': 'Alt',
    'Meta': 'Meta',
    'meta': 'Meta',
    'Backspace': 'Backspace',
    'backspace': 'Backspace',
    'Delete': 'Delete',
    'delete': 'Delete',
};
/**
 * Normalize key names for consistency.
 * Special keys keep their canonical case, regular keys are lowercase.
 */
export function normalizeKey(key) {
    // Check special keys (case-insensitive)
    const special = SPECIAL_KEYS[key] || SPECIAL_KEYS[key.toLowerCase()];
    if (special)
        return special;
    // Regular keys are lowercase
    return key.toLowerCase();
}
