/**
 * State Serialization
 *
 * Functions for saving and loading world state for rollback netcode.
 * Uses labels for body matching to ensure determinism across clients.
 */
import { Fixed } from '../../math/fixed';
import { World } from './world';
export interface BodyState {
    id: number;
    label: string;
    px: Fixed;
    py: Fixed;
    pz: Fixed;
    qx: Fixed;
    qy: Fixed;
    qz: Fixed;
    qw: Fixed;
    vx: Fixed;
    vy: Fixed;
    vz: Fixed;
    avx: Fixed;
    avy: Fixed;
    avz: Fixed;
    isSleeping: boolean;
    sleepFrames: number;
}
export interface WorldState {
    bodies: BodyState[];
}
export declare function saveWorldState(world: World): WorldState;
export declare function loadWorldState(world: World, state: WorldState): void;
