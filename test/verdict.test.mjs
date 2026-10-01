/**
 * Unit tests for dsh-jev-subagent-dispatch: the TypeSafe wire contract, config
 * resolution, verdict logic (including score boundary cases), redaction,
 * and the host integration path with a fake context.
 *
 * Run: node --test test/
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { criteriaLevelNames, defaults, PROVIDER_PRESETS, resolveConfig, validate } from "../config.mjs";
import { buildRequestBody, buildRequestUrl, normalizeAnswers, resolveApiKeyFrom } from "../jev.mjs";
import { apply, loadMessageFactory, pluginMessage } from "../index.mjs";
import { checkDispatchCapabilities, delegationDepthOf, routeAdviceFor } from "../capabilities.mjs";
import {
  buildState,
  decide,
  findTrigger,
  isPlainUserMessage,
  messageText,
  predicateHolds,
  redact,
  renderVerdictMessage,
} from "../verdict.mjs";
import { classify } from "../jev.mjs";

const config = resolveConfig({ mode: "auto", mock: true });

/** A documented-shape System One response for the routing rubric. */
function documentedAnswers(overrides = {}) {
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 360, output_tokens: 39 },
    answers: {
      task_class: {
        type: "choice",
        choice: "mechanical",
        probabilities: { mechanical: 0.91, bugfix: 0.04, feature_work: 0.02, refactor: 0.01, research: 0.01, meta_chat: 0.01 },
        confidence: 0.94,
      },
      effort: { type: "score", score: 1.4, probabilities: [0.1, 0.35, 0.4, 0.15], confidence: 0.9 },
      blast_radius: { type: "score", score: 1, probabilities: [0.2, 0.6, 0.15, 0.04, 0.01], confidence: 0.88 },
      needs_repo_context: { type: "noul", noul: 0.05 },
      user_explicit: { type: "noul", noul: 0.02 },
      risky: { type: "noul", noul: 0.01 },
      ...overrides,
    },
  };
}

test("contract: request body matches the documented API shape", () => {
  const body = buildRequestBody(config, "workspace: /w\ntask:\nrename foo");
  assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"]);
  assert.equal(body.model, "jev-1.13.0");
  // The blocker regression: questions must be a MAP keyed by id, not an array.
  assert.equal(Array.isArray(body.questions), false);
  assert.deepEqual(Object.keys(body.questions).sort(), Object.keys(config.questions).sort());
  for (const [id, question] of Object.entries(body.questions)) {
    assert.ok(["choice", "score", "noul"].includes(question.type), `${id} type`);
    assert.ok(typeof question.instructions === "string" && question.instructions.length > 0, `${id} instructions`);
    if (question.type === "choice") {
      assert.equal(typeof question.criteria, "object");
      assert.equal(Array.isArray(question.criteria), false);
      assert.ok(Object.keys(question.criteria).length >= 2, `${id} choice criteria map`);
    }
    if (question.type === "score") {
      assert.ok(Array.isArray(question.criteria) && question.criteria.length >= 2 && question.criteria.length <= 10, `${id} score criteria array`);
    }
    if (question.type === "noul" && question.criteria !== undefined) {
      assert.ok(question.criteria.true !== undefined && question.criteria.false !== undefined, `${id} noul criteria`);
    }
  }
});

test("contract: normalize documented answer shapes (choice name, fractional score, noul)", () => {
  const normalized = normalizeAnswers(documentedAnswers(), config.questions);
  assert.equal(normalized.task_class.value, "mechanical");
  assert.equal(normalized.task_class.confidence, 0.94);
  assert.equal(normalized.effort.value, 1.4); // fractional: between M and L
  assert.equal(normalized.blast_radius.value, 1);
  assert.equal(normalized.needs_repo_context.value, 0.05);
});

test("contract: classify returns usage and response model", async () => {
  const verdict = await classify({ ...config, mock: true }, "rename foo everywhere");
  assert.equal(verdict.model, "mock");
  assert.ok(Number.isFinite(verdict.latencyMs));
});

test("mock: a review is its own class, and a preview is not a review", async () => {
  // The mock only wires tests, but its matching is still a WORD match: the
  // substring "preview" contains "review" and used to hijack a preview verdict
  // into the new class.
  const review = await classify({ ...config, mock: true }, "review the diff in stats.mjs");
  assert.equal(review.answers.task_class.value, "review");
  const second = await classify({ ...config, mock: true }, "give me a second opinion on this patch");
  assert.equal(second.answers.task_class.value, "review");
  const preview = await classify({ ...config, mock: true }, "preview architecture redesign request");
  assert.equal(preview.answers.task_class.value, "refactor", "preview must classify as the restructure it is");
});

test("providers: presets choose endpoint, api path, key env, and model", () => {
  const ts = resolveConfig({});
  assert.equal(ts.provider, "typesafe");
  assert.equal(ts.endpoint, "https://api.typesafe.ai");
  assert.equal(ts.apiPath, "/v1/systemone");
  assert.equal(ts.apiKeyEnv, "TYPESAFE_API_KEY");
  assert.equal(ts.model, "jev-1.13.0");

  const bai = resolveConfig({ provider: "bai" });
  assert.equal(bai.endpoint, "https://api.b.ai");
  assert.equal(bai.apiPath, "/v1/decisions");
  assert.equal(bai.apiKeyEnv, "OPENROUTER_API_KEY");
  assert.equal(bai.model, "jev-1.13.0");

  const or = resolveConfig({ provider: "openrouter" });
  assert.equal(or.endpoint, "https://openrouter.ai");
  assert.equal(or.apiPath, "/api/v1/systemone");
  assert.equal(or.model, "jev-1.13");
  assert.equal(or.apiKeyEnv, "OPENROUTER_API_KEY");
  assert.equal(Object.keys(PROVIDER_PRESETS).length, 3);
});

test("providers: explicit values override the preset, preset beats defaults", () => {
  const custom = resolveConfig({ provider: "bai", apiKeyEnv: "BAI_API_KEY", model: "jev-latest" });
  assert.equal(custom.apiKeyEnv, "BAI_API_KEY");
  assert.equal(custom.model, "jev-latest");
  assert.equal(custom.apiPath, "/v1/decisions"); // untouched preset field
  assert.throws(() => resolveConfig({ provider: "mystery" }), /provider must be one of/);
});

test("providers: request URL is built per provider", () => {
  assert.equal(buildRequestUrl(resolveConfig({ provider: "typesafe" })), "https://api.typesafe.ai/v1/systemone");
  assert.equal(buildRequestUrl(resolveConfig({ provider: "bai" })), "https://api.b.ai/v1/decisions");
  assert.equal(buildRequestUrl(resolveConfig({ provider: "openrouter" })), "https://openrouter.ai/api/v1/systemone");
  // An explicit endpoint override replaces the address; trailing slashes are
  // stripped and the preset's apiPath is appended.
  assert.equal(
    buildRequestUrl(resolveConfig({ endpoint: "https://proxy.internal/jev/" })),
    "https://proxy.internal/jev/v1/systemone",
  );
});

test("config: defaults resolve and validate", () => {
  const merged = resolveConfig({});
  assert.equal(merged.mode, "off"); // opt-in starting point
  assert.equal(merged.endpoint, "https://api.typesafe.ai");
  assert.equal(merged.logDir, null);
  assert.equal(merged.logTurnText, false);
  assert.equal(merged.stateChars, 1200);
  assert.deepEqual(merged.triggers, ["/route", "/jev"]);
  assert.ok(Object.keys(merged.questions).length >= 6);
});

test("config: questions merge per id — one override keeps the rest", () => {
  const merged = resolveConfig({
    questions: { effort: { type: "score", instructions: "custom", criteria: ["tiny", "huge"] } },
  });
  assert.equal(merged.questions.effort.criteria.length, 2);
  assert.equal(merged.questions.blast_radius.criteria.length, 5);
  assert.equal(merged.questions.risky.type, "noul");
});

