"""Validate deployment inputs and prepare a self-contained browser demo.

Run with g1-dep's Python environment. No robot/SDK connection is opened.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET

PAGE = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--deployment", type=Path, default=PAGE.parent / "g1-dep")
args = parser.parse_args()
deployment = args.deployment.resolve()
sys.path.insert(0, str(deployment))

from apps.g1.soft_walker.config_interface import ConfigInterface
from apps.g1.soft_walker.policy import SoftWalkerPolicy
import onnxruntime as ort

config = ConfigInterface.from_yaml(deployment / "apps/g1/soft_walker/config.yaml")
options = ort.SessionOptions()
options.intra_op_num_threads = 1
session = ort.InferenceSession(config.onnx_path, options, providers=["CPUExecutionProvider"])
policy = SoftWalkerPolicy(config, session=session)  # validates full v3 metadata
destination = PAGE / "sim/assets"
destination.mkdir(parents=True, exist_ok=True)
model = Path(config.onnx_path)
shutil.copyfile(model, destination / "policy_ampdual.onnx")

robot = deployment / "simulator/robots/g1"
files = ["scene_29dof.xml", "g1_29dof.xml"]
tree = ET.parse(robot / "g1_29dof.xml")
files += sorted({"meshes/" + mesh.attrib["file"] for mesh in tree.findall(".//mesh") if "file" in mesh.attrib})
for name in files:
    target = destination / "g1" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(robot / name, target)

fields = ("joint_names", "default_joint_qpos", "joint_kp", "joint_kd", "action_scale",
          "compliance_joint_names", "compliance_max_offset", "compliance_max_velocity",
          "safe_joint_limits", "alpha", "beta")
data = {}
for key in fields:
    value = getattr(config, key)
    data[key] = value.tolist() if hasattr(value, "tolist") else value
data.update({"policy_abi": "g1_var_compliance_v3", "control_dt": 0.02,
             "physics_dt": 0.005, "initial_height": 0.76,
             "model": "policy_ampdual.onnx", "scene": "g1/scene_29dof.xml",
             "scene_files": ["g1/" + name for name in files],
             "model_sha256": hashlib.sha256(model.read_bytes()).hexdigest()})
(destination / "config.json").write_text(json.dumps(data, indent=2) + "\n")
print(f"Validated v3 policy; prepared {len(files)} scene files and {model.stat().st_size:,} model bytes.")
