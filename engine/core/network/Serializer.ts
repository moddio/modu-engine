import { encode, decode } from '@msgpack/msgpack';

export class Serializer {
  static encode(data: unknown): Uint8Array {
    return encode(data);
  }

  static decode(buffer: Uint8Array): unknown {
    return decode(buffer);
  }
}
