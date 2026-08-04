import { describe, it, expect } from 'vitest';
import {
  MessageType,
  encodeTransform,
  decodeTransform,
  type TransformData,
} from '../../../engine/core/protocol/Messages';
import { buildEntityCreatePayload, mergeStatsUpdate, MERGE_KEYS } from '../../../engine/core/protocol/EntityStream';

describe('Protocol Messages', () => {
  describe('MessageType enum', () => {
    it('has all required message types', () => {
      expect(MessageType.PlayerKeyDown).toBe('playerKeyDown');
      expect(MessageType.EntityCreate).toBe('entityCreate');
      expect(MessageType.Snapshot).toBe('snapshot');
      expect(MessageType.JoinGame).toBe('joinGame');
      expect(MessageType.Ping).toBe('ping');
      expect(MessageType.Pong).toBe('pong');
    });
  });

  describe('encodeTransform', () => {
    it('encodes position and rotation to hex with sub-unit precision', () => {
      const encoded = encodeTransform({ x: 100, y: 200, rotation: 1.5708 });
      expect(encoded.x).toBe((100 * 1000).toString(16));
      expect(encoded.y).toBe((200 * 1000).toString(16));
      expect(encoded.rotation).toBe(Math.round(1.5708 * 1000).toString(16));
    });

    it('preserves fractional world-unit positions', () => {
      const decoded = decodeTransform(encodeTransform({ x: 12.345, y: -7.891, rotation: 0 }));
      expect(decoded.x).toBeCloseTo(12.345, 3);
      expect(decoded.y).toBeCloseTo(-7.891, 3);
    });

    it('encodes teleport flags', () => {
      const encoded = encodeTransform({ x: 0, y: 0, rotation: 0, isTeleporting: true, teleportCamera: true });
      expect(encoded.isTeleporting).toBe('1');
      expect(encoded.teleportCamera).toBe('1');
    });

    it('omits teleport flags when false', () => {
      const encoded = encodeTransform({ x: 0, y: 0, rotation: 0 });
      expect(encoded.isTeleporting).toBeUndefined();
    });
  });

  describe('decodeTransform', () => {
    it('decodes hex back to numbers', () => {
      const decoded = decodeTransform({
        x: (100 * 1000).toString(16),
        y: (200 * 1000).toString(16),
        rotation: '3e8',
      });
      expect(decoded.x).toBe(100);
      expect(decoded.y).toBe(200);
      expect(decoded.rotation).toBe(1);
    });

    it('roundtrips correctly', () => {
      const original: TransformData = { x: 576, y: 320, rotation: 0.785 };
      const decoded = decodeTransform(encodeTransform(original));
      expect(decoded.x).toBe(576);
      expect(decoded.y).toBe(320);
      expect(decoded.rotation).toBeCloseTo(0.785, 2);
    });
  });

  describe('buildEntityCreatePayload', () => {
    it('builds a create payload with encoded transform', () => {
      const payload = buildEntityCreatePayload('unit', 'u1', 100, 200, 0, { name: 'Test' });
      expect(payload.classId).toBe('unit');
      expect(payload.entityId).toBe('u1');
      expect(payload.transform.x).toBe((100 * 1000).toString(16));
      expect(payload.transform.y).toBe((200 * 1000).toString(16));
      expect(payload.stats.name).toBe('Test');
    });
  });

  describe('mergeStatsUpdate', () => {
    it('merges attribute keys', () => {
      const existing = { attributes: { health: { value: 100 } }, name: 'Old' };
      const update = { attributes: { speed: { value: 40 } }, name: 'New' };
      const result = mergeStatsUpdate(existing, update);
      expect((result.attributes as any).health.value).toBe(100);
      expect((result.attributes as any).speed.value).toBe(40);
      expect(result.name).toBe('New');
    });

    it('overwrites non-merge keys', () => {
      const result = mergeStatsUpdate({ stateId: 'idle' }, { stateId: 'walk' });
      expect(result.stateId).toBe('walk');
    });
  });
});
