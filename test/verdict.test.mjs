/**
 * Unit tests for dsh-jev-subagent-dispatch: the TypeSafe wire contract, config
 * resolution, verdict logic (including score boundary cases), redaction,
 * and the host integration path with a fake context.
 *
 * Run: node --test test/
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaults, PROVIDER_PRESETS, resolveConfig, validate } from "../config.mjs";
import { buildRequestBody, buildRequestUrl, normalizeAnswers } from "../jev.mjs";
import { apply } from "../index.mjs";
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
  assert.deepEqual(merged.profiles.auto.delegate.taskClass, ["mechanical", "bugfix", "research"]);
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
  assert.match(state, /^workspace: \/w\ntask:\nrename foo/);
  assert.doesNotMatch(state, /injected/);
  assert.doesNotMatch(state, /sk-abc123/);
  assert.match(state, /\[redacted\]/);
  const capped = buildState(messages, "/w", 20);
  assert.ok(capped.length <= 20);
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
  assert.equal(decision.role, "implementer");
  assert.deepEqual(decision.route, { provider: "openrouter", model: "deepseek-v4-flash" });
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
  assert.match(text, /deepseek-v4-flash/);
  assert.match(text, /M \(1\)/); // level label + numeric score
  assert.match(text, /subagent tool is unavailable/);
});

/** Minimal fake host context capturing the pre-step registration. */
function fakeContext(services = {}) {
  const calls = [];
  let gets = 0;
  return {
    calls,
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
    logger: { info() {}, warn() {}, error() {} },
  };
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

test("host: apply registers one prepended pre-step listener, and only when enabled", () => {
  const on = fakeContext();
  apply(on, { mode: "auto", mock: true });
  assert.equal(on.calls.length, 1);
  assert.equal(on.calls[0].event, "agent/pre-step");
  assert.deepEqual(on.calls[0].options, { prepend: true });
  const off = fakeContext();
  apply(off, { mode: "off" });
  assert.equal(off.calls.length, 0);
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
  assert.match(result.messages[1].content[0].text, /deepseek-v4-flash/);
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
    assert.equal(line.role, "implementer");
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
  assert.match(state, /task:\nfix the failing tests in the parser/);
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
  assert.match(result.messages[1].content[0].text, /deepseek-v4-flash/);
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
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], "subagent_fork"), { kind: "fork" });
  assert.deepEqual(routeAdviceFor("fixed", route, undefined, "subagent_fork"), { kind: "fork" });
  assert.deepEqual(routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], "subagent"), { kind: "named", route });

  const forkOnly = {
    tools: { get: (name) => (name === "subagent_fork" ? { name } : undefined) },
    subagents: { getProvider: (name) => ({ name }), resolveMaxDepth: () => 8 },
  };
  const check = checkDispatchCapabilities(forkOnly, { session: {} });
  assert.equal(check.ok, true);
  assert.equal(check.toolName, "subagent_fork");
  const decision = { action: "delegate", answers: { task_class: { value: "mechanical" } }, role: "implementer", confidence: 0.9, route };
  const text = renderVerdictMessage(decision, config, { routeAdvice: routeAdviceFor("named", route, [{ provider: "openrouter", model: "deepseek-v4-flash" }], check.toolName) });
  assert.match(text, /subagent_fork → the fork inherits your model and context/);
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
  // Real responses may key positions by stringified indices ("4").
  const positional = normalizeAnswers({
    answers: { ...documentedAnswers().answers, blast_radius: { type: "score", score: 1, probabilities: { "0": 0.5, "1": 0.5 }, confidence: 0.9 } },
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
