import {SoftWalkerController, dragWrench, localToWorld, finiteVector} from './core.js';

export class Simulation {
  constructor(mj, model, config) {
    this.mj = mj;
    this.model = model;
    this.config = config;
    this.data = new mj.MjData(model);
    model.opt.timestep = config.physics_dt;
    this.controller = new SoftWalkerController(config);
    const id = (kind, name) => {
      const value = mj.mj_name2id(model, mj.mjtObj[kind].value, name);
      if (value < 0) throw new Error(`Scene is missing ${name}.`);
      return value;
    };
    this.joints = config.joint_names.map(n => id('mjOBJ_JOINT', n));
    this.qposIds = this.joints.map(j => model.jnt_qposadr[j]);
    this.qvelIds = this.joints.map(j => model.jnt_dofadr[j]);
    this.actuators = this.joints.map(j => {
      for (let a = 0; a < model.nu; a++) if (model.actuator_trnid[a * 2] === j) return a;
      throw new Error(`Scene is missing actuator for joint ${j}.`);
    });
    this.gyroAdr = model.sensor_adr[id('mjOBJ_SENSOR', 'imu_gyro')];
    this.quatAdr = model.sensor_adr[id('mjOBJ_SENSOR', 'imu_quat')];
    const torso = id('mjOBJ_BODY', 'torso_link');
    this.draggable = new Set();
    for (let b = 1; b < model.nbody; b++) {
      let ancestor = b;
      while (ancestor > 0 && ancestor !== torso) ancestor = model.body_parentid[ancestor];
      if (ancestor === torso) this.draggable.add(b);
    }
    this.reset();
  }
  clearInput() {
    this.command = [0, 0, 0];
    this.drag = null;
    this.force = {force: [0, 0, 0], point: [0, 0, 0], body: null};
    this.data.xfrc_applied.fill(0);
    this.data.qfrc_applied.fill(0);
  }
  reset(alpha = this.controller.alpha, beta = this.controller.beta) {
    this.controller.reset(alpha, beta);
    this.episode = (this.episode ?? 0) + 1;
    this.mj.mj_resetData(this.model, this.data);
    this.data.qpos[2] = this.config.initial_height;
    this.qposIds.forEach((q, i) => { this.data.qpos[q] = this.config.default_joint_qpos[i]; });
    this.clearInput();
    this.targets = Float32Array.from(this.config.default_joint_qpos);
    this.mj.mj_forward(this.model, this.data);
  }
  setCommand(command) {
    const c = finiteVector(command, 3, 'command');
    this.command = [Math.max(-0.4, Math.min(0.6, c[0])), Math.max(-0.5, Math.min(0.5, c[1])), Math.max(-0.5, Math.min(0.5, c[2]))];
  }
  setDrag(drag) {
    if (!drag) { this.drag = null; this.data.xfrc_applied.fill(0); this.force = {force: [0, 0, 0], point: [0, 0, 0], body: null}; return; }
    if (!this.draggable.has(drag.body)) throw new Error('Only the upper body can be dragged.');
    this.drag = {body: drag.body, local: Array.from(finiteVector(drag.local, 3, 'grab point')), target: Array.from(finiteVector(drag.target, 3, 'drag target'))};
  }
  observation() {
    const d = this.data;
    return this.controller.observe({
      gyro: d.sensordata.slice(this.gyroAdr, this.gyroAdr + 3),
      quaternion: d.sensordata.slice(this.quatAdr, this.quatAdr + 4),
      positions: this.qposIds.map(i => d.qpos[i]), velocities: this.qvelIds.map(i => d.qvel[i]),
    }, this.command);
  }
  advance(nominal, offsets) {
    this.targets = this.controller.targets(nominal, offsets);
    const d = this.data, m = this.model, c = this.config;
    for (let step = 0; step < 4; step++) {
      for (let i = 0; i < 29; i++) {
        const a = this.actuators[i];
        const tau = c.joint_kp[i] * (this.targets[i] - d.qpos[this.qposIds[i]]) - c.joint_kd[i] * d.qvel[this.qvelIds[i]];
        d.ctrl[a] = Math.max(m.actuator_ctrlrange[a * 2], Math.min(m.actuator_ctrlrange[a * 2 + 1], tau));
      }
      d.xfrc_applied.fill(0);
      d.qfrc_applied.fill(0);
      if (this.drag) {
        const {body, local, target} = this.drag;
        const point = localToWorld(local, d.xpos.subarray(body * 3, body * 3 + 3), d.xmat.subarray(body * 9, body * 9 + 9));
        // xfrc_applied is a world-frame wrench about the body's center of mass.
        const {force, torque} = dragWrench(point, target, Array.from(d.xipos.subarray(body * 3, body * 3 + 3)));
        d.xfrc_applied.set([...force, ...torque], body * 6);
        this.force = {force, point, body};
      }
      const previousTime = d.time;
      this.mj.mj_step(m, d);
      if (d.time <= previousTime || !Array.from(d.qpos).every(Number.isFinite) || !Array.from(d.qvel).every(Number.isFinite)) {
        throw new Error('Simulation became unstable. Press Reset to restart.');
      }
      if (d.qpos[2] < 0.2) throw new Error('The robot has fallen. Press Reset to restart.');
    }
    // Refresh transforms and sensors at the newly integrated state.
    this.mj.mj_forward(m, d);
  }
  snapshot() {
    const d = this.data;
    return {time: d.time, episode: this.episode, positions: new Float32Array(d.geom_xpos), rotations: new Float32Array(d.geom_xmat),
      bodyPositions: new Float32Array(d.xpos), bodyQuaternions: new Float32Array(d.xquat),
      root: Array.from(d.qpos.subarray(0, 3)), command: this.command, force: this.force,
      alpha: this.controller.alpha, beta: this.controller.beta};
  }
  geometry() {
    const m = this.model, mj = this.mj;
    const meshes = {};
    const geoms = [];
    for (let g = 0; g < m.ngeom; g++) {
      const type = m.geom_type[g];
      // Render original visual meshes only, without duplicate collision shells.
      if (type === 0 || (type === 7 && m.geom_group[g] !== 1)) continue;
      if (type !== 7 && m.geom_group[g] !== 1) continue;
      const mesh = m.geom_dataid[g];
      if (type === 7 && !meshes[mesh]) {
        const va = m.mesh_vertadr[mesh] * 3, vn = m.mesh_vertnum[mesh] * 3;
        const fa = m.mesh_faceadr[mesh] * 3, fn = m.mesh_facenum[mesh] * 3;
        meshes[mesh] = {vertices: new Float32Array(m.mesh_vert.slice(va, va + vn)), faces: new Uint32Array(m.mesh_face.slice(fa, fa + fn))};
      }
      const body = m.geom_bodyid[g];
      geoms.push({id: g, body, type, mesh, size: Array.from(m.geom_size.slice(g * 3, g * 3 + 3)),
        color: Array.from(m.geom_rgba.slice(g * 4, g * 4 + 4)), draggable: this.draggable.has(body),
        name: mj.mj_id2name(m, mj.mjtObj.mjOBJ_BODY.value, body)});
    }
    return {geoms, meshes};
  }
  dispose() { this.data.delete(); this.model.delete(); }
}
