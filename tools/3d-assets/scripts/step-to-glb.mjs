// Build-time STEP -> GLB conversion. Reads CAD data only (never executes it).
// Usage: node scripts/step-to-glb.mjs <input.step> <output.glb> [--name <asset name>] [--recenter]
// --recenter moves the root node (not the vertices) so the bbox is centred on X/Y with its lowest point at Z=0.
// Units stay in millimetres (same as the enclosure STL files). No scaling or re-orientation is applied.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import occtimportjs from "occt-import-js";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, weld, quantize } from "@gltf-transform/functions";

// Positions/bbox below are measured BEFORE quantization (exact source values).
const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: step-to-glb.mjs <input.step> <output.glb> [--name <name>]");
  process.exit(2);
}
const recenter = rest.includes("--recenter");
const nameIdx = rest.indexOf("--name");
const assetName = nameIdx >= 0 ? rest[nameIdx + 1] : output.replace(/^.*[\\/]/, "").replace(/\.glb$/i, "");

const occt = await occtimportjs();
const result = occt.ReadStepFile(new Uint8Array(readFileSync(input)), {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.0005,
  angularDeflection: 0.3,
});
if (!result.success || !result.meshes?.length) {
  console.error(`conversion failed for ${input}: success=${result.success} meshes=${result.meshes?.length ?? 0}`);
  process.exit(1);
}

const doc = new Document();
doc.createBuffer();
const scene = doc.createScene(assetName);
const root = doc.createNode(assetName);
scene.addChild(root);

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
let triangles = 0;
const materialByKey = new Map();
const report = [];

result.meshes.forEach((m, i) => {
  const pos = new Float32Array(m.attributes.position.array);
  const idx = new Uint32Array(m.index.array);
  for (let v = 0; v < pos.length; v += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], pos[v + a]);
      max[a] = Math.max(max[a], pos[v + a]);
    }
  }
  triangles += idx.length / 3;

  const color = m.color ?? [0.6, 0.6, 0.6];
  const key = color.map((c) => c.toFixed(3)).join(",");
  let mat = materialByKey.get(key);
  if (!mat) {
    mat = doc
      .createMaterial(`mat_${materialByKey.size}`)
      .setBaseColorFactor([color[0], color[1], color[2], 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.6);
    materialByKey.set(key, mat);
  }

  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx))
    .setMaterial(mat);
  if (m.attributes.normal) {
    prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(m.attributes.normal.array)));
  }
  const mesh = doc.createMesh(m.name || `part_${i}`).addPrimitive(prim);
  root.addChild(doc.createNode(m.name || `part_${i}`).setMesh(mesh));
  report.push({ name: m.name || `part_${i}`, triangles: idx.length / 3, color: key });
});

if (recenter) root.setTranslation([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]]);
// weld merges identical vertices (OCCT emits per-face vertices); quantize stores positions as int16 (KHR_mesh_quantization).
await doc.transform(weld(), quantize(), dedup(), prune());
mkdirSync(dirname(output), { recursive: true });
const glb = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
writeFileSync(output, glb);

const size = max.map((v, a) => +(v - min[a]).toFixed(3));
console.log(
  JSON.stringify(
    {
      input,
      output,
      inputBytes: statSync(input).size,
      outputBytes: statSync(output).size,
      meshes: result.meshes.length,
      triangles,
      materials: materialByKey.size,
      units: "mm (unscaled, source axes)",
      rootTranslation: root.getTranslation(),
      bboxMin: min.map((v) => +v.toFixed(3)),
      bboxMax: max.map((v) => +v.toFixed(3)),
      sizeXYZ: size,
    },
    null,
    1,
  ),
);
