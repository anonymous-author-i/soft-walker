"""Generate deterministic conformance data with the original Python controller."""
from dataclasses import replace
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
import onnxruntime as ort

PAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PAGE.parent / "g1-dep"))
from apps.g1.soft_walker.config_interface import ConfigInterface
from apps.g1.soft_walker.policy import SoftWalkerPolicy

config = ConfigInterface.from_yaml()
options = ort.SessionOptions()
options.intra_op_num_threads = 1
session = ort.InferenceSession(config.onnx_path, options, providers=["CPUExecutionProvider"])

class Recorder:
    def __getattr__(self, name):
        return getattr(session, name)

    def run(self, names, feeds):
        self.observation = feeds["student_history"].copy()
        self.output = session.run(names, feeds)
        return self.output

reference = {"source": "g1-dep SoftWalkerPolicy / ONNX Runtime CPU", "cases": []}
fields = ("joint_names", "default_joint_qpos", "joint_kp", "joint_kd", "action_scale",
          "compliance_joint_names", "compliance_max_offset", "compliance_max_velocity",
          "safe_joint_limits", "alpha", "beta")
for alpha, beta in [(0.5, 1.0), (0.5, 0.5), (2.0, 2.0)]:
    c = replace(config, alpha=alpha, beta=beta)
    recorder = Recorder()
    policy = SoftWalkerPolicy(c, session=recorder)
    case = {"config": {key: (getattr(c, key).tolist() if hasattr(getattr(c, key), "tolist") else getattr(c, key)) for key in fields}, "steps": []}
    rng = np.random.default_rng(20261112)
    for step in range(34):
        if step == 32:
            policy.reset()
        quaternion = np.r_[1.0, rng.normal(0, .03, 3)].astype(np.float32)
        state = SimpleNamespace(root_quat=quaternion, root_gyro=rng.normal(0, .15, 3).astype(np.float32),
            joint_qpos=(c.default_joint_qpos + rng.normal(0, .025, 29)).astype(np.float32),
            joint_qvel=rng.normal(0, .1, 29).astype(np.float32))
        command = [0.6 if step < 20 else 0, 0.5 if 8 < step < 15 else 0, 0.5 if step > 24 else 0]
        remote = SimpleNamespace(get_command=lambda: SimpleNamespace(vel_lin_x=command[0], vel_lin_y=command[1], vel_ang_yaw=command[2]))
        targets = policy.infer(remote, state)
        item = {"reset": step == 32, "state": {"quaternion": state.root_quat.tolist(), "gyro": state.root_gyro.tolist(),
                "positions": state.joint_qpos.tolist(), "velocities": state.joint_qvel.tolist()}, "command": command,
                "nominal": recorder.output[0][0].tolist(), "offsets": recorder.output[1][0].tolist(), "targets": targets.tolist()}
        if step in [0, 1, 24, 25, 31, 32, 33]:
            item["observation"] = recorder.observation[0].tolist()
        case["steps"].append(item)
    reference["cases"].append(case)
destination = PAGE / "tests/fixtures/python-reference.json"
destination.parent.mkdir(exist_ok=True, parents=True)
destination.write_text(json.dumps(reference, separators=(',', ':')) + '\n')
print(f"Saved {sum(len(c['steps']) for c in reference['cases'])} reference control steps to {destination.relative_to(PAGE)}")
