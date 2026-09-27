/**
 * Minimal lint: syntax-check every .mjs source with `node --check`.
 * A heavier eslint setup can replace this once the plugin gains
 * devDependencies; this keeps the package dependency-free while still
 * catching syntax slips that unit tests might not reach.
 */
import { readdir, readFile } from "node:fs/promises";
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

// Unused-import pass: a cheap, dependency-free heuristic. Every named or
// default import binding must appear at least once outside its own import
// statement. JSDoc mentions count as uses, so this under-reports rather than
// false-positives — it exists to catch imports left behind by a refactor.
for (const file of files) {
  const src = await readFile(file, "utf8");
  const importRe = /import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))?\s*from\s*["'][^"']+["']/g;
  for (const match of src.matchAll(importRe)) {
    const [, defaultName, namedBlock, namespaceName, bareDefault] = match;
    const names = [defaultName, namespaceName, bareDefault].filter(Boolean);
    for (const part of (namedBlock ?? "").split(",")) {
      const binding = part.split(/\s+as\s+/).pop()?.trim() ?? "";
      if (/^[\w$]+$/.test(binding)) names.push(binding);
    }
    for (const name of names) {
      const outside = src.replace(match[0], " ");
      if (!(new RegExp(`\\b${name}\\b`)).test(outside)) {
        failed = true;
        console.error(`FAIL ${relative(root, file)}: unused import "${name}"`);
      }
    }
  }
}

process.exitCode = failed ? 1 : 0;
