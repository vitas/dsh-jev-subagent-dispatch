/**
 * Minimal lint: syntax-check every .mjs source with `node --check`.
 * A heavier eslint setup can replace this once the plugin gains
 * devDependencies; this keeps the package dependency-free while still
 * catching syntax slips that unit tests might not reach.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import process from "node:process";

async function collect(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      await collect(path, files);
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(path);
    }
  }
  return files;
}

const root = new URL("..", import.meta.url).pathname;
const files = await collect(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  const label = relative(root, file);
  if (result.status === 0) {
    console.log(`ok   ${label}`);
  } else {
    failed = true;
    console.error(`FAIL ${label}\n${result.stderr}`);
  }
}
// Ensure no stray dependency slips into the runtime: the plugin must stay
// dependency-free (imports resolve from the host or node builtins only).
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
  failed = true;
  console.error("FAIL package.json carries runtime dependencies; dsh-jev-subagent-dispatch must stay dependency-free");
}
process.exitCode = failed ? 1 : 0;
