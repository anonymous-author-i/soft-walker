# Soft-Walker

Project website for **Soft-Walker: Proprioceptive Force-Guided Humanoid Locomotion via Compliance Interaction Latents**.

[Project page](https://anonymous-author-i.github.io/soft-walker/)

Soft-Walker coordinates local upper-body yielding and whole-body motion through a shared interaction latent. The deployed controller uses proprioceptive histories and user commands, with separate controls for local compliance and base following.

## Live browser demo

The **Try Soft-Walker** section embeds `sim/index.html`. It runs the actual G1
`policy_ampdual.onnx` using ONNX Runtime Web and MuJoCo 3.8.0 WebAssembly. Physics
and policy inference run in one dedicated worker; Three.js renders the original
G1 visual meshes on the main thread. No simulation backend, CDN, WebGPU, special
cross-origin isolation headers, or robot connection is needed.

Serve this directory over HTTP (opening `index.html` as a `file://` URL does not
support the worker/model fetches):

```bash
cd project_page
python3 tools/serve.py
```

Open `http://127.0.0.1:8000/` for the project page or
`http://127.0.0.1:8000/sim/` for the standalone demo. The preview server also
supports `/soft-walker/` to check GitHub Pages subdirectory deployment.
The complete generated assets are included, so previewing requires only Python.

### Controls

Click **Start simulation**, then click the scene to focus the keyboard.

| Input | Behavior |
| --- | --- |
| W / S | Forward 0.6 / backward 0.4 m/s |
| A / D | Left / right lateral motion, 0.5 m/s |
| Q / E | Left / right yaw, 0.5 rad/s |
| Left drag on torso, shoulder, arm or hand | Pull at the selected point, at most 40 N total |
| Drag background / mouse wheel | Orbit / zoom |
| Pause / Resume | Stop / continue physics |
| Reset | Clear physics, observation histories, commands and forces |
| Apply & Reset | Apply both slider values and restart |

Commands use the robot's frame. Opposite keys cancel; releasing a key clears
its command. Losing focus clears inputs. A hidden page or offscreen embedded
demo pauses and requires Resume. Force is a 100 N/m virtual spring with a
40 N vector-norm cap applied **inside the physics worker**, with the correct
torque about the selected body's center of mass. Only torso descendants are
selectable. The camera stays still during a pull.

Upper-body α and base β each range from 0.5 to 2.0 in 0.05 increments. Smaller
values are softer. Initial values are α=0.5, β=1.0; slider changes take effect
only with Apply & Reset. Reset alone preserves the active multipliers.

### Rebuild JavaScript and bundled runtimes

Requires Node.js 18+ and npm. Dependency versions are pinned in `package-lock.json`.

```bash
npm ci
npm run build
```

`sim/dist/`, `sim/vendor/`, and `sim/assets/` are intentional deployment artifacts.
Include them when publishing the existing static page, together with the normal
HTML/CSS files and `.nojekyll`. All runtime paths are relative; the same files
work at `/` and `/soft-walker/`. The initial demo download is approximately
46 MB uncompressed and starts only when the visitor clicks Start.

### Refresh model and robot assets

The source deployment repository is expected beside this directory. Use its
Python environment, which provides NumPy, ONNX Runtime and PyYAML:

```bash
PYTHONDONTWRITEBYTECODE=1 ../g1-dep/.venv/bin/python tools/prepare_sim.py
# An alternate deployment checkout can be provided with --deployment PATH.
```

The script validates the complete v3 model contract with the original
`SoftWalkerPolicy`, copies the configured ONNX and only the scene's referenced
meshes, and exports the deployment parameters to `sim/assets/config.json`.
It records the model SHA-256 for provenance without changing the original model.
The source is `g1-dep/checkpoints/g1_soft_walker/policy_ampdual.onnx` and the scene
is `g1-dep/simulator/robots/g1/scene_29dof.xml`.

Control uses 25 frames in term-major order, 2450 float32 input values, named
29/15-dimensional outputs, and the original compliance projection order. Physics
advances at 0.005 s; the policy runs once per four steps (50 Hz simulated time).
Slow devices show the actual real-time factor without changing the physics step.
Falls or invalid outputs stop execution and require Reset.

### Validation

```bash
npm test
# Regenerate Python reference fixtures only when the source model/config changes:
PYTHONDONTWRITEBYTECODE=1 ../g1-dep/.venv/bin/python tools/generate_reference.py

# The Chrome test defaults to /opt/google/chrome/chrome; override CHROME_BIN if needed.
npm run test:browser -- --project=chrome
npx playwright install firefox
npm run test:browser -- --project=firefox
# Optional installed Microsoft Edge binary:
EDGE_BIN=/path/to/msedge npm run test:browser -- --project=edge
```

The numerical suite checks 102 Python-reference steps at `atol=rtol=1e-4`,
including history rollover, gravity, both ONNX outputs, compliance targets and
reset. The real WASM physics suite checks all six directions, combined walking,
40 N loading/release, all 25 multiplier pairs, and name-based joint reordering.
Browser tests cover keyboard focus, actual upper-body picking/dragging,
pause/reset, multiplier changes, root/subdirectory loading, missing assets,
unsupported graphics/WASM, offscreen pause, and the existing figure interactions.
`?test` enables read-only browser test diagnostics on the standalone demo.

Verified on 2026-11-12: all numerical/physics suites and all 18 browser checks
passed using Chrome 156.0.8078.47, Firefox 142.0.1, and Edge 157.0.4341.46.
Each browser completed a continuous 30-second simulation at approximately
1.00× real time on the development workstation. Rendering/performance on other
devices depends on their CPU and graphics support.

Primary implementation files are `sim/core.js` (policy math), `sim/physics.js`
(MuJoCo adapter), `sim/worker.js` (serial inference and lifecycle), and
`sim/main.js` (rendering and controls). Runtime licenses ship in
`sim/vendor/THIRD_PARTY_LICENSES.txt`.
