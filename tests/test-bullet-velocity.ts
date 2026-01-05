/**
 * Test: Bullet velocity using Physics2DComponent
 * Mimics exactly what 2d-shooter.html does
 */

import { ModuEngine } from '../src/engine';
import { Physics2DComponent } from '../src/components/physics2d/component';
import { toFloat } from '../src/math/fixed';

console.log('=== Test: Bullet Velocity (Component) ===\n');

const game = new ModuEngine({ physics: '2d', gravity: { x: 0, y: 0 } });
const em = game.entityManager;

console.log('World exists:', !!game.world);
console.log('World bodies count:', game.world?.bodies?.length);

// Create a bullet exactly like 2d-shooter.html does
const BULLET_SPEED = 12;
const angle = 0; // shooting right

const b = em.create('bullet');
console.log('\n1. Entity created, id:', b.id);

b.addComponent(new Physics2DComponent({
    type: 'kinematic', shape: 'circle', radius: 4, x: 100, y: 100
}));
console.log('2. Component added');
console.log('   Body exists:', !!b.body);
console.log('   World bodies count:', game.world?.bodies?.length);
console.log('   Body in world:', game.world?.bodies?.includes(b.body));

const vx = Math.cos(angle) * BULLET_SPEED;
const vy = Math.sin(angle) * BULLET_SPEED;
console.log('3. Setting velocity:', { vx, vy });

const phys = b.getComponent('physics2d') as any;
phys.setVelocityFloats(vx, vy);
console.log('   Body velocity after set:', phys.getVelocityFloats());
console.log('   Body isSleeping:', b.body.isSleeping);

const startX = b.x;
console.log('\n4. Before step, x =', startX);

// Step physics
game.world.step();

const endX = b.x;
console.log('5. After step, x =', endX);
console.log('   Movement:', endX - startX);

if (endX > startX) {
    console.log('\n✓ PASS: Bullet moved!');
    process.exit(0);
} else {
    console.log('\n✗ FAIL: Bullet did not move');
    console.log('   Checking body state:');
    console.log('   - linearVelocity:', b.body.linearVelocity);
    console.log('   - type:', b.body.type);
    console.log('   - isSleeping:', b.body.isSleeping);
    process.exit(1);
}