test("config: profiles deep-merge — a threshold tweak keeps the predicate", () => {
  const merged = resolveConfig({ profiles: { auto: { confidenceMin: 0.8 } } });
  assert.equal(merged.profiles.auto.confidenceMin, 0.8);
  assert.deepEqual(merged.profiles.auto.delegate.taskClass, ["mechanical", "bugfix", "research", "review"]);
});

test("config: broken shapes fail loudly", () => {
  assert.throws(() => validate({ ...defaults(), mode: "nope" }), /mode must be one of/);
  const choiceBad = defaults();
  choiceBad.questions.task_class.criteria = ["a", "b"]; // array, not map
  assert.throws(() => validate(choiceBad), /criteria map/);
  const scoreBad = defaults();
  scoreBad.questions.effort.criteria = ["only one"];
  assert.throws(() => validate(scoreBad), /2\.\.10/);
  const noulBad = defaults();
  noulBad.questions.risky.criteria = { true: "yes" };
  assert.throws(() => validate(noulBad), /\{ true, false \}/);
  const thresholdBad = defaults();
  thresholdBad.profiles.auto.delegate.effortMax = -1;
  assert.throws(() => validate(thresholdBad), /effortMax/);
});

test("verdict: messageText extracts text parts", () => {
  assert.equal(
    messageText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }),
    "a\nb",
  );
  assert.equal(messageText({ content: "plain" }), "plain");
});

test("verdict: plugin-injected messages are not plain user turns", () => {
  assert.equal(isPlainUserMessage({ role: "user", content: [] }), true);
  assert.equal(isPlainUserMessage({ role: "user", source: { kind: "plugin:jev-subagent-dispatch" }, content: [] }), false);
  assert.equal(isPlainUserMessage({ role: "assistant", content: [] }), false);
});

test("verdict: buildState caps, redacts, and ignores plugin turns", () => {
  const messages = [
    { role: "user", source: { kind: "plugin:jev-subagent-dispatch" }, content: [{ type: "text", text: "injected" }] },
    { role: "user", content: [{ type: "text", text: "rename foo with key sk-abc123def456ghij7890" }] },
  ];
  const state = buildState(messages, "/w", 2000);
  assert.match(state, /^rename foo/); // the task leads
  assert.match(state, /\nworkspace: \/w$/); // the path trails, bounded
  assert.doesNotMatch(state, /injected/);
  assert.doesNotMatch(state, /sk-abc123/);
  assert.match(state, /\[redacted\]/);
  const capped = buildState(messages, "/w", 20);
  assert.ok(capped.length <= 20);
  assert.match(capped, /^rename/); // even a tiny cap keeps the task head
  assert.equal(buildState([{ role: "assistant", content: [] }], "/w", 100), "");
});

test("redact: credential shapes never leave, ordinary text survives", () => {
  for (const secret of [
    "sk-proj-abcdefghij0123456789",
    "ghp_0123456789abcdefghij",
    "github_pat_0123456789_ABCDEFGHIJ",
    "AKIAIOSFODNN7EXAMPLE",
    "Bearer abcdefghij123456",
    "api_key = super-secret-value",
    "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw",
  ]) {
    assert.equal(redact(`prefix ${secret} suffix`), "prefix [redacted] suffix", secret);
  }
  const plain = "rename userId to accountId in /usr/local/lib/node_modules and run tests";
  assert.equal(redact(plain), plain);
  assert.equal(redact("token: hunter2 hello", ["hello"]), "[redacted] [redacted]");
  assert.doesNotThrow(() => redact("x", ["("])); // invalid user pattern is skipped
});

test("verdict: delegate predicate passes a mechanical turn and picks the role", () => {
  const normalized = normalizeAnswers(documentedAnswers(), config.questions);
  const decision = decide({ answers: normalized, model: "jev-1.13.0", usage: { input_tokens: 360 } }, config);
  assert.equal(decision.action, "delegate");
  assert.equal(decision.role, "junior");
  assert.deepEqual(decision.route, { provider: "openrouter", model: "qwen3.8-flash" });
  assert.deepEqual(decision.usage, { input_tokens: 360 });
});

test("verdict: score boundaries — exactly at the ceiling passes, above fails", () => {
  const atCeiling = normalizeAnswers(documentedAnswers({
    effort: { type: "score", score: 1.5, confidence: 0.9 },
    blast_radius: { type: "score", score: 1.5, confidence: 0.9 },
  }), config.questions);
  assert.equal(decide({ answers: atCeiling, model: "m" }, config).action, "delegate");
  const aboveCeiling = normalizeAnswers(documentedAnswers({
    effort: { type: "score", score: 1.51, confidence: 0.9 },
  }), config.questions);
  const decision = decide({ answers: aboveCeiling, model: "m" }, config);
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /effort 1\.51 > effortMax/);
});

test("verdict: high blast radius blocks delegation", () => {
  const answers = normalizeAnswers(documentedAnswers({
    blast_radius: { type: "score", score: 3, confidence: 0.9 },
  }), config.questions);
  const decision = decide({ answers, model: "m" }, config);
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /blast_radius/);
});

test("verdict: risky turn is never delegated", () => {
  const answers = normalizeAnswers(documentedAnswers({
    risky: { type: "noul", noul: 0.95 },
  }), config.questions);
  const decision = decide({ answers, model: "m" }, config);
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /risky/);
});

test("verdict: low confidence skips even when the predicate holds", () => {
  const answers = normalizeAnswers(documentedAnswers({
    task_class: { type: "choice", choice: "mechanical", confidence: 0.4 },
  }), config.questions);
  const decision = decide({ answers, model: "m" }, config);
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /confidence/);
});

test("verdict: careful profile refuses what auto accepts", () => {
  const answers = normalizeAnswers(documentedAnswers({
    effort: { type: "score", score: 1, confidence: 0.95 },
  }), config.questions);
  const auto = decide({ answers, model: "m" }, config);
  const careful = decide({ answers, model: "m" }, { ...config, activeProfile: "careful" });
  assert.equal(auto.action, "delegate");
  assert.equal(careful.action, "skip");
});

test("verdict: research routes to the researcher", () => {
  const answers = normalizeAnswers(documentedAnswers({
    task_class: { type: "choice", choice: "research", confidence: 0.9 },
  }), config.questions);
  const decision = decide({ answers, model: "m" }, config);
  assert.equal(decision.action, "delegate");
  assert.deepEqual(decision.route, { provider: "openrouter", model: "qwen3.8-flash" });
});

test("verdict: review routes to the reviewer, not to the implementer", () => {
  // The class is what this change is about. The route is a profile choice, and
  // the shipped one names no subscription: it is the same example gateway the
  // other roles ship on.
  const answers = normalizeAnswers(documentedAnswers({
    task_class: { type: "choice", choice: "review", confidence: 0.9 },
  }), config.questions);
  const decision = decide({ answers, model: "m" }, config);
  assert.equal(decision.action, "delegate");
  assert.equal(decision.role, "reviewer");
  assert.deepEqual(decision.route, { provider: "openrouter", model: "qwen3.8-flash" });
});

test("verdict: unknown choice name fails closed", () => {
  const answers = normalizeAnswers(documentedAnswers({
    task_class: { type: "choice", choice: "otherworldly", confidence: 0.95 },
  }), config.questions);
  assert.equal(decide({ answers, model: "m" }, config).action, "skip");
});

test("verdict: missing answers fail the predicate closed", () => {
  const check = predicateHolds(
    { task_class: { value: "mechanical", confidence: 0.9 } },
    config.profiles.auto.delegate,
    config.questions,
  );
  assert.equal(check.pass, false);
  assert.match(check.reason, /effort missing/);
});

