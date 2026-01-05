/**
 * Binary Codec
 *
 * Compact binary encoding for arbitrary JSON-like data.
 * Used for inputs, snapshots, and all engine-network communication.
 */
/**
 * Encode any JSON-compatible value to binary.
 */
export declare function encode(value: any): Uint8Array;
/**
 * Decode binary data to a value.
 */
export declare function decode(data: Uint8Array): any;
