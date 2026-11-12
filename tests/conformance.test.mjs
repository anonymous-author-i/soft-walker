import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as ort from 'onnxruntime-web/wasm';
import {SoftWalkerController} from '../sim/core.js';

const reference = JSON.parse(readFileSync(new URL('./fixtures/python-reference.json', import.meta.url)));
function close(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= 1e-4 + 1e-4 * Math.abs(expected[i]), `${label}[${i}]: ${actual[i]} versus ${expected[i]}`);
}
test('Python parity: histories, gravity, offsets, targets, scales and reset', () => {
  for (const {config, steps} of reference.cases) {
    const controller = new SoftWalkerController(config);
    for (const [i, step] of steps.entries()) {
      if (step.reset) controller.reset();
      const obs = controller.observe(step.state, step.command);
      if (step.observation) close(obs, step.observation, `observation ${i}`);
      close(controller.targets(step.nominal, step.offsets), step.targets, `targets ${i}`);
    }
  }
});
test('actual ONNX Runtime Web WASM matches Python dual outputs across 102 steps', async () => {
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(readFileSync(new URL('../sim/assets/policy_ampdual.onnx', import.meta.url)), {executionProviders: ['wasm']});
  try {
    for (const {config, steps} of reference.cases) {
      const controller = new SoftWalkerController(config);
      for (const [i, step] of steps.entries()) {
        if (step.reset) controller.reset();
        const observation = controller.observe(step.state, step.command);
        const input = new ort.Tensor('float32', observation, [1,2450]);
        const output = await session.run({student_history: input});
        close(output.nominal_actions.data, step.nominal, `WASM nominal ${i}`);
        close(output.compliance_offsets.data, step.offsets, `WASM offsets ${i}`);
        close(controller.targets(output.nominal_actions.data, output.compliance_offsets.data), step.targets, `WASM targets ${i}`);
        input.dispose(); Object.values(output).forEach(t => t.dispose());
      }
    }
  } finally { await session.release(); }
});