test("verdict: rendered message is a recommendation naming the route", () => {
  const normalized = normalizeAnswers(documentedAnswers({ effort: { type: "score", score: 1, confidence: 0.9 } }), config.questions);
  const decision = decide({ answers: normalized, model: "jev-1.13.0" }, config);
  const text = renderVerdictMessage(decision, config);
  assert.match(text, /\[jev-subagent-dispatch\]/);
  assert.match(text, /recommendation/);
  assert.match(text, /role "junior" \u2192 provider openrouter, model qwen3\.8-flash/);
  assert.match(text, /M \(1\)/); // level label + numeric score
  assert.match(text, /subagent tool is unavailable/);
});

/** Minimal fake host context capturing the pre-step registration. */
function fakeContext(services = {}) {
  const calls = [];
  let gets = 0;
  /** The setSource callback the settings seam delivers edits through. */
  let settingsSource = null;
  const context = {
    calls,
    settingsSource,
    get name() {
      return "fake-context";
    },
    get(name) {
      gets += 1;
      return services[name];
    },
    get serviceGets() {
      return gets;
    },
    on(event, handler, options) {
      calls.push({ event, handler, options });
    },
    inject(services_, handler) {
      // Synchronous like the real cordis injector: run the handler now so
      // tests can reach the settings installer without awaiting a fiber.
      handler({ settings: { installSection(_ctx, _name, _schema, _base, hooks) {
        context.settingsSource = hooks.setSource;
      } } });
    },
    effect() {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  return context;
}

/** Host services in which dispatch is fully available (model selection ON). */
function capableServices() {
  return {
    tools: { get: (name) => (name === "subagent" || name === "subagent_fork" ? { name } : undefined) },
    subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 8 },
    sessionProjections: {
      stateOf: (session, key) => (key === "subagentModelSelectionPolicy"
        ? [{ provider: "openrouter", model: "deepseek-v4-flash" }, { provider: "openrouter", model: "qwen3.8-flash" }]
        : undefined),
    },
  };
}

function stepInput(text) {
  return {
    agent: { session: { id: "session-test" }, cwd: "/w" },
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    signal: { aborted: false },
  };
}

test("host: apply registers one prepended pre-step listener in every mode", async () => {
  const on = fakeContext();
  await apply(on, { mode: "auto", mock: true });
  assert.equal(on.calls.length, 1);
  assert.equal(on.calls[0].event, "agent/pre-step");
  assert.deepEqual(on.calls[0].options, { prepend: true });
  // `off` keeps the listener (so a UI mode change reaches the next turn
  // without a restart) but the first line of the body returns untouched —
  // verified by the zero-cost turn test below.
  const off = fakeContext();
  await apply(off, { mode: "off" });
  assert.equal(off.calls.length, 1);
  assert.equal(off.calls[0].event, "agent/pre-step");
});

test("host: a delegating verdict appends one source-attributed message", async () => {
  const ctx = fakeContext();
  apply(ctx, { mode: "auto", mock: true }, {
    services: capableServices(),
    pluginMessage: async (text) => ({
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "plugin:jev-subagent-dispatch", plugin: "jev-subagent-dispatch" },
    }),
  });
  const { handler } = ctx.calls[0];
  const input = stepInput("rename the config keys everywhere");
  const decision = { kind: "enter", messages: [...input.messages] };
  const result = await handler(input, async () => decision);
  assert.equal(result.kind, "enter");
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].source.kind, "plugin:jev-subagent-dispatch");
  assert.match(result.messages[1].content[0].text, /role "junior" \u2192 provider openrouter, model qwen3\.8-flash/);
});

test("host: a failing classification is fail-open (turn proceeds unrouted)", async () => {
  const ctx = fakeContext();
  apply(ctx, {
    mode: "auto",
    mock: false,
    apiKeyEnv: "JEV_ROUTER_TEST_MISSING_KEY",
  }, { pluginMessage: async () => ({ role: "user", content: [] }) });
  const { handler } = ctx.calls[0];
  const decision = { kind: "enter", messages: [...stepInput("rename foo").messages] };
  const result = await handler(stepInput("rename foo"), async () => decision);
  assert.deepEqual(result, decision);
  assert.equal(result.messages.length, 1);
});

test("host: subagent sessions and non-enter decisions are skipped", async () => {
  const ctx = fakeContext();
  apply(ctx, { mode: "auto", mock: true }, { services: capableServices(), pluginMessage: async () => ({ role: "user", content: [] }) });
  const { handler } = ctx.calls[0];
  const decision = { kind: "enter", messages: [...stepInput("rename foo everywhere").messages] };
  const subagent = await handler(
    { ...stepInput("rename foo everywhere"), agent: { session: { id: "s", header: { origin: "subagent" } } } },
    async () => decision,
  );
  assert.deepEqual(subagent, decision);
  const rejected = { kind: "reject", messages: [] };
  assert.deepEqual(await handler(stepInput("rename foo"), async () => rejected), rejected);
});

test("host: when the message factory is unavailable the injection is skipped", async () => {
  const ctx = fakeContext();
  apply(ctx, { mode: "auto", mock: true }, { services: capableServices(), pluginMessage: async () => null });
  const { handler } = ctx.calls[0];
  const decision = { kind: "enter", messages: [...stepInput("rename foo everywhere").messages] };
  const result = await handler(stepInput("rename foo everywhere"), async () => decision);
  assert.deepEqual(result, decision);
  assert.equal(result.messages.length, 1);
});

