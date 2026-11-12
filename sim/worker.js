import {Simulation} from './physics.js';
import {validateScales} from './core.js';

let simulation, session, ort, running = false, generation = 0, pumping = false;
let rateStart = 0, simStart = 0;
const send = message => self.postMessage(message);
const assetBase = new URL('../assets/', import.meta.url);

async function fetchChecked(url, binary = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${new URL(url).pathname} (${response.status}).`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
}

async function initialize() {
  send({type: 'loading', message: 'Loading physics and inference engines…'});
  const [{default: loadMujoco}, runtime, config] = await Promise.all([
    import('../vendor/mujoco/mujoco.js'), import('../vendor/ort/ort.wasm.min.mjs'),
    fetchChecked(new URL('config.json', assetBase)),
  ]);
  ort = runtime;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
  const mj = await loadMujoco({locateFile: name => new URL(`../vendor/mujoco/${name}`, import.meta.url).href});
  send({type: 'loading', message: 'Loading the G1 robot and Soft-Walker policy…'});
  const [modelBytes, ...files] = await Promise.all([
    fetchChecked(new URL(config.model, assetBase), true),
    ...config.scene_files.map(name => fetchChecked(new URL(name, assetBase), true)),
  ]);
  mj.FS.mkdirTree('/scene/g1/meshes');
  config.scene_files.forEach((name, i) => mj.FS.writeFile('/scene/' + name, files[i]));
  const model = mj.MjModel.mj_loadXML('/scene/' + config.scene);
  if (!model) throw new Error('Could not compile the G1 physics scene.');
  simulation = new Simulation(mj, model, config);
  session = await ort.InferenceSession.create(modelBytes, {executionProviders: ['wasm']});
  if (session.inputNames.length !== 1 || session.inputNames[0] !== 'student_history' ||
      session.outputNames.length !== 2 || !['nominal_actions', 'compliance_offsets'].every(n => session.outputNames.includes(n))) {
    throw new Error('The policy does not have the required Soft-Walker dual-output interface.');
  }
  send({type: 'ready', geometry: simulation.geometry(), state: simulation.snapshot()});
}

function publish() {
  if (!simulation) return;
  const elapsed = (performance.now() - rateStart) / 1000;
  send({type: 'state', state: simulation.snapshot(), running,
    rate: running && elapsed > 0 ? (simulation.data.time - simStart) / elapsed : 0});
}

function stop() {
  running = false;
  generation++;
  simulation?.clearInput();
  publish();
}

function resume() {
  if (!session || running) return;
  running = true;
  rateStart = performance.now();
  simStart = simulation.data.time;
  publish();
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  let nextTick = performance.now();
  try {
    while (running) {
      const epoch = generation;
      const observation = simulation.observation();
      const input = new ort.Tensor('float32', observation, [1, 2450]);
      let output;
      try {
        output = await session.run({student_history: input});
        if (epoch !== generation || !running) continue;
        const nominal = output.nominal_actions, offsets = output.compliance_offsets;
        if (nominal.type !== 'float32' || offsets.type !== 'float32' ||
            nominal.dims.join(',') !== '1,29' || offsets.dims.join(',') !== '1,15') throw new Error('Invalid policy output dimensions or type.');
        simulation.advance(nominal.data, offsets.data);
        publish();
      } finally {
        input.dispose();
        if (output) for (const tensor of Object.values(output)) tensor.dispose();
      }
      nextTick += 20;
      // Never skip physics/control steps or accumulate a long catch-up queue.
      const now = performance.now();
      if (nextTick < now - 20) nextTick = now;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, nextTick - now)));
    }
  } catch (error) { fail(error); }
  finally { pumping = false; }
}

function fail(error) {
  stop();
  send({type: 'error', message: error?.message || String(error), recoverable: Boolean(session && simulation)});
}

let initializing = false;
self.onmessage = async ({data: message}) => {
  try {
    if (message.type === 'init') {
      if (initializing || simulation) return;
      initializing = true;
      await initialize();
      // Main thread starts only if the page is still visible after loading.
      return;
    }
    if (!simulation || !session) return;
    switch (message.type) {
      case 'command': if (running) simulation.setCommand(message.command); break;
      case 'drag': if (running) simulation.setDrag(message.drag); break;
      case 'clear': simulation.clearInput(); publish(); break;
      case 'pause': stop(); break;
      case 'resume': resume(); break;
      case 'reset':
        validateScales(message.alpha, message.beta);
        stop();
        simulation.reset(message.alpha, message.beta);
        publish();
        if (message.run) resume();
        break;
    }
  } catch (error) { fail(error); }
};
