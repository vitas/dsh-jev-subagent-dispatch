/**
 * Host schema contract: the two settings models.
 *
 * The regression this file locks is the DSH 0.1.7 one: a row's `Config` must be
 * exported with every field volatile (or the settings service drops the row
 * from `describe`), and the Loader hands each volatile field to `apply` as a
 * live accessor — read as a scalar it looks absent, so the plugin silently
 * falls back to its constants.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Config, readConfig, readField } from "../src/host/index.js";
import { apply } from "../index.mjs";
import { resolveConfig } from "../config.mjs";

/** Wrap a value the way the 0.1.7 Loader hands a volatile field over. */
function accessor(value) {
  return { get: () => value, set: () => {} };
}

/** Every field the exported Config declares, read from its JSON projection. */
function configFields() {
  const json = Config.toJSON();
  const root = json.refs[json.uid];
  return Object.entries(root.dict).map(([name, uid]) => [name, json.refs[uid]]);
}

test("schema: the exported Config marks every field volatile", { skip: Config === undefined }, () => {
  assert.ok(Config, "schemastery resolved and Config was built");
  const fields = configFields();
  assert.ok(fields.length > 10, "the row schema declares its full field set");
  const plain = fields.filter(([, node]) => node.meta?.volatile !== true).map(([name]) => name);
  assert.deepEqual(plain, [], "every Config field must be volatile for 0.1.7 to serve the row");
});

test("schema: readConfig unwraps live accessors and leaves plain values alone", () => {
  assert.equal(readField(accessor("auto")), "auto");
  assert.equal(readField("auto"), "auto");
  assert.equal(readField(undefined), undefined);
  const live = { mode: accessor("auto"), timeoutMs: accessor(5000), triggers: accessor(["/route"]) };
  assert.deepEqual(readConfig(live), { mode: "auto", timeoutMs: 5000, triggers: ["/route"] });
  assert.deepEqual(readConfig(undefined), {});
});

test("schema: an accessor-resolved config passes the router's validation", () => {
  const resolved = resolveConfig(readConfig({
    mode: accessor("auto"),
    provider: accessor("bai"),
    mock: accessor(true),
    stateChars: accessor(2000),
  }));
  assert.equal(resolved.mode, "auto");
  assert.equal(resolved.provider, "bai");
  assert.equal(resolved.apiKeyEnv, "OPENROUTER_API_KEY", "the preset for bai applies");
  assert.equal(resolved.stateChars, 2000);
});

/**
 * A 0.1.7-shaped host: the settings service exists but has no
 * `installSection`, so the row's Config (not the bridge) is the section.
 */
function accessorContext(services = {}) {
  const calls = [];
  return {
    calls,
    get: (name) => services[name],
    on(event, handler, options) {
      calls.push({ event, handler, options });
    },
    inject(_services, handler) {
      handler({ settings: {} });
    },
    effect() {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
}

const capable = {
  tools: { get: (name) => (name === "subagent" || name === "subagent_fork" ? { name } : undefined) },
  subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 8 },
  sessionProjections: { stateOf: () => undefined },
};

test("schema: a 0.1.7 accessor config reaches the live listener, and edits follow", async () => {
  const ctx = accessorContext(capable);
  const additions = [];
  // The live row config as 0.1.7 delivers it: accessors, not values.
  const live = {
    mode: accessor("once"),
    mock: accessor(true),
    provider: accessor("bai"),
    skipSubagentSessions: accessor(true),
  };
  await apply(ctx, live, {
    services: capable,
    pluginMessage: async (text) => {
      additions.push(text);
      return { role: "user", content: [{ type: "text", text }] };
    },
  });
  assert.equal(ctx.calls.length, 1, "one pre-step listener registered");
  const listener = ctx.calls[0].handler;
  const decision = {
    kind: "enter",
    messages: [{ role: "user", content: [{ type: "text", text: "/route rename every config key" }] }],
  };
  const next = async () => decision;

  // The configured mode/values were READ (not the `{}` an unwrapped accessor
  // would look like), so this turn classifies and injects.
  const routed = await listener({ agent: { session: {}, cwd: "/w" }, messages: decision.messages, signal: null }, next);
  assert.notEqual(routed, decision, "the accessor-resolved mode classified the turn");
  assert.equal(additions.length, 1);
  assert.match(additions[0], /subagent/i);

  // A live edit commits into the same accessor — no re-apply, next turn sees it.
  live.mode = accessor("off");
  const quiet = await listener({ agent: { session: {}, cwd: "/w" }, messages: decision.messages, signal: null }, next);
  assert.equal(quiet, decision, "mode off passes the turn through untouched");
  assert.equal(additions.length, 1);
});