test("host: logging is opt-in, excludes turn text by default, and records usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-subagent-dispatch-test-"));
  try {
    const ctx = fakeContext();
    apply(ctx, { mode: "auto", mock: true, logDir: dir }, { services: capableServices(),
      pluginMessage: async () => null,
    });
    const { handler } = ctx.calls[0];
    const turn = "SECRET sk-abcdefghijklmnop1234 rename everywhere";
    await handler(stepInput(turn), async () => ({
      kind: "enter",
      messages: [...stepInput(turn).messages],
    }));
    const line = JSON.parse(await readFile(join(dir, "verdicts.ndjson"), "utf8"));
    assert.equal(line.turn, undefined); // logTurnText defaults to false
    assert.equal(line.action, "delegate");
    assert.equal(line.delivered, false); // factory unavailable → nothing was injected
    assert.match(line.id, /^[0-9a-f-]{36}$/); // ledger correlation id
    assert.equal(line.role, "junior");
    assert.ok("usage" in line);
    assert.ok(!JSON.stringify(line).includes("sk-abcdefghijklmnop"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("triggers: explicit requests are found, preview is flagged, other turns are untouched", () => {
  const once = resolveConfig({ mode: "once" });
  const plain = findTrigger([{ role: "user", content: [{ type: "text", text: "fix the failing tests" }] }], once);
  assert.equal(plain, null);
  const routed = findTrigger([{ role: "user", content: [{ type: "text", text: "/route fix the failing tests" }] }], once);
  assert.deepEqual({ ...routed, trigger: routed.trigger }, { action: "route", task: "fix the failing tests", trigger: "/route" });
  const preview = findTrigger([{ role: "user", content: [{ type: "text", text: "/JEV preview which specialist?" }] }], once);
  assert.equal(preview.action, "preview");
  assert.equal(preview.task, "which specialist?");
  assert.equal(preview.trigger, "/jev");
  const midSentence = findTrigger([{ role: "user", content: [{ type: "text", text: "please /route this" }] }], once);
  assert.equal(midSentence, null); // only leading triggers count
  const custom = resolveConfig({ mode: "once", triggers: ["/dispatch"] });
  assert.equal(findTrigger([{ role: "user", content: [{ type: "text", text: "/route x" }] }], custom), null);
  const named = findTrigger([{ role: "user", content: [{ type: "text", text: "/jev should I delegate this?" }] }], once);
  assert.equal(named.action, "route");
  assert.equal(named.task, "should I delegate this?");
});

test("triggers: explicit task leads the state ahead of the cap", () => {
  const once = resolveConfig({ mode: "once", stateChars: 200 });
  const state = buildState(
    [{ role: "user", content: [{ type: "text", text: "/route fix the failing tests in the parser" }] }],
    "/w", once.stateChars, [], "fix the failing tests in the parser",
  );
  assert.match(state, /^fix the failing tests in the parser/);
  assert.match(state, /\nworkspace: \/w$/);
});

test("host: mode once passes unmarked turns through with zero cost", async () => {
  const ctx = fakeContext();
  let factoryCalls = 0;
  apply(ctx, { mode: "once", mock: true }, {
    services: capableServices(),
    pluginMessage: async () => {
      factoryCalls += 1;
      return { role: "user", content: [] };
    },
  });
  const { handler } = ctx.calls[0];
  const decision = { kind: "enter", messages: [...stepInput("rename the config keys everywhere").messages] };
  const result = await handler(stepInput("rename the config keys everywhere"), async () => decision);
  assert.deepEqual(result, decision); // untouched
  assert.equal(factoryCalls, 0); // no injection attempted, no call made
});

test("host: mode once classifies an explicit /route request and injects", async () => {
  const ctx = fakeContext();
  apply(ctx, { mode: "once", mock: true }, {
    services: capableServices(),
    pluginMessage: async (text) => ({
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "plugin:jev-subagent-dispatch", plugin: "jev-subagent-dispatch" },
    }),
  });
  const { handler } = ctx.calls[0];
  const turn = stepInput("/route rename the config keys everywhere");
  const result = await handler(turn, async () => ({ kind: "enter", messages: [...turn.messages] }));
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[1].content[0].text, /Dispatch recommendation/);
  assert.match(result.messages[1].content[0].text, /role "junior" \u2192 provider openrouter, model qwen3\.8-flash/);
});

test("host: preview requests render evaluation-only advice", async () => {
  const ctx = fakeContext();
  apply(ctx, { mode: "once", mock: true }, {
    services: capableServices(),
    pluginMessage: async (text) => ({ role: "user", content: [{ type: "text", text }], source: { kind: "plugin:jev-subagent-dispatch" } }),
  });
  const { handler } = ctx.calls[0];
  const turn = stepInput("/route preview rename the config keys everywhere");
  const result = await handler(turn, async () => ({ kind: "enter", messages: [...turn.messages] }));
  const text = result.messages[1].content[0].text;
  assert.match(text, /PREVIEW/);
  assert.match(text, /Do not delegate based on it/);
  assert.doesNotMatch(text, /If you delegate/); // no delegation brief in preview
  assert.match(text, /noul:/); // full answers for evaluation
});

test("host: the verdict log records mode and trigger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-subagent-dispatch-mode-"));
  try {
    const ctx = fakeContext();
    apply(ctx, { mode: "once", mock: true, logDir: dir }, { services: capableServices(), pluginMessage: async () => null });
    const { handler } = ctx.calls[0];
    const turn = stepInput("/route rename the config keys everywhere");
    await handler(turn, async () => ({ kind: "enter", messages: [...turn.messages] }));
    const line = JSON.parse(await readFile(join(dir, "verdicts.ndjson"), "utf8"));
    assert.equal(line.mode, "once");
    assert.equal(line.trigger, "route");
    assert.equal(line.action, "delegate");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("capabilities: an agent with tool, provider, and depth can dispatch", () => {
  const agent = { session: { header: { delegationDepth: 1 } } };
  const check = checkDispatchCapabilities(capableServices(), agent);
  assert.equal(check.ok, true);
  assert.deepEqual(check.missing, []);
  assert.equal(check.toolName, "subagent");
  assert.equal(check.routePolicy, "named"); // model selection on, allowlist recorded
  assert.equal(delegationDepthOf(agent), 1);
  assert.equal(delegationDepthOf({ session: { header: {} } }), 0);
  assert.equal(delegationDepthOf({ session: { header: { delegationDepth: 2 } }, options: { subagentDepth: 3 } }), 3);
});

test("capabilities: every missing piece is named", () => {
  const absent = checkDispatchCapabilities({}, { session: {} });
  assert.equal(absent.ok, false);
  assert.match(absent.missing.join(" "), /no delegation tool is visible/);
  assert.match(absent.missing.join(" "), /subagent service is unavailable/);

  const noProvider = {
    tools: { get: (name) => (name === "subagent" ? { name } : undefined) },
    subagents: { getProvider: () => undefined, resolveMaxDepth: () => 8 },
  };
  const check = checkDispatchCapabilities(noProvider, { session: {} });
  assert.match(check.missing.join(" "), /provider "spawn" is unavailable/);
});

test("capabilities: depth accounting gates delegation", () => {
  const exhausted = {
    tools: { get: (name) => (name === "subagent" ? { name } : undefined) },
    subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 2 },
  };
  const atLimit = checkDispatchCapabilities(exhausted, { session: { header: { delegationDepth: 2 } } });
  assert.equal(atLimit.ok, false);
  assert.match(atLimit.missing.join(" "), /depth is exhausted .*depth 2, limit 2/);
  const withHeadroom = checkDispatchCapabilities(exhausted, { session: { header: { delegationDepth: 1 } } });
  assert.equal(withHeadroom.ok, true);
  // provider-managed depth (undefined) never exhausts locally
  const managed = { ...exhausted, subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => undefined } };
  assert.equal(checkDispatchCapabilities(managed, { session: { header: { delegationDepth: 9 } } }).ok, true);
});

test("capabilities: model-selection policy classifies the route advice", () => {
  const route = { provider: "openrouter", model: "deepseek-v4-flash" };
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }]), { kind: "named", route });
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "glm-5.3-flash" }]), { kind: "allowlist", route });
  assert.deepEqual(routeAdviceFor("fixed", route), { kind: "child-default" });
  assert.deepEqual(routeAdviceFor("unknown", route), { kind: "allowlist", route });

  const projections = { stateOf: (session, key) => (
    key === "subagentModelSelectionPolicy" ? [{ provider: "openrouter", model: "qwen3.8-flash" }] : undefined
  ) };
  const services = { ...capableServices(), sessionProjections: projections };
  assert.equal(checkDispatchCapabilities(services, { session: {} }).routePolicy, "named");
});

