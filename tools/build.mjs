import {build} from 'esbuild';
import {mkdir, copyFile, readFile, writeFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const copies = [
  ['node_modules/@mujoco/mujoco', 'sim/vendor/mujoco', ['mujoco.js', 'mujoco.wasm']],
  ['node_modules/onnxruntime-web/dist', 'sim/vendor/ort', ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']],
];
for (const [from, to, files] of copies) {
  await mkdir(to, {recursive: true});
  for (const file of files) await copyFile(`${from}/${file}`, `${to}/${file}`);
}
await build({entryPoints: ['sim/main.js', 'sim/worker.js'], outdir: 'sim/dist', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  external: ['../vendor/*'], legalComments: 'linked'});
const licenses = [];
for (const name of ['@mujoco/mujoco', 'onnxruntime-web', 'three']) {
  const directory = `node_modules/${name}`;
  const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  const license = (await readdir(directory)).find(file => /^licen[sc]e(?:\.|$)/i.test(file));
  const bundledLicense = {'@mujoco/mujoco': 'tools/LICENSE.mujoco.txt', 'onnxruntime-web': 'tools/LICENSE.onnxruntime.txt'}[name];
  const licenseText = await readFile(license ? `${directory}/${license}` : bundledLicense, 'utf8');
  licenses.push(`${name} ${pkg.version} (${pkg.license})\n${licenseText}\n`);
}
await writeFile('sim/vendor/THIRD_PARTY_LICENSES.txt', licenses.join('\n---\n\n'));
console.log('Built self-contained sim/dist and sim/vendor assets.');
