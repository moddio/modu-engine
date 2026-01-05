/**
 * Trigger System
 *
 * Handles trigger (sensor) bodies that detect overlap without physics response.
 * Generic implementation shared between 2D and 3D physics engines.
 */
/**
 * Minimal interface for a physics body used by triggers.
 * Both RigidBody (3D) and RigidBody2D implement this.
 */
export interface TriggerBody {
    label: string;
    isSensor: boolean;
}
export interface TriggerEvent<T extends TriggerBody = TriggerBody> {
    trigger: T;
    other: T;
}
type TriggerCallback<T extends TriggerBody> = (event: TriggerEvent<T>) => void;
export declare class TriggerState<T extends TriggerBody = TriggerBody> {
    private overlaps;
    private enterCallbacks;
    private stayCallbacks;
    private exitCallbacks;
    onEnter(cb: TriggerCallback<T>): void;
    onStay(cb: TriggerCallback<T>): void;
    onExit(cb: TriggerCallback<T>): void;
    processOverlaps(currentOverlaps: TriggerEvent<T>[]): void;
    clear(): void;
    removeBody(body: T): void;
    getOverlappingBodies(trigger: T): T[];
    isBodyInTrigger(trigger: T, body: T): boolean;
    overlapCount(): number;
    saveState(): [string, string][];
    private pendingPairs;
    loadState(pairs: [string, string][]): void;
    syncWithWorld(bodies: T[]): void;
    private makeKey;
}
/**
 * Mark a body as a trigger (sensor).
 * Works with any body type that has an isSensor property.
 */
export declare function makeTrigger<T extends TriggerBody>(body: T): T;
export {};