test("host: an explicit /route with no subagent setup gets a diagnostic, not a Jev call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-router-caps-"));
  try {
    const ctx = fakeContext(); // no services at all
    apply(ctx, { mode: "once", mock: true, logDir: dir }, {
      pluginMessage: async (text) => ({ role: "user", content: [{ type: "text", text }], source: { kind: "plugin:jev-subagent-dispatch" } }),
    });
    const { handler } = ctx.calls[0];
    const turn = stepInput("/route rename the config keys everywhere");
    const result = await handler(turn, async () => ({ kind: "enter", messages: [...turn.messages] }));
    assert.equal(result.messages.length, 2);
    const text = result.messages[1].content[0].text;
    assert.match(text, /Dispatch is unavailable/);
    assert.match(text, /no delegation tool is visible/);
    assert.match(text, /subagent service is unavailable/);
    // nothing was classified: the log records unavailability, not a verdict
    const line = JSON.parse(await readFile(join(dir, "verdicts.ndjson"), "utf8"));
    assert.equal(line.action, "unavailable");
    assert.equal(line.answers, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("host: ordinary turns stay silent when dispatch is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-router-silent-"));
  try {
    const ctx = fakeContext(); // no services at all
    let factoryCalls = 0;
    apply(ctx, { mode: "auto", mock: true, logDir: dir }, {
      pluginMessage: async () => {
        factoryCalls += 1;
        return { role: "user", content: [] };
      },
    });
    const { handler } = ctx.calls[0];
    const decision = { kind: "enter", messages: [...stepInput("rename the config keys everywhere").messages] };
    const result = await handler(stepInput("rename the config keys everywhere"), async () => decision);
    assert.deepEqual(result, decision);
    assert.equal(factoryCalls, 0); // no diagnostic, no Jev call
    await assert.rejects(readFile(join(dir, "verdicts.ndjson"), "utf8")); // nothing logged
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("host: services are re-resolved at request time, not boot time", async () => {
  const ctx = fakeContext(capableServices());
  apply(ctx, { mode: "auto", mock: true }, {
    pluginMessage: async () => ({ role: "user", content: [] }),
  });
  const { handler } = ctx.calls[0];
  const decision = { kind: "enter", messages: [...stepInput("rename foo everywhere").messages] };
  await handler(stepInput("rename foo everywhere"), async () => decision);
  await handler(stepInput("rename foo everywhere"), async () => decision);
  assert.ok(ctx.serviceGets >= 6); // three services, read again per request
});

test("triggers: a word boundary separates /route from /router", () => {
  const once = resolveConfig({ mode: "once" });
  assert.equal(findTrigger([{ role: "user", content: [{ type: "text", text: "/router fix the failing tests" }] }], once), null);
  assert.equal(findTrigger([{ role: "user", content: [{ type: "text", text: "/routes fix it" }] }], once), null);
  const bare = findTrigger([{ role: "user", content: [{ type: "text", text: "/route" }] }], once);
  assert.deepEqual({ ...bare, trigger: bare.trigger }, { action: "route", task: "", trigger: "/route" });
  const spaced = findTrigger([{ role: "user", content: [{ type: "text", text: "/ROUTE fix it" }] }], once);
  assert.equal(spaced?.action, "route");
});

test("verdict: skip decisions keep their answers for log and preview", () => {
  const normalized = normalizeAnswers(documentedAnswers(), config.questions);
  const tight = { ...config, profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, effortMax: 0.5 } } } };
  const decision = decide({ answers: normalized, model: "m" }, tight);
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /effort 1\.4 > effortMax/);
  assert.ok(decision.answers?.task_class, "skip must retain answers");
});

test("preview: a skipped verdict renders with its answers and no route advice", () => {
  const normalized = normalizeAnswers(documentedAnswers(), config.questions);
  const tight = { ...config, profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, effortMax: 0.5 } } } };
  const decision = decide({ answers: normalized, model: "m" }, tight);
  const text = renderVerdictMessage(decision, config, { preview: true });
  assert.match(text, /PREVIEW/);
  assert.match(text, /verdict: skip/);
  assert.match(text, /class: mechanical/);
  assert.doesNotMatch(text, /recommended route/);
  assert.doesNotMatch(text, /self-contained brief/);
});

test("host: a previewed miss injects the skip verdict, not silence", async () => {
  const ctx = fakeContext();
  apply(ctx, { mode: "once", mock: true, profiles: { auto: { delegate: { effortMax: 0.5 } } } }, {
    services: capableServices(),
    pluginMessage: async (text) => ({ role: "user", content: [{ type: "text", text }], source: { kind: "plugin:jev-subagent-dispatch" } }),
  });
  const { handler } = ctx.calls[0];
  const turn = stepInput("/route preview architecture redesign request");
  const result = await handler(turn, async () => ({ kind: "enter", messages: [...turn.messages] }));
  const text = result.messages[1].content[0].text;
  assert.match(text, /PREVIEW/);
  assert.match(text, /verdict: skip/);
  assert.match(text, /effort/);
});

test("advice: a fork-only setup never names a model", () => {
  const route = { provider: "openrouter", model: "deepseek-v4-flash" };
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], "subagent_fork", "fork"), { kind: "fork" });
  assert.deepEqual(routeAdviceFor("fixed", route, undefined, "subagent_fork", "fork"), { kind: "fork" });
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], "subagent", "spawn"), { kind: "named", route });

  const forkOnly = {
    tools: { get: (name) => (name === "subagent_fork" ? { name } : undefined) },
    subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 8 },
  };
  const check = checkDispatchCapabilities(forkOnly, { session: {} });
  assert.equal(check.ok, true);
  assert.equal(check.toolName, "subagent_fork");
  const decision = { action: "delegate", answers: { task_class: { value: "mechanical" } }, role: "implementer", confidence: 0.9, route };
  const text = renderVerdictMessage(decision, config, { routeAdvice: routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], check.toolName, "fork") });
  assert.match(text, /the fork inherits your model and context/);
  assert.doesNotMatch(text, /deepseek-v4-flash/);
});

test("host: a delivered recommendation logs delivered true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-router-delivered-"));
  try {
    const ctx = fakeContext();
    apply(ctx, { mode: "auto", mock: true, logDir: dir }, {
      services: capableServices(),
      pluginMessage: async (text) => ({ role: "user", content: [{ type: "text", text }], source: { kind: "plugin:jev-subagent-dispatch" } }),
    });
    const { handler } = ctx.calls[0];
    const turn = stepInput("rename the config keys everywhere");
    await handler(turn, async () => ({ kind: "enter", messages: [...turn.messages] }));
    const line = JSON.parse(await readFile(join(dir, "verdicts.ndjson"), "utf8"));
    assert.equal(line.action, "delegate");
    assert.equal(line.delivered, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("policy: per-level probability ceilings gate the tail risk", () => {
  const base = normalizeAnswers(documentedAnswers(), config.questions);
  const lowAverageHighTail = {
    ...base,
    blast_radius: {
      type: "score",
      value: 0,
      legend: ["trivial", "module", "public_api", "infra", "catastrophic"],
      probabilities: { trivial: 0.9, module: 0.08, public_api: 0.013, infra: 0.005, catastrophic: 0.002 },
      confidence: 0.9,
    },
  };
  const gated = (max) => ({
    ...config,
    profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, probabilityMax: { blast_radius: { infra: max } } } } },
  });
  const blocked = decide({ answers: lowAverageHighTail, model: "m" }, gated(0.002));
  assert.equal(blocked.action, "skip");
  assert.match(blocked.reason, /P\(infra\) 0\.01 > 0\.002/);
  assert.equal(decide({ answers: lowAverageHighTail, model: "m" }, gated(0.01)).action, "delegate");
  // fails closed when the model omits usable probabilities
  const noProbabilities = { ...lowAverageHighTail, blast_radius: { ...lowAverageHighTail.blast_radius, probabilities: undefined } };
  const blockedMissing = decide({ answers: noProbabilities, model: "m" }, gated(0.01));
  assert.equal(blockedMissing.action, "skip");
  assert.match(blockedMissing.reason, /probabilities missing/);
  assert.throws(() => resolveConfig({ profiles: { auto: { delegate: { probabilityMax: { blast_radius: { infra: 1.5 } } } } } }), /probabilityMax\.blast_radius\.infra/);
});

test("policy: score probabilities are normalized onto rubric names", () => {
  const normalized = normalizeAnswers(documentedAnswers(), config.questions);
  // documentedAnswers carries blast_radius probabilities as an ordered array;
  // the rubric names must key the normalized distribution.
  assert.deepEqual(
    Object.keys(normalized.blast_radius.probabilities),
    ["trivial", "module", "cross_module", "public_api", "infra"],
  );
  // Real responses may key positions by stringified indices ("4"); a FULL
  // positional map is translated. (An INCOMPLETE one is rejected — see the
  // risk-gate test below.)
  const positional = normalizeAnswers({
    answers: { ...documentedAnswers().answers, blast_radius: { type: "score", score: 1, probabilities: { "0": 0.5, "1": 0.5, "2": 0, "3": 0, "4": 0 }, confidence: 0.9 } },
  }, config.questions);
  assert.deepEqual(positional.blast_radius.probabilities, { trivial: 0.5, module: 0.5, cross_module: 0, public_api: 0, infra: 0 });
});

