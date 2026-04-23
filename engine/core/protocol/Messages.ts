export enum MessageType {
  // Client → Server
  PlayerKeyDown = 'playerKeyDown',
  PlayerKeyUp = 'playerKeyUp',
  PlayerMouseMoved = 'playerMouseMoved',
  JoinGame = 'joinGame',
  LeaveGame = 'leaveGame',
  Ping = 'ping',

  // Server → Client
  InitConnection = 'initConnection',
  EntityCreate = 'entityCreate',
  EntityDestroy = 'entityDestroy',
  EntityTransform = 'entityTransform',
  EntityStatsUpdate = 'entityStatsUpdate',
  Snapshot = 'snapshot',
  Pong = 'pong',
  ChatMessage = 'chatMessage',
  UICommand = 'uiCommand',
}

export interface TransformData {
  x: number;
  y: number;
  rotation: number;
  isTeleporting?: boolean;
  teleportCamera?: boolean;
}

export interface EncodedTransform {
  x: string;
  y: string;
  rotation: string;
  isTeleporting?: string;
  teleportCamera?: string;
}

// Position is in world/tile units (1 unit ≈ 1 tile). Encoding at integer precision
// would quantize movement to full tiles; scale by 1000 for sub-tile precision,
// mirroring how rotation is encoded.
const POSITION_SCALE = 1000;

export function encodeTransform(data: TransformData): EncodedTransform {
  const result: EncodedTransform = {
    x: Math.round(data.x * POSITION_SCALE).toString(16),
    y: Math.round(data.y * POSITION_SCALE).toString(16),
    rotation: Math.round((data.rotation % (2 * Math.PI)) * 1000).toString(16),
  };
  if (data.isTeleporting) result.isTeleporting = '1';
  if (data.teleportCamera) result.teleportCamera = '1';
  return result;
}

export function decodeTransform(encoded: EncodedTransform): TransformData {
  return {
    x: parseInt(encoded.x, 16) / POSITION_SCALE,
    y: parseInt(encoded.y, 16) / POSITION_SCALE,
    rotation: parseInt(encoded.rotation, 16) / 1000,
    isTeleporting: encoded.isTeleporting === '1',
    teleportCamera: encoded.teleportCamera === '1',
  };
}

export interface JoinGamePayload {
  playerName: string;
  isMobile: boolean;
}

export interface PlayerInputPayload {
  device: 'keyboard' | 'mouse';
  key: string;
}

export interface MouseMovedPayload {
  x: number;
  y: number;
}

export interface EntityCreatePayload {
  classId: string;
  entityId: string;
  transform: EncodedTransform;
  stats: Record<string, unknown>;
}

export interface EntityDestroyPayload {
  entityId: string;
  timestamp: number;
}

export interface EntityTransformPayload {
  entityId: string;
  transform: EncodedTransform;
}

export interface EntityStatsUpdatePayload {
  [entityId: string]: Record<string, unknown>;
}

export interface SnapshotPayload {
  transforms: EntityTransformPayload[];
  timestamp: number;
}

export interface GameMessage {
  type: MessageType;
  data: unknown;
}
