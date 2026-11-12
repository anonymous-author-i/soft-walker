// Pure control math, shared by the worker and numerical conformance tests.
export const CONTROL_DT = 0.02;
export const HISTORY_LENGTH = 25;
export const TERM_DIMS = [3, 3, 29, 29, 29, 3, 2];
export const MAX_FORCE = 40;
const f = Math.fround;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function finiteVector(value, length, label) {
  if (!value || value.length !== length || !Array.from(value).every(Number.isFinite)) {
    throw new Error(`Invalid ${label}: expected ${length} finite values.`);
  }
  return Float32Array.from(value);
}

export function validateScales(alpha, beta) {
  if (![alpha, beta].every(x => Number.isFinite(x) && x >= 0.5 && x <= 2)) {
    throw new Error('Compliance multipliers must be between 0.5 and 2.');
  }
}

export function commandFromKeys(keys) {
  return [keys.has('KeyW') && keys.has('KeyS') ? 0 : (keys.has('KeyW') ? 0.6 : 0) - (keys.has('KeyS') ? 0.4 : 0),
    (Number(keys.has('KeyA')) - Number(keys.has('KeyD'))) * 0.5,
    (Number(keys.has('KeyQ')) - Number(keys.has('KeyE'))) * 0.5];
}

export function projectedGravity(quaternion) {
  const q = finiteVector(quaternion, 4, 'pelvis quaternion');
  const norm = Math.hypot(...q);
  if (norm < 1e-6) throw new Error('Pelvis quaternion has zero norm.');
  const [w, x, y, z] = Array.from(q, v => f(v / norm));
  return Float32Array.of(2 * (w * y - x * z), -2 * (y * z + w * x), 2 * (x * x + y * y) - 1);
}

export class SoftWalkerController {
  constructor(config, alpha = config.alpha, beta = config.beta) {
    this.config = config;
    this.complianceIds = config.compliance_joint_names.map(n => config.joint_names.indexOf(n));
    if (config.joint_names.length !== 29 || this.complianceIds.length !== 15 || this.complianceIds.includes(-1)) {
      throw new Error('Invalid G1 joint mapping.');
    }
    this.reset(alpha, beta);
  }
  reset(alpha = this.alpha, beta = this.beta) {
    validateScales(alpha, beta);
    this.alpha = alpha;
    this.beta = beta;
    this.scales = Float32Array.of(Math.log2(alpha), Math.log2(beta));
    this.history = null;
    this.lastAction = new Float32Array(29);
    this.compliance = new Float32Array(15);
  }
  observe({gyro, quaternion, positions, velocities}, command) {
    const q = finiteVector(positions, 29, 'joint positions');
    const terms = [finiteVector(gyro, 3, 'pelvis gyro'), projectedGravity(quaternion),
      q.map((v, i) => v - this.config.default_joint_qpos[i]), finiteVector(velocities, 29, 'joint velocities'),
      this.lastAction, finiteVector(command, 3, 'velocity command'), this.scales];
    if (!this.history) {
      this.history = terms.map(term => {
        const result = new Float32Array(term.length * HISTORY_LENGTH);
        for (let i = 0; i < HISTORY_LENGTH; i++) result.set(term, i * term.length);
        return result;
      });
    } else {
      this.history.forEach((history, i) => {
        history.copyWithin(0, terms[i].length);
        history.set(terms[i], history.length - terms[i].length);
      });
    }
    const observation = new Float32Array(2450);
    let offset = 0;
    for (const history of this.history) { observation.set(history, offset); offset += history.length; }
    return observation;
  }
  targets(nominal, offsets) {
    const action = finiteVector(nominal, 29, 'nominal actions');
    if (offsets.length !== 15) throw new Error('Expected 15 compliance offsets.');
    const c = this.config;
    const targets = action.map((v, i) => f(c.default_joint_qpos[i] + f(c.action_scale[i] * v)));
    this.complianceIds.forEach((joint, i) => {
      const requested = Number.isFinite(offsets[i]) ? f(offsets[i]) : 0;
      const velocity = clamp(f(f(requested - this.compliance[i]) / f(CONTROL_DT)), -c.compliance_max_velocity[i], c.compliance_max_velocity[i]);
      const limited = f(this.compliance[i] + f(f(CONTROL_DT) * velocity));
      const bounded = clamp(limited, -c.compliance_max_offset[i], c.compliance_max_offset[i]);
      const projected = clamp(bounded, f(c.safe_joint_limits[joint][0] - targets[joint]), f(c.safe_joint_limits[joint][1] - targets[joint]));
      this.compliance[i] = projected;
      targets[joint] = f(targets[joint] + projected);
    });
    finiteVector(targets, 29, 'joint targets');
    this.lastAction.set(action);
    return targets;
  }
}

export function dragWrench(point, target, center) {
  if (![...point, ...target, ...center].every(Number.isFinite)) throw new Error('Invalid drag position.');
  const force = target.map((x, i) => 100 * (x - point[i]));
  const scale = Math.min(1, MAX_FORCE / (Math.hypot(...force) || 1));
  for (let i = 0; i < 3; i++) force[i] *= scale;
  const r = point.map((x, i) => x - center[i]);
  return {force, torque: [r[1] * force[2] - r[2] * force[1], r[2] * force[0] - r[0] * force[2], r[0] * force[1] - r[1] * force[0]]};
}

export function localToWorld(local, position, rotation) {
  return [0, 1, 2].map(i => position[i] + rotation[i * 3] * local[0] + rotation[i * 3 + 1] * local[1] + rotation[i * 3 + 2] * local[2]);
}