test("policy: probabilityMax speaks rubric names, not indices", () => {
  const base = normalizeAnswers(documentedAnswers(), config.questions);
  // infra is the last rubric level: array position 4 carried 0.01.
  const gated = (max) => ({
    ...config,
    profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, probabilityMax: { blast_radius: { infra: max } } } } },
  });
  assert.equal(decide({ answers: base, model: "m" }, gated(0.02)).action, "delegate");
  const blocked = decide({ answers: base, model: "m" }, gated(0.005));
  assert.equal(blocked.action, "skip");
  assert.match(blocked.reason, /P\(infra\) 0\.01 > 0\.005/);
  // numeric indices remain accepted as LEVEL names for operators reading
  // raw responses (index 4 = infra, ceiling 0.005)
  const byIndex = {
    ...config,
    profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, probabilityMax: { blast_radius: { "4": 0.005 } } } } },
  };
  assert.equal(decide({ answers: base, model: "m" }, byIndex).action, "skip");
});

test("policy: a tail limit sums a level and everything worse", () => {
  const base = normalizeAnswers(documentedAnswers(), config.questions);
  const gated = (max) => ({
    ...config,
    profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, probabilityMax: { blast_radius: { "public_api+": max } } } } },
  });
  // from public_api up: public_api 0.04 + infra 0.01 = 0.05 — the combined
  // tail that separate per-level caps could each let through
  const blocked = decide({ answers: base, model: "m" }, gated(0.04));
  assert.equal(blocked.action, "skip");
  assert.match(blocked.reason, /P\(public_api\+\) 0\.05 > 0\.04/);
  assert.equal(decide({ answers: base, model: "m" }, gated(0.05)).action, "delegate");
});

test("config: probabilityMax levels are validated against the rubric", () => {
  assert.throws(
    () => resolveConfig({ profiles: { auto: { delegate: { probabilityMax: { blast_radius: { catastrophic: 0.02 } } } } } }),
    /probabilityMax\.blast_radius\.catastrophic is not in the rubric \(trivial\|module\|cross_module\|public_api\|infra\)/,
  );
  assert.throws(
    () => resolveConfig({ profiles: { auto: { delegate: { probabilityMax: { needs_repo_context: { high: 0.1 } } } } } }),
    /names no configured score question/,
  );
  assert.doesNotThrow(() => resolveConfig({ profiles: { auto: { delegate: { probabilityMax: { blast_radius: { "public_api+": 0.2, infra: 0.05 } } } } } }));
});

test("verdict: the assembled state is redacted and capped as a whole", () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "rename foo" }] }];
  // a credential-shaped path must not leak through the prefix
  const leaked = buildState(messages, "/home/dev/sk-abcdefghijklmnop1234/repo", 2000);
  assert.doesNotMatch(leaked, /sk-abcdefghijklmnop/);
  assert.match(leaked, /\[redacted\]/);
  // a long path can no longer push the task text out: the cap covers the
  // assembled state, so the tail (not the task) is what gets truncated last
  const longPath = `/${"very-long-segment/".repeat(40)}`;
  const capped = buildState(messages, longPath, 120);
  assert.ok(capped.length <= 120);
  const full = buildState(messages, longPath, 4000);
  assert.match(full, /rename foo/);
});

test("preview: score distributions are rendered for tuning", () => {
  const normalized = normalizeAnswers(documentedAnswers(), config.questions);
  const decision = decide({ answers: normalized, model: "m" }, config);
  const text = renderVerdictMessage(decision, config, { preview: true });
  assert.match(text, /blast_radius distribution: trivial 0\.20, module 0\.60, cross_module 0\.15, public_api 0\.04, infra 0\.01/);
  assert.doesNotMatch(renderVerdictMessage(decision, config, { routeAdvice: { kind: "named", route: decision.route } }), /distribution:/);
  const tight = { ...config, profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, effortMax: 0.5 } } } };
  const skip = decide({ answers: normalized, model: "m" }, tight);
  assert.match(renderVerdictMessage(skip, config, { preview: true }), /effort distribution:/);
});

test("capabilities: configured custom tool names are probed too", () => {
  const custom = {
    tools: { get: (name) => (name === "delegate_task" ? { name } : undefined) },
    subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 8 },
  };
  // defaults only probe subagent/subagent_fork: a working custom setup looks unavailable
  assert.equal(checkDispatchCapabilities(custom, { session: {} }).ok, false);
  const check = checkDispatchCapabilities(custom, { session: {} }, [{ toolName: "delegate_task", provider: "spawn" }]);
  assert.equal(check.ok, true);
  assert.equal(check.toolName, "delegate_task");
  assert.throws(() => resolveConfig({ delegationTools: [{ toolName: "", provider: "spawn" }] }), /delegationTools/);
});

test("policy: an incomplete score distribution fails the risk gate closed", () => {
  // reproduced from review: response naming only the first level
  const incomplete = normalizeAnswers({
    answers: { ...documentedAnswers().answers, blast_radius: { type: "score", score: 0, probabilities: { trivial: 0.2 }, confidence: 0.9 } },
  }, config.questions);
  assert.equal(incomplete.blast_radius.probabilities, null, "partial object distribution is rejected");
  const gated = {
    ...config,
    profiles: { ...config.profiles, auto: { ...config.profiles.auto, delegate: { ...config.profiles.auto.delegate, probabilityMax: { blast_radius: { "public_api+": 0 } } } } },
  };
  const decision = decide({ answers: incomplete, model: "m" }, gated);
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /probabilities missing/);
  // the same shape passes when no risk gate is configured
  assert.equal(decide({ answers: incomplete, model: "m" }, config).action, "delegate");
});

test("verdict: the task text survives an unbounded workspace path", () => {
  const messages = [{ role: "user", content: [{ type: "text", text: "rename foo to bar" }] }];
  const longPath = "/" + "a".repeat(200);
  const state = buildState(messages, longPath, 100);
  assert.ok(state.startsWith("rename foo to bar"), "task leads the payload");
  assert.ok(state.length <= 100);
  assert.ok(state.includes("workspace:"), "path survives as bounded context");
  // normal case: both body and path present, body first
  const wide = buildState(messages, "/home/dev/project", 2000);
  assert.match(wide, /^rename foo to bar\nworkspace: \/home\/dev\/project$/);
});

test("advice: a custom-named fork tool is recognized by its provider", () => {
  const route = { provider: "openrouter", model: "deepseek-v4-flash" };
  // provider decides, not the tool name
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], "fork_worker", "fork"), { kind: "fork" });
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], "subagent", "spawn"), { kind: "named", route });

  const customFork = {
    tools: { get: (name) => (name === "fork_worker" ? { name } : undefined) },
    subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 8 },
  };
  const tools = [{ toolName: "fork_worker", provider: "fork" }];
  const check = checkDispatchCapabilities(customFork, { session: {} }, tools);
  assert.equal(check.ok, true);
  assert.equal(check.toolName, "fork_worker");
  const decision = { action: "delegate", answers: { task_class: { value: "mechanical" } }, role: "implementer", confidence: 0.9, route };
  const text = renderVerdictMessage(decision, config, { routeAdvice: routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], check.toolName, "fork") });
  assert.doesNotMatch(text, /deepseek-v4-flash/);
  assert.match(text, /the fork inherits your model and context/);
});

