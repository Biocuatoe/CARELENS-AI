// Re-reads GLB files and reports triangles (counting instances), world-space bbox in mm and sanity checks.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { statSync } from "node:fs";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let bad = 0;
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let tris = 0, nodesWithMesh = 0, noIndex = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    nodesWithMesh++;
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      if (!idx) { noIndex++; continue; }
      tris += idx.getCount() / 3;
    }
  });
  const { min, max } = getBounds(scene);
  const size = max.map((v, i) => +(v - min[i]).toFixed(2));
  const finite = [...min, ...max].every(Number.isFinite);
  const ok = finite && tris > 0 && !noIndex;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "BAD "} ${f.split("/").pop().padEnd(34)} ${String(statSync(f).size).padStart(8)} B  meshNodes=${nodesWithMesh} uniqueMeshes=${root.listMeshes().length} tris=${tris} size=${size.join("x")} min=${min.map((v) => +v.toFixed(2)).join(",")}`,
  );
}
process.exit(bad ? 1 : 0);
