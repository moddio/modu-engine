/**
 * Trigger System
 *
 * Handles trigger (sensor) bodies that detect overlap without physics response.
 * Generic implementation shared between 2D and 3D physics engines.
 */

// ============================================
// Body Interface (minimal contract)
// ============================================

/**
 * Minimal interface for a physics body used by triggers.
 * Both RigidBody (3D) and RigidBody2D implement this.
 */
export interface TriggerBody {
    label: string;
    isSensor: boolean;
}

// ============================================
// Trigger Event
// ============================================

export interface TriggerEvent<T extends TriggerBody = TriggerBody> {
    trigger: T;
    other: T;
}

type TriggerCallback<T extends TriggerBody> = (event: TriggerEvent<T>) => void;

// ============================================
// Trigger State
// ============================================

export class TriggerState<T extends TriggerBody = TriggerBody> {
    private overlaps = new Map<string, { trigger: T; other: T }>();
    private enterCallbacks: TriggerCallback<T>[] = [];
    private stayCallbacks: TriggerCallback<T>[] = [];
    private exitCallbacks: TriggerCallback<T>[] = [];

    onEnter(cb: TriggerCallback<T>): void { this.enterCallbacks.push(cb); }
    onStay(cb: TriggerCallback<T>): void { this.stayCallbacks.push(cb); }
    onExit(cb: TriggerCallback<T>): void { this.exitCallbacks.push(cb); }

    processOverlaps(currentOverlaps: TriggerEvent<T>[]): void {
        const currentKeys = new Set<string>();
        const sortedOverlaps = [...currentOverlaps].sort((a, b) => {
            return this.makeKey(a.trigger, a.other).localeCompare(this.makeKey(b.trigger, b.other));
        });

        for (const overlap of sortedOverlaps) {
            const key = this.makeKey(overlap.trigger, overlap.other);
            currentKeys.add(key);

            if (this.overlaps.has(key)) {
                for (const cb of this.stayCallbacks) cb(overlap);
            } else {
                this.overlaps.set(key, overlap);
                for (const cb of this.enterCallbacks) cb(overlap);
            }
        }

        const sortedExistingKeys = [...this.overlaps.keys()].sort();
        for (const key of sortedExistingKeys) {
            if (!currentKeys.has(key)) {
                const overlap = this.overlaps.get(key)!;
                this.overlaps.delete(key);
                for (const cb of this.exitCallbacks) cb(overlap);
            }
        }
    }

    clear(): void {
        this.overlaps.clear();
    }

    removeBody(body: T): void {
        const keysToRemove: string[] = [];
        for (const [key, overlap] of this.overlaps) {
            if (overlap.trigger === body || overlap.other === body) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.sort();
        for (const key of keysToRemove) {
            const overlap = this.overlaps.get(key)!;
            this.overlaps.delete(key);
            for (const cb of this.exitCallbacks) cb(overlap);
        }
    }

    getOverlappingBodies(trigger: T): T[] {
        const bodies: T[] = [];
        for (const overlap of this.overlaps.values()) {
            if (overlap.trigger === trigger) {
                bodies.push(overlap.other);
            }
        }
        return bodies.sort((a, b) => a.label.localeCompare(b.label));
    }

    isBodyInTrigger(trigger: T, body: T): boolean {
        return this.overlaps.has(this.makeKey(trigger, body));
    }

    overlapCount(): number {
        return this.overlaps.size;
    }

    saveState(): [string, string][] {
        const pairs: [string, string][] = [];
        for (const overlap of this.overlaps.values()) {
            pairs.push([overlap.trigger.label, overlap.other.label]);
        }
        return pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    }

    private pendingPairs: [string, string][] = [];

    loadState(pairs: [string, string][]): void {
        this.overlaps.clear();
        this.pendingPairs = pairs;
    }

    syncWithWorld(bodies: T[]): void {
        const bodyByLabel = new Map<string, T>();
        for (const body of bodies) bodyByLabel.set(body.label, body);

        for (const [triggerLabel, otherLabel] of this.pendingPairs) {
            const trigger = bodyByLabel.get(triggerLabel);
            const other = bodyByLabel.get(otherLabel);
            if (trigger && other) {
                this.overlaps.set(this.makeKey(trigger, other), { trigger, other });
            }
        }
        this.pendingPairs = [];
    }

    private makeKey(trigger: T, other: T): string {
        return `${trigger.label}:${other.label}`;
    }
}

// ============================================
// Helper Function
// ============================================

/**
 * Mark a body as a trigger (sensor).
 * Works with any body type that has an isSensor property.
 */
export function makeTrigger<T extends TriggerBody>(body: T): T {
    body.isSensor = true;
    return body;
}