test("replay: route-only changes are counted separately", async () => {
  const { replayRecord } = await import("../replay.mjs");
  const answers = normalizeAnswers(documentedAnswers(), config.questions);
  const record = { id: "id-1", action: "delegate", role: "junior", route: { provider: "openrouter", model: "qwen3.8-flash" }, answers, model: "m" };
  // candidate maps mechanical → implementer: same action, different child
  const candidate = { ...config, routeFor: { ...config.routeFor, mechanical: "implementer" } };
  const result = replayRecord(record, candidate);
  assert.equal(result.actionChanged, false);
  assert.equal(result.routeChanged, true);
  assert.equal(result.changed, true);
  assert.equal(result.fromRoute, "junior@openrouter/qwen3.8-flash");
  assert.equal(result.toRoute, "implementer@openrouter/deepseek-v4-flash");
  // unchanged when role and route match
  const same = replayRecord(record, config);
  assert.equal(same.changed, false);
});

test("config: structured score criteria are addressed by index", () => {
  const structured = resolveConfig({
    questions: { effort: { type: "score", instructions: "i", criteria: [{ name: "small", detail: "d" }, { name: "large", detail: "d" }] } },
  });
  const names = criteriaLevelNames(structured.questions.effort);
  assert.deepEqual(names, ["0", "1"]); // no "[object Object]"
  // normalization maps positions onto the same index names — no collapse
  const normalized = normalizeAnswers({
    answers: { effort: { type: "score", score: 1, probabilities: { "0": 0.7, "1": 0.3 }, confidence: 0.9 } },
  }, structured.questions);
  assert.deepEqual(normalized.effort.probabilities, { "0": 0.7, "1": 0.3 });
  // a probabilityMax policy speaks the same index names
  const gated = resolveConfig({
    questions: structured.questions,
    profiles: { auto: { delegate: { probabilityMax: { effort: { "1": 0.2 } } } } },
  });
  const highTail = normalizeAnswers({
    answers: { effort: { type: "score", score: 1, probabilities: { "0": 0.6, "1": 0.4 }, confidence: 0.9 } },
  }, gated.questions);
  assert.equal(decide({ answers: highTail, model: "m" }, gated).action, "skip");
});

test("settings: mode off turns classify nothing at zero cost", async () => {
  const ctx = fakeContext();
  await apply(ctx, { mode: "off", mock: true });
  const listener = ctx.calls[0].handler;
  const decision = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "/route fix the parser" }] }] };
  let nextCalls = 0;
  const result = await listener({ agent: { session: {} }, messages: decision.messages, signal: null }, async () => {
    nextCalls += 1;
    return decision;
  });
  assert.equal(nextCalls, 1); // downstream always ran
  assert.equal(result, decision); // untouched — no state built, no call made
});

test("settings: a UI edit reaches the next turn without re-apply", async () => {
  const ctx = fakeContext(capableServices());
  const additions = [];
  await apply(ctx, { mode: "off", mock: true }, {
    services: capableServices(),
    pluginMessage: async (text) => {
      additions.push(text);
      return { role: "user", content: [{ type: "text", text }] };
    },
  });
  assert.equal(typeof ctx.settingsSource, "function", "apply wired the settings bridge");
  const listener = ctx.calls[0].handler;
  const decision = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "/route rename the config keys everywhere" }] }] };
  const next = async () => decision;
  // mode off: the turn passes through untouched
  assert.equal(await listener({ agent: { session: {} }, messages: decision.messages, signal: null }, next), decision);
  assert.equal(additions.length, 0);
  // a UI edit flips the live config — no re-apply, no restart
  ctx.settingsSource({ mode: "once", mock: true, provider: "openrouter" });
  const routed = await listener({ agent: { session: {} }, messages: decision.messages, signal: null }, next);
  assert.notEqual(routed, decision, "the edited mode classified and injected");
  assert.equal(additions.length, 1);
  assert.match(additions[0], /subagent/i); // pluginMessage receives the text
  // an invalid edit is rejected; the good config keeps working
  ctx.settingsSource({ mode: "once", timeoutMs: -5 });
  const still = await listener({ agent: { session: {} }, messages: decision.messages, signal: null }, next);
  assert.notEqual(still, decision);
  assert.equal(additions.length, 2);
});

test("settings: a routes edit reaches the next recommendation", async () => {
  const ctx = fakeContext(capableServices());
  const additions = [];
  await apply(ctx, { mode: "once", mock: true, provider: "openrouter" }, {
    services: capableServices(),
    pluginMessage: async (text) => {
      additions.push(text);
      return { role: "user", content: [{ type: "text", text }] };
    },
  });
  const listener = ctx.calls[0].handler;
  let decision = { kind: "enter", messages: [] };
  const next = async () => decision;
  const turn = () => ({ agent: { session: {} }, messages: decision.messages, signal: null });
  /** Start a turn with `text` as the user's message. */
  const say = (text) => {
    decision = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text }] }] };
  };
  say("/route rename the config keys everywhere");
  await listener(turn(), next);
  // The shipped mechanical route names a model a profile allowlist need not carry.
  assert.equal(additions.length, 1);
  assert.match(additions[0], /role "junior" .* model qwen3\.8-flash/);
  // Editing routes in the card must reach the next turn without a re-apply.
  ctx.settingsSource({
    mode: "once", mock: true, provider: "openrouter",
    routes: { junior: { provider: "openrouter", model: "glm-5.3-flash" } },
  });
  await listener(turn(), next);
  assert.equal(additions.length, 2);
  assert.match(additions[1], /glm-5\.3-flash/, "the edited route is recommended");
  assert.doesNotMatch(additions[1], /qwen3\.8-flash/, "the shipped mechanical route is replaced");
  // Routes merge per key, so the untouched researcher route must survive.
  say("/route research how the catalog is refreshed");
  await listener(turn(), next);
  assert.equal(additions.length, 3);
  assert.match(additions[2], /role "researcher" .* model qwen3\.8-flash/, "the untouched researcher route still applies");
  // A review is its own class, so it reaches the reviewer role — and the role
  // survives the same per-key merge that kept the researcher above.
  say("/route review the diff in stats.mjs");
  await listener(turn(), next);
  assert.equal(additions.length, 4);
  assert.match(additions[3], /role "reviewer"/, "the review class routes to the reviewer, not to research");
});

test("verdict: bugfix maps to the implementer route, not to the mechanical one", () => {
  // The keyword mock cannot answer `bugfix`, so this mapping is asserted on the
  // decision itself — which is also the only way to reach the implementer role.
  const answers = documentedAnswers();
  answers.answers.task_class = { type: "choice", choice: "bugfix", probabilities: null, confidence: 0.9 };
  const decision = decide({ answers: normalizeAnswers(answers, config.questions), model: "jev-1.13.0" }, config);
  assert.equal(decision.action, "delegate");
  assert.equal(decision.role, "implementer");
  assert.deepEqual(decision.route, { provider: "openrouter", model: "deepseek-v4-flash" });
});

test("config: the renamed mechanical role folds into junior", () => {
  // A card edit made before the rename persists the whole map, stale key included.
  const stale = resolveConfig({
    provider: "openrouter",
    routes: { mechanical: { provider: "openrouter", model: "legacy-model" }, implementer: { provider: "openrouter", model: "deepseek-v4-flash" } },
  });
  assert.deepEqual(Object.keys(stale.routes).sort(), ["implementer", "junior", "researcher", "reviewer"]);
  assert.deepEqual(stale.routes.junior, { provider: "openrouter", model: "legacy-model" });
  // An explicit junior in the same patch outranks the stale key.
  const explicit = resolveConfig({
    provider: "openrouter",
    routes: { mechanical: { provider: "openrouter", model: "legacy-model" }, junior: { provider: "openrouter", model: "chosen" } },
  });
  assert.equal(explicit.routes.junior.model, "chosen");
  assert.equal("mechanical" in explicit.routes, false);
  // Nothing to fold: the shipped set is untouched.
  assert.deepEqual(Object.keys(resolveConfig({ provider: "openrouter" }).routes).sort(), ["implementer", "junior", "researcher", "reviewer"]);
});

