/**
 * Binary Codec
 *
 * Compact binary encoding for arbitrary JSON-like data.
 * Used for inputs, snapshots, and all engine-network communication.
 */
// Type markers
const TYPE_NULL = 0x00;
const TYPE_FALSE = 0x01;
const TYPE_TRUE = 0x02;
const TYPE_INT8 = 0x03;
const TYPE_INT16 = 0x04;
const TYPE_INT32 = 0x05;
const TYPE_FLOAT64 = 0x06;
const TYPE_STRING = 0x07;
const TYPE_ARRAY = 0x08;
const TYPE_OBJECT = 0x09;
const TYPE_UINT8 = 0x0A;
const TYPE_UINT16 = 0x0B;
const TYPE_UINT32 = 0x0C;
/**
 * Binary encoder - accumulates bytes
 */
class BinaryEncoder {
    constructor() {
        this.buffer = [];
    }
    writeByte(b) {
        this.buffer.push(b & 0xFF);
    }
    writeUint16(n) {
        this.buffer.push((n >> 8) & 0xFF);
        this.buffer.push(n & 0xFF);
    }
    writeUint32(n) {
        this.buffer.push((n >> 24) & 0xFF);
        this.buffer.push((n >> 16) & 0xFF);
        this.buffer.push((n >> 8) & 0xFF);
        this.buffer.push(n & 0xFF);
    }
    writeInt32(n) {
        this.writeUint32(n >>> 0);
    }
    writeFloat64(n) {
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, n, false); // big-endian
        for (let i = 0; i < 8; i++) {
            this.buffer.push(view.getUint8(i));
        }
    }
    writeString(s) {
        const encoded = new TextEncoder().encode(s);
        this.writeUint16(encoded.length);
        for (let i = 0; i < encoded.length; i++) {
            this.buffer.push(encoded[i]);
        }
    }
    writeValue(value) {
        if (value === null || value === undefined) {
            this.writeByte(TYPE_NULL);
        }
        else if (value === false) {
            this.writeByte(TYPE_FALSE);
        }
        else if (value === true) {
            this.writeByte(TYPE_TRUE);
        }
        else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                if (value >= 0 && value <= 255) {
                    this.writeByte(TYPE_UINT8);
                    this.writeByte(value);
                }
                else if (value >= 0 && value <= 65535) {
                    this.writeByte(TYPE_UINT16);
                    this.writeUint16(value);
                }
                else if (value >= -2147483648 && value <= 2147483647) {
                    this.writeByte(TYPE_INT32);
                    this.writeInt32(value);
                }
                else {
                    this.writeByte(TYPE_FLOAT64);
                    this.writeFloat64(value);
                }
            }
            else {
                this.writeByte(TYPE_FLOAT64);
                this.writeFloat64(value);
            }
        }
        else if (typeof value === 'string') {
            this.writeByte(TYPE_STRING);
            this.writeString(value);
        }
        else if (Array.isArray(value)) {
            this.writeByte(TYPE_ARRAY);
            this.writeUint16(value.length);
            for (const item of value) {
                this.writeValue(item);
            }
        }
        else if (typeof value === 'object') {
            this.writeByte(TYPE_OBJECT);
            const keys = Object.keys(value);
            this.writeUint16(keys.length);
            for (const key of keys) {
                this.writeString(key);
                this.writeValue(value[key]);
            }
        }
        else {
            // Unknown type - encode as null
            this.writeByte(TYPE_NULL);
        }
    }
    toUint8Array() {
        return new Uint8Array(this.buffer);
    }
}
/**
 * Binary decoder - reads bytes
 */
class BinaryDecoder {
    constructor(data) {
        this.pos = 0;
        this.data = data;
    }
    readByte() {
        return this.data[this.pos++];
    }
    readUint16() {
        const b1 = this.data[this.pos++];
        const b2 = this.data[this.pos++];
        return (b1 << 8) | b2;
    }
    readUint32() {
        const b1 = this.data[this.pos++];
        const b2 = this.data[this.pos++];
        const b3 = this.data[this.pos++];
        const b4 = this.data[this.pos++];
        return ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >>> 0;
    }
    readInt32() {
        const u = this.readUint32();
        return u > 0x7FFFFFFF ? u - 0x100000000 : u;
    }
    readFloat64() {
        const view = new DataView(new ArrayBuffer(8));
        for (let i = 0; i < 8; i++) {
            view.setUint8(i, this.data[this.pos++]);
        }
        return view.getFloat64(0, false);
    }
    readString() {
        const len = this.readUint16();
        const bytes = this.data.slice(this.pos, this.pos + len);
        this.pos += len;
        return new TextDecoder().decode(bytes);
    }
    readValue() {
        const type = this.readByte();
        switch (type) {
            case TYPE_NULL:
                return null;
            case TYPE_FALSE:
                return false;
            case TYPE_TRUE:
                return true;
            case TYPE_UINT8:
                return this.readByte();
            case TYPE_UINT16:
                return this.readUint16();
            case TYPE_INT32:
                return this.readInt32();
            case TYPE_UINT32:
                return this.readUint32();
            case TYPE_FLOAT64:
                return this.readFloat64();
            case TYPE_STRING:
                return this.readString();
            case TYPE_ARRAY: {
                const len = this.readUint16();
                const arr = [];
                for (let i = 0; i < len; i++) {
                    arr.push(this.readValue());
                }
                return arr;
            }
            case TYPE_OBJECT: {
                const len = this.readUint16();
                const obj = {};
                for (let i = 0; i < len; i++) {
                    const key = this.readString();
                    obj[key] = this.readValue();
                }
                return obj;
            }
            default:
                return null;
        }
    }
}
/**
 * Encode any JSON-compatible value to binary.
 */
export function encode(value) {
    const encoder = new BinaryEncoder();
    encoder.writeValue(value);
    return encoder.toUint8Array();
}
/**
 * Decode binary data to a value.
 */
export function decode(data) {
    const decoder = new BinaryDecoder(data);
    return decoder.readValue();
}
