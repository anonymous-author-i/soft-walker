import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import loadMujoco from '@mujoco/mujoco';
import * as ort from 'onnxruntime-web/wasm';
import {Simulation} from '../sim/physics.js';

test('real WASM physics: walking, turns, 40 N pull/release, reset and shuffled joints', async () => {
  const config = JSON.parse(readFileSync(new URL('../sim/assets/config.json', import.meta.url)));
  const mj = await loadMujoco();
  mj.FS.mkdirTree('/scene/g1/meshes');
  for (const name of config.scene_files) mj.FS.writeFile('/scene/' + name, readFileSync(new URL('../sim/assets/' + name, import.meta.url)));
  const sim = new Simulation(mj, mj.MjModel.mj_loadXML('/scene/' + config.scene), config);
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(readFileSync(new URL('../sim/assets/policy_ampdual.onnx', import.meta.url)), {executionProviders: ['wasm']});
  async function step(current = sim) {
    const input = new ort.Tensor('float32', current.observation(), [1,2450]);
    const output = await session.run({student_history: input});
    current.advance(output.nominal_actions.data, output.compliance_offsets.data);
    input.dispose(); Object.values(output).forEach(t => t.dispose());
    assert.ok(current.data.qpos[2] > .5, `Robot lost standing height: ${current.data.qpos[2]}`);
  }
  try {
    for (const command of [[0,0,0],[.6,0,0],[-.4,0,0],[0,.5,0],[0,-.5,0],[0,0,.5],[0,0,-.5],[.6,.5,.5]]) {
      sim.reset(); sim.setCommand(command);
      for (let i = 0; i < 500; i++) await step();
      assert.ok(Math.abs(sim.data.time - 10) < 1e-8);
      const root = Array.from(sim.data.qpos.slice(0,3));
      if (command[0] > 0 && command[2] === 0) assert.ok(root[0] > 3);
      if (command[0] < 0) assert.ok(root[0] < -1);
      if (command[1] !== 0 && command[0] === 0) assert.ok(root[1] * command[1] > .5);
      if (command[2] !== 0 && command[0] === 0) assert.ok(Math.abs(sim.data.qpos[6]) > .1);
    }
    sim.reset();
    const torso = mj.mj_name2id(sim.model, mj.mjtObj.mjOBJ_BODY.value, 'torso_link');
    const knee = mj.mj_name2id(sim.model, mj.mjtObj.mjOBJ_BODY.value, 'left_knee_link');
    assert.throws(() => sim.setDrag({body:knee,local:[0,0,0],target:[1,0,0]}));
    for (let i = 0; i < 500; i++) {
      if (i === 100) sim.setDrag({body:torso,local:[0,0,.1],target:[-10,0,1]});
      if (i === 150) sim.setDrag(null);
      await step();
      assert.ok(Math.hypot(...sim.force.force) <= 40 + 1e-10);
      if (i >= 150) assert.ok(sim.data.xfrc_applied.every(x => x === 0));
    }
    for (const alpha of [.5,.75,1,1.5,2]) for (const beta of [.5,.75,1,1.5,2]) {
      sim.reset(alpha,beta);
      for (let i = 0; i < 100; i++) await step();
    }
    // The actual MuJoCo adapter must use names instead of assuming SDK ordering.
    const shuffled = structuredClone(config);
    for (const key of ['joint_names','default_joint_qpos','joint_kp','joint_kd','action_scale','safe_joint_limits']) shuffled[key].reverse();
    const reordered = new Simulation(mj, mj.MjModel.mj_loadXML('/scene/' + config.scene), shuffled);
    try {
      assert.deepEqual(reordered.qposIds, [...sim.qposIds].reverse());
      assert.deepEqual(reordered.actuators, [...sim.actuators].reverse());
      const obs = reordered.observation();
      assert.ok(obs.slice(150,875).every(v => Math.abs(v) < 1e-7));
    } finally { reordered.dispose(); }
    sim.reset();
    assert.equal(sim.data.time,0);
    assert.ok(sim.controller.lastAction.every(x => x === 0));
    assert.ok(sim.controller.compliance.every(x => x === 0));
    assert.ok(sim.data.xfrc_applied.every(x => x === 0));
    assert.deepEqual(sim.command,[0,0,0]);
  } finally { await session.release(); sim.dispose(); }
});