test("key: the credentials store wins over the environment", async () => {
  // The store is what the Models page writes, so an issuer key normally already
  // lives there; an environment variable is the fallback, not the requirement.
  const ctx = { get: (name) => (name === "credentials"
    ? { resolve: async (ref) => (ref === "JEV_KEY" ? { value: "from-store" } : undefined) }
    : undefined) };
  assert.equal(await resolveApiKeyFrom(ctx, "JEV_KEY", undefined, { JEV_KEY: "from-env" }), "from-store");
  assert.equal(await resolveApiKeyFrom(ctx, "JEV_OTHER", undefined, { JEV_OTHER: "from-env" }), "from-env");
});

test("key: an empty or throwing store falls through to the environment", async () => {
  const warns = [];
  const empty = { get: () => ({ resolve: async () => ({ value: "" }) }) };
  assert.equal(await resolveApiKeyFrom(empty, "JEV_KEY", undefined, { JEV_KEY: "from-env" }), "from-env");
  const throwing = { get: () => ({ resolve: async () => { throw new Error("no such store entry"); } }) };
  assert.equal(await resolveApiKeyFrom(throwing, "JEV_KEY", { warn: (m) => warns.push(m) }, { JEV_KEY: "from-env" }), "from-env");
  assert.match(warns[0] ?? "", /credential lookup failed/);
});

test("key: neither source leaves the key unresolved, and no name is not a lookup", async () => {
  assert.equal(await resolveApiKeyFrom({}, "JEV_ABSENT", undefined, {}), undefined);
  assert.equal(await resolveApiKeyFrom({ get: () => ({ resolve: async () => ({ value: "x" }) }) }, "", undefined, {}), undefined);
});

test("host: a failed call on an explicit trigger is reported instead of silent", async () => {
  // The fail-open path used to be mute: a key that was never wired up looked
  // exactly like a plugin that decided not to route.
  const ctx = fakeContext(capableServices());
  const additions = [];
  await apply(ctx, { mode: "once", mock: false, provider: "openrouter", apiKeyEnv: "JEV_TEST_UNSET_KEY" }, {
    services: capableServices(),
    pluginMessage: async (text) => {
      additions.push(text);
      return { role: "user", content: [{ type: "text", text }] };
    },
  });
  const decision = {
    kind: "enter",
    messages: [{ role: "user", content: [{ type: "text", text: "/route rename the config keys everywhere" }] }],
  };
  const routed = await ctx.calls[0].handler(
    { agent: { session: {} }, messages: decision.messages, signal: null },
    async () => decision,
  );
  assert.equal(additions.length, 1, "an explicit request hears about the failure");
  assert.match(additions[0], /Jev call failed/);
  assert.match(additions[0], /JEV_TEST_UNSET_KEY/);
  assert.notEqual(routed, decision, "the diagnostic reaches the turn");
});

test("host: a failed call on an ordinary turn stays silent", async () => {
  // In `auto` mode a bad key must not write a diagnostic into every turn.
  const ctx = fakeContext(capableServices());
  const additions = [];
  await apply(ctx, { mode: "auto", mock: false, provider: "openrouter", apiKeyEnv: "JEV_TEST_UNSET_KEY" }, {
    services: capableServices(),
    pluginMessage: async (text) => {
      additions.push(text);
      return { role: "user", content: [{ type: "text", text }] };
    },
  });
  const decision = {
    kind: "enter",
    messages: [{ role: "user", content: [{ type: "text", text: "rename the config keys everywhere" }] }],
  };
  const routed = await ctx.calls[0].handler(
    { agent: { session: {} }, messages: decision.messages, signal: null },
    async () => decision,
  );
  assert.equal(additions.length, 0);
  assert.equal(routed, decision);
});

/** Run one explicit `/route` turn through a stand with a stubbed fetch. */
async function runTurnWithFetch({ services, config, fetchImpl, text = "/route rename the config keys everywhere" }) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const ctx = fakeContext(services);
    const additions = [];
    await apply(ctx, config, {
      services,
      pluginMessage: async (body) => {
        additions.push(body);
        return { role: "user", content: [{ type: "text", text: body }] };
      },
    });
    const messages = [{ role: "user", content: [{ type: "text", text }] }];
    const decision = { kind: "enter", messages };
    await ctx.calls[0].handler({ agent: { session: {} }, messages, signal: null }, async () => decision);
    return additions;
  } finally {
    globalThis.fetch = original;
  }
}

test("host: the key reaches the wire from the credentials store, not only from the environment", async () => {
  // Credentials store first: the Models page is where a key usually already is,
  // so a stored key must be enough to make a real call — no exported variable.
  const seen = [];
  const services = {
    ...capableServices(),
    credentials: { resolve: async (ref) => ({ value: `cred-${ref}` }) },
  };
  const additions = await runTurnWithFetch({
    services,
    config: { mode: "once", mock: false, provider: "openrouter", apiKeyEnv: "JEV_TEST_CRED" },
    fetchImpl: async (_url, init) => {
      seen.push(init?.headers?.authorization);
      return { ok: false, status: 401, text: async () => "bad key" };
    },
  });
  assert.deepEqual(seen, ["Bearer cred-JEV_TEST_CRED"], "the stored key was sent, and it was the store's value");
  assert.match(additions.at(-1) ?? "", /HTTP 401/, "and the failure is reported, not swallowed");
});

test("host: a 1.5 second answer fits the shipped budget, and did not fit the old 900 ms one", async () => {
  // The measured latency of a live decision, against the old and new defaults.
  // Honours the abort signal, as real fetch does: without that the budget could
  // not be exercised at all, and the old default would look fine.
  const slow = async (_url, init) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1500);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        reject(error);
      }, { once: true });
    });
    return { ok: false, status: 401, text: async () => "slow but alive" };
  };
  const services = { ...capableServices(), credentials: { resolve: async () => ({ value: "cred" }) } };
  const base = { mode: "once", mock: false, provider: "openrouter", apiKeyEnv: "JEV_TEST_CRED" };

  const shipped = await runTurnWithFetch({ services, config: { ...base }, fetchImpl: slow });
  assert.match(shipped.at(-1) ?? "", /HTTP 401/, "4000 ms default: the answer arrived");

  const old = await runTurnWithFetch({ services, config: { ...base, timeoutMs: 900 }, fetchImpl: slow });
  assert.match(old.at(-1) ?? "", /abort|timeout/i, "900 ms: the same answer was cut off");
});

test("host: the message factory resolves through the host entry point, not only the plugin's node_modules", async (t) => {
  // A `link:` checkout has no node_modules of its own, and a bare import resolves
  // from the importing module's REAL path — so the peer has to be reachable
  // through the host. Skipped where no `dsh` is installed.
  const entry = (() => {
    try {
      return realpathSync(execFileSync("which", ["dsh"], { encoding: "utf8" }).trim());
    } catch {
      return null;
    }
  })();
  if (entry === null) return t.skip("no dsh on PATH");
  const factory = await loadMessageFactory([entry]);
  assert.equal(typeof factory, "function", "resolved through the host entry point");
  const message = factory({
    content: [{ type: "text", text: "проверка" }],
    source: { kind: "plugin:jev-subagent-dispatch", plugin: "dsh-jev-subagent-dispatch" },
  });
  assert.equal(message.role, "user");
  assert.equal(typeof message.id, "string");
});

test("host: an unreachable factory is reported instead of silently skipping", async () => {
  const warns = [];
  const message = await pluginMessage("текст", { warn: (line) => warns.push(line) });
  // However it resolves here, it must never fail in silence.
  if (message === null) assert.match(warns[0] ?? "", /dsh-llm is unreachable/);
  else assert.equal(message.content[0].text, "текст");
});
