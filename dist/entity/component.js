/**
 * Entity System - Base Component
 *
 * Components add data and behavior to entities.
 * All component state must be serializable for rollback.
 */
// ============================================
// Base Component Implementation
// ============================================
export class BaseComponent {
    constructor() {
        this.entity = null;
    }
}
