/**
 * Trigger System
 *
 * Handles trigger (sensor) bodies that detect overlap without physics response.
 * Generic implementation shared between 2D and 3D physics engines.
 */
// ============================================
// Trigger State
// ============================================
export class TriggerState {
    constructor() {
        this.overlaps = new Map();
        this.enterCallbacks = [];
        this.stayCallbacks = [];
        this.exitCallbacks = [];
        this.pendingPairs = [];
    }
    onEnter(cb) { this.enterCallbacks.push(cb); }
    onStay(cb) { this.stayCallbacks.push(cb); }
    onExit(cb) { this.exitCallbacks.push(cb); }
    processOverlaps(currentOverlaps) {
        const currentKeys = new Set();
        const sortedOverlaps = [...currentOverlaps].sort((a, b) => {
            return this.makeKey(a.trigger, a.other).localeCompare(this.makeKey(b.trigger, b.other));
        });
        for (const overlap of sortedOverlaps) {
            const key = this.makeKey(overlap.trigger, overlap.other);
            currentKeys.add(key);
            if (this.overlaps.has(key)) {
                for (const cb of this.stayCallbacks)
                    cb(overlap);
            }
            else {
                this.overlaps.set(key, overlap);
                for (const cb of this.enterCallbacks)
                    cb(overlap);
            }
        }
        const sortedExistingKeys = [...this.overlaps.keys()].sort();
        for (const key of sortedExistingKeys) {
            if (!currentKeys.has(key)) {
                const overlap = this.overlaps.get(key);
                this.overlaps.delete(key);
                for (const cb of this.exitCallbacks)
                    cb(overlap);
            }
        }
    }
    clear() {
        this.overlaps.clear();
    }
    removeBody(body) {
        const keysToRemove = [];
        for (const [key, overlap] of this.overlaps) {
            if (overlap.trigger === body || overlap.other === body) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.sort();
        for (const key of keysToRemove) {
            const overlap = this.overlaps.get(key);
            this.overlaps.delete(key);
            for (const cb of this.exitCallbacks)
                cb(overlap);
        }
    }
    getOverlappingBodies(trigger) {
        const bodies = [];
        for (const overlap of this.overlaps.values()) {
            if (overlap.trigger === trigger) {
                bodies.push(overlap.other);
            }
        }
        return bodies.sort((a, b) => a.label.localeCompare(b.label));
    }
    isBodyInTrigger(trigger, body) {
        return this.overlaps.has(this.makeKey(trigger, body));
    }
    overlapCount() {
        return this.overlaps.size;
    }
    saveState() {
        const pairs = [];
        for (const overlap of this.overlaps.values()) {
            pairs.push([overlap.trigger.label, overlap.other.label]);
        }
        return pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    }
    loadState(pairs) {
        this.overlaps.clear();
        this.pendingPairs = pairs;
    }
    syncWithWorld(bodies) {
        const bodyByLabel = new Map();
        for (const body of bodies)
            bodyByLabel.set(body.label, body);
        for (const [triggerLabel, otherLabel] of this.pendingPairs) {
            const trigger = bodyByLabel.get(triggerLabel);
            const other = bodyByLabel.get(otherLabel);
            if (trigger && other) {
                this.overlaps.set(this.makeKey(trigger, other), { trigger, other });
            }
        }
        this.pendingPairs = [];
    }
    makeKey(trigger, other) {
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
export function makeTrigger(body) {
    body.isSensor = true;
    return body;
}
