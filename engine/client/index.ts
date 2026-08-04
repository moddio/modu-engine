export { Client } from './Client';
export { Renderer } from './renderer/Renderer';
export type { RendererOptions } from './renderer/Renderer';
export { CameraController } from './renderer/CameraController';
export type { CameraConfig } from './renderer/CameraController';
export { AssetManager } from './renderer/AssetManager';
export type { AssetSource } from './renderer/AssetManager';
export { Camera, ObjectPool, SpatialIndex, EntityManager } from './renderer/index';
export { MapTabController } from './MapTabController';
export type { MapTabControllerDeps } from './MapTabController';
export { EntityTypeRegistry } from '../core/game/EntityTypeRegistry';
export { InputManager, Key, MobileControls } from './input/index';
export { AudioManager } from './audio/index';
export type { SoundDef } from './audio/index';
export { PostProcessing, ParticleEmitter } from './renderer/index';
export type { PostProcessingConfig, ParticleConfig } from './renderer/index';
export {
  UIManager, MenuUI, ScoreboardUI, ChatUI, GameTextUI,
  ShopUI, TradeUI, DevConsole,
} from './ui/index';
export type {
  UIComponent, MenuState, ServerInfo, ScoreEntry,
  ChatMessage, GameNotification, NotificationType,
  ShopItem, ConsoleMessage,
} from './ui/index';
export { GameLoader } from '../core/GameLoader';
export type { GameData, ScriptDef } from '../core/GameLoader';
export { GameMigrator } from '../core/GameMigrator';
export type { MigratedGameData } from '../core/GameMigrator';
export { CoordinateUtils } from '../core/CoordinateUtils';
export { LocalGameSession } from '../core/LocalGameSession';
export type { LocalGameConfig } from '../core/LocalGameSession';
export { VoxelTileMap } from './renderer/tilemap/index';
export type { ClientTransport } from './transport/ClientTransport';
export { GameServer } from '../server/GameServer';
export { GameLoop } from '../server/GameLoop';
export { createInMemoryPair } from '../core/transport/InMemoryTransport';
export { MessageType, encodeTransform, decodeTransform } from '../core/protocol/Messages';
export type { GameMessage, TransformData, EntityCreatePayload, SnapshotPayload } from '../core/protocol/Messages';
export * as THREE from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
