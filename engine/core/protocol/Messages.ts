export enum MessageType {
  // Client → Server
  PlayerKeyDown = 'playerKeyDown',
  PlayerKeyUp = 'playerKeyUp',
  PlayerMouseMoved = 'playerMouseMoved',
  PlayerSelectInventorySlot = 'playerSelectInventorySlot',
  PlayerSwapInventorySlot = 'playerSwapInventorySlot',
  ShopBuyItem = 'shopBuyItem',
  JoinGame = 'joinGame',
  LeaveGame = 'leaveGame',
  Ping = 'ping',
  PlayerChat = 'playerChat',

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
  /** Ground-plane depth. The client maps this to world z — it is NOT the height. */
  y: number;
  /**
   * Height above the floor, in tiles. Named `height` rather than `z` on purpose: `y`
   * here is already the ground-plane depth axis that becomes world z on the client, so
   * a field called `z` would mean two different axes in the same object. Omitted on the
   * wire when zero, which is almost every entity almost always.
   */
  height?: number;
  rotation: number;
  isTeleporting?: boolean;
  teleportCamera?: boolean;
}

export interface EncodedTransform {
  x: string;
  y: string;
  height?: string;
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
  // Send height only when the entity is off the floor. Most never leave it, and this
  // game already streams 69 props every tick — a field per entity per snapshot is the
  // kind of cost that only shows up under load.
  if (data.height) result.height = Math.round(data.height * POSITION_SCALE).toString(16);
  if (data.isTeleporting) result.isTeleporting = '1';
  if (data.teleportCamera) result.teleportCamera = '1';
  return result;
}

export function decodeTransform(encoded: EncodedTransform): TransformData {
  return {
    x: parseInt(encoded.x, 16) / POSITION_SCALE,
    y: parseInt(encoded.y, 16) / POSITION_SCALE,
    height: encoded.height === undefined ? 0 : parseInt(encoded.height, 16) / POSITION_SCALE,
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
