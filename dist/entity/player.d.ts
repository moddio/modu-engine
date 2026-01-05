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
import { BaseEntity, Entity } from './entity';
export declare function setPlayerEngineRef(e: any): void;
export declare class Player extends BaseEntity {
    /** The unit (Entity2D) this player controls */
    unit: Entity | null;
    constructor(clientId: string);
    /** The client ID this player belongs to */
    get clientId(): string;
}
