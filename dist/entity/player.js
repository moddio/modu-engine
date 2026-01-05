/**
 * Player - Abstract representation of a client connection.
 *
 * IMPORTANT: Player is ABSTRACT - it has NO physics body.
 * Player only handles input via InputComponent.
 *
 * Games create Entity2D units that players control. The Player's
 * InputComponent captures client input, which the game reads via
 * player.input and applies to player.unit (Entity2D).
 *
 * Example:
 *   // onJoin:
 *   const player = new Player(clientId);
 *   player.input.setCommands({ target: { mouse: ['position'] } });
 *   player.unit = new Entity2D().setType('cell').setBody({...});
 *
 *   // onTick:
 *   for (const player of game.getPlayers()) {
 *       const target = player.input.target;
 *       player.unit.moveToward(target.x, target.y, speed);
 *   }
 */
import { BaseEntity, getRestoreContext } from './entity';
import { InputComponent } from '../components/input';
import { setInputEntityFactory, registerClass } from './entity-manager';
// Engine reference for auto-registration
let engine = null;
export function setPlayerEngineRef(e) {
    engine = e;
}
// Register Player as the factory for entities with hasInput=true
setInputEntityFactory((config) => {
    const clientId = config.sync?.clientId || 'unknown';
    return new Player(clientId);
});
export class Player extends BaseEntity {
    constructor(clientId) {
        super();
        /** The unit (Entity2D) this player controls */
        this.unit = null;
        this.sync.clientId = clientId;
        // Mark as having input - loadState will auto-add InputComponent
        this.sync.hasInput = true;
        this.addComponent(new InputComponent());
        // Skip registration if restoring from snapshot (uses context, not config)
        const ctx = getRestoreContext();
        if (ctx?.skipRegister)
            return;
        if (!engine) {
            throw new Error('Player: Engine not initialized. Call Modu.init() first.');
        }
        const em = engine.entityManager;
        this.manager = em;
        em.entities[this.id] = this;
        // Auto-register class for snapshot restore
        registerClass(this.constructor);
    }
    /** The client ID this player belongs to */
    get clientId() {
        return this.sync.clientId;
    }
}
