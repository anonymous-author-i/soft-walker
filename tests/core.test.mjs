import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SoftWalkerController, commandFromKeys, dragWrench, projectedGravity, localToWorld} from '../sim/core.js';
const config = JSON.parse(readFileSync(new URL('../sim/assets/config.json', import.meta.url)));
const initial = {gyro: [0, 0, 0], quaternion: [1, 0, 0, 0], positions: config.default_joint_qpos, velocities: Array(29).fill(0)};
test('all six keys, opposing keys and combined motion use body-frame commands', () => {
  for (const [key, command] of Object.entries({KeyW:[.6,0,0],KeyS:[-.4,0,0],KeyA:[0,.5,0],KeyD:[0,-.5,0],KeyQ:[0,0,.5],KeyE:[0,0,-.5]})) assert.deepEqual(commandFromKeys(new Set([key])), command);
  assert.deepEqual(commandFromKeys(new Set(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE'])), [0,0,0]);
  assert.deepEqual(commandFromKeys(new Set(['KeyW','KeyD','KeyQ'])), [.6,-.5,.5]);
  assert.deepEqual(commandFromKeys(new Set()), [0,0,0]);
});
test('history is term-major, initialized by repetition and reset completely', () => {
  const p = new SoftWalkerController(config);
  let obs = p.observe(initial, [.6,0,0]);
  assert.equal(obs.length, 2450);
  assert.deepEqual([...obs.slice(75,81)].map(x => x || 0), [0,0,-1,0,0,-1]);
  assert.deepEqual([...obs.slice(-4)], [-1,0,-1,0]);
  p.observe({...initial, gyro: [1,2,3]}, [0,0,0]);
  assert.deepEqual([...p.history[0].slice(-6)], [0,0,0,1,2,3]);
  p.targets(new Float32Array(29).fill(.2), new Float32Array(15).fill(.2));
  p.reset(2,2);
  assert.equal(p.history, null); assert.ok(p.lastAction.every(x => x === 0)); assert.ok(p.compliance.every(x => x === 0));
  obs = p.observe(initial, [0,0,0]); assert.deepEqual([...obs.slice(-4)], [1,1,1,1]);
});
test('nonfinite offsets are sanitized, projection has final priority', () => {
  const p = new SoftWalkerController(config);
  const offsets = new Float32Array(15).fill(NaN);
  const nominal = new Float32Array(29); nominal[12] = 100;
  const target = p.targets(nominal, offsets);
  assert.ok(Math.abs(target[12] - config.safe_joint_limits[12][1]) < 1e-5);
  assert.ok(Math.abs(p.compliance[0]) > config.compliance_max_offset[0]);
  assert.throws(() => p.targets(new Float32Array(29).fill(NaN), offsets));
  assert.throws(() => p.reset(.4,1));
  assert.throws(() => projectedGravity([0,0,0,0]));
});
test('drag caps vector magnitude and preserves off-center torque in all directions', () => {
  for (let i = 0; i < 500; i++) {
    const target = [Math.sin(i)*100, Math.cos(i)*100, Math.sin(i*1.1)*100];
    const point = [0, .2, .1], center = [0,0,0];
    const {force, torque} = dragWrench(point, target, center);
    assert.ok(Math.hypot(...force) <= 40 + 1e-12);
    assert.ok(Math.abs(torque[0] - (.2*force[2]-.1*force[1])) < 1e-10);
    assert.ok(Math.abs(torque[2] + .2*force[0]) < 1e-10);
  }
  assert.deepEqual(dragWrench([0,0,0],[.1,0,0],[0,0,0]).force,[10,0,0]);
  assert.deepEqual(localToWorld([1,0,0],[1,2,3],[0,-1,0,1,0,0,0,0,1]),[1,3,3]);
});
