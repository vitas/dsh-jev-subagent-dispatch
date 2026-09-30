/**
 * Packaging test: the tarball npm publishes must be a LOADABLE package.
 * Checkout tests import from the source directory, so they cannot catch a
 * module missing from package.json `files` — this one unpacks what would
 * actually ship and imports it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;

test("packaging: the packed tarball ships every runtime module and loads", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-router-pack-"));
  try {
    await run("npm", ["pack", "--pack-destination", dir], { cwd: root });
    const tarball = (await readdir(dir)).find((name) => name.endsWith(".tgz"));
    assert.ok(tarball, "npm pack produced a tarball");

    // The release-blocker regression: every runtime module must ship.
    const listing = await run("tar", ["-tzf", join(dir, tarball)]);
    const files = new Set(listing.stdout.split("\n"));
    for (const required of [
      "package/index.mjs",
      "package/config.mjs",
      "package/capabilities.mjs",
      "package/jev.mjs",
      "package/verdict.mjs",
      "package/src/shared/config.mjs",
      "package/src/host/index.js",
      "package/lib/client.js",
      "package/cordis.patch.yml",
    ]) {
      assert.ok(files.has(required), `${required} must be in the tarball`);
    }

    // A packaged install must LOAD, not just list correctly.
    const unpacked = join(dir, "unpacked");
    await execFilePromised("mkdir", ["-p", unpacked]);
    await execFilePromised("tar", ["-xzf", join(dir, tarball), "-C", unpacked]);
    const packed = await import(pathToFileURL(join(unpacked, "package", "index.mjs")).href);
    assert.equal(typeof packed.apply, "function");
    // The Loader unwraps a default export and would then lose the namespace's
    // `Config`/`name`/`inject`; the named exports are the contract.
    assert.equal(packed.default, undefined, "no default export: the Loader would drop Config");
    assert.ok("Config" in packed, "the Config export is part of the plugin surface");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function execFilePromised(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
