/**
 * `dsh-jev-subagent-dispatch` — pure verdict logic.
 *
 * Everything here is a pure function over plain data so it can be unit
 * tested without a host, a network, or a key: redact the state to build,
 * evaluate the active profile's declarative predicate over the answers,
 * pick the route, and render the injected message.
 *
 * @module dsh-jev-subagent-dispatch/verdict
 */

import { BUILT_IN_REDACT_PATTERNS, criteriaLevelNames } from "./config.mjs";

/** Compiled credential-shaped patterns applied to every outbound state. */
const REDACT_RES = BUILT_IN_REDACT_PATTERNS.map((source) => new RegExp(source, "gi"));

/**
 * Replace credential-shaped substrings with a marker. Applied to the state
 * before it leaves the machine and to turn text before it reaches the log.
 * Built-in patterns cover common key shapes; `redactPatterns` adds user
 * regex sources on top.
 * @param text - arbitrary text.
 * @param extraPatterns - additional RegExp source strings.
 * @returns the redacted text.
 */
export function redact(text, extraPatterns = []) {
  let out = String(text ?? "");
  for (const source of [...extraPatterns, ...BUILT_IN_REDACT_PATTERNS]) {
    try {
      out = out.replace(new RegExp(source, "gi"), "[redacted]");
    } catch {
      // An invalid user pattern must not break routing; skip it.
    }
  }
  return out;
}

/**
 * Extract plain text from one DSH message's content parts.
 * @param message - a DSH message object.
 * @returns concatenated text of its text parts.
 */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Whether a message is a real user turn rather than a plugin/synthetic
 * injection (plugin sources carry `source.kind` values like
 * `plugin:jev-subagent-dispatch` or legacy `plugin`).
 * @param message - a DSH message object.
 * @returns true when the message is an ordinary user message.
 */
export function isPlainUserMessage(message) {
  if (message?.role !== "user") return false;
  const kind = message?.source?.kind;
  return kind === undefined || kind === "user" || kind === null;
}

/**
 * Build the System One state: the user's turn (redacted) plus minimal
 * workspace context, capped to `stateChars` from the head. Non-text content
 * is ignored — never ship binaries to the model. An explicit decision
 * request (the text after a trigger) leads the body so the cap can never
 * drop it.
 * @param messages - the claimed user messages for this step.
 * @param cwd - the agent's working directory.
 * @param stateChars - head cap for the combined state.
 * @param extraRedactPatterns - user-supplied regex sources.
 * @param explicitTask - the decision request text after a trigger, if any.
 * @returns the state string, or "" when there is nothing to classify.
 */
const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export function buildState(messages, cwd, stateChars, extraRedactPatterns = [], explicitTask = "") {
  const turns = (messages ?? [])
    .filter((message) => isPlainUserMessage(message))
    .map((message) => messageText(message).trim())
    .filter((text) => text.length > 0);
  const task = String(explicitTask ?? "").trim();
  const bodyParts = task.length > 0 ? [task, ...turns] : turns;
  if (bodyParts.length === 0) return "";
  // The task text goes FIRST — it is what the classifier reads — and the
  // workspace path trails as bounded context. The whole assembled state is
  // redacted (the path passes the same credential filters as the task text)
  // and capped as a whole, so no path length can push the task out of the
  // payload; a very long path just loses its tail inside the reserved room.
  const body = redact(bodyParts.join("\n---\n"), extraRedactPatterns);
  const maxPath = Math.max(0, Math.min(120, stateChars - body.length));
  const path = redact(String(cwd ?? ""), extraRedactPatterns);
  const trail = path.length > maxPath ? path.slice(0, maxPath) : path;
  const state = `${body}\nworkspace: ${trail}`;
  return state.length > stateChars ? state.slice(0, Math.max(0, stateChars)) : state;
}

/**
 * Find a routing trigger in the claimed user messages. Returns null when no
 * plain user turn starts with a configured trigger — the caller then leaves
 * the turn untouched (zero calls, zero data sharing). A `preview` keyword
 * right after the trigger marks the request as evaluation-only.
 * @param messages - the claimed messages for this step.
 * @param config - resolved plugin configuration.
 * @returns `{ action: "route" | "preview", task, trigger }` or null.
 */
export function findTrigger(messages, config) {
  for (const message of messages ?? []) {
    if (!isPlainUserMessage(message)) continue;
    const text = messageText(message).trim();
    if (text.length === 0) continue;
    for (const trigger of config.triggers ?? []) {
      const lower = text.toLowerCase();
      const token = trigger.toLowerCase();
      if (!lower.startsWith(token)) continue;
      // Word boundary: "/router" is not "/route". The next character must
      // be whitespace, punctuation, or end-of-line — never a word character.
      const after = text[trigger.length];
      if (after !== undefined && /[A-Za-z0-9_-]/.test(after)) continue;
      let rest = text.slice(trigger.length).trim();
      let action = "route";
      if (rest.toLowerCase().startsWith("preview")) {
        action = "preview";
        rest = rest.slice("preview".length).trim();
      }
      return { action, task: rest, trigger };
    }
  }
  return null;
}

/**
 * Evaluate the active profile's declarative predicate against answers.
 * Choice answers compare by option name; Score answers are numeric
 * positions on the levels spectrum (possibly fractional) compared against
 * `effortMax` / `blastRadiusMax` ceilings (score ≤ ceiling passes); noul
 * answers are probabilities compared against `maxNoul` ceilings. A missing
 * answer fails the predicate closed — an absent judgment never routes.
 * @param answers - normalized answers map (see jev.mjs).
 * @param delegate - profile predicate `{ taskClass?, effortMax?,
 *   blastRadiusMax?, maxNoul? }`.
 * @param questions - the configured questions map.
 * @returns `{ pass, reason }` — reason names the first failed clause.
 */
export function predicateHolds(answers, delegate, questions) {
  if (delegate.taskClass !== undefined) {
    const answer = answers.task_class;
    if (typeof answer?.value !== "string") {
      return { pass: false, reason: "task_class missing" };
    }
    const allowed = delegate.taskClass.map((item) => String(item).toLowerCase());
    if (!allowed.includes(answer.value.toLowerCase())) {
      return { pass: false, reason: `task_class ${answer.value} not in ${delegate.taskClass.join("|")}` };
    }
  }
  for (const [id, key] of [["effort", "effortMax"], ["blast_radius", "blastRadiusMax"]]) {
    if (delegate[key] === undefined) continue;
    const answer = answers[id];
    if (!Number.isFinite(answer?.value)) {
      return { pass: false, reason: `${id} missing` };
    }
    if (answer.value > delegate[key]) {
      return { pass: false, reason: `${id} ${answer.value} > ${key}` };
    }
  }
  for (const [id, ceiling] of Object.entries(delegate.maxNoul ?? {})) {
    const answer = answers[id];
    const probability = Number.isFinite(answer?.value) ? answer.value : 1;
    if (probability > ceiling) {
      return { pass: false, reason: `${id} ${probability.toFixed(2)} > ${ceiling}` };
    }
  }
  // Per-level probability ceilings: the average score can look safe while a
  // severe level still carries real mass. Levels are rubric names ("infra"),
  // tail sums ("public_api+" = that level or worse), or numeric indices;
  // numeric positions from the response were translated onto rubric names at
  // normalization time. Fails closed without usable probabilities.
  for (const [id, limits] of Object.entries(delegate.probabilityMax ?? {})) {
    const probabilities = answers[id]?.probabilities;
    const names = criteriaLevelNames(questions?.[id]);
    if (probabilities === null || typeof probabilities !== "object") {
      return { pass: false, reason: `${id} probabilities missing` };
    }
    for (const [rawLevel, max] of Object.entries(limits)) {
      const tail = rawLevel.endsWith("+");
      const level = tail ? rawLevel.slice(0, -1) : rawLevel;
      const index = /^\d+$/.test(level) ? Number(level) : names.indexOf(level);
      if (index === -1 || index >= names.length) {
        return { pass: false, reason: `${id} level "${level}" is not in the rubric` };
      }
      const levels = tail ? names.slice(index) : [names[index]];
      const mass = levels.reduce(
        (sum, name, offset) => sum + numberOr(probabilities[name], numberOr(probabilities[String(tail ? index + offset : index)], 0)),
        0,
      );
      if (mass > max) {
        return { pass: false, reason: `${id} P(${rawLevel}) ${mass.toFixed(2)} > ${max}` };
      }
    }
  }
  return { pass: true, reason: "predicate holds" };
}

/**
 * Decide what the plugin should do for one classified turn. The result is a
 * RECOMMENDATION the main agent is free to ignore — measurement, not
 * enforcement.
 * @param object - `{ answers, model, usage, latencyMs }` from the client.
 * @param config - resolved plugin configuration.
 * @returns `{ action, reason, confidence, answers?, model, usage, latencyMs,
 *   route?, role? }` where action is `"delegate"` or `"skip"`.
 */
export function decide({ answers, model, usage, latencyMs }, config) {
  const profile = config.profiles[config.activeProfile];
  const taskClassAnswer = answers.task_class;
  const primaryConfidence = Number.isFinite(taskClassAnswer?.confidence)
    ? taskClassAnswer.confidence
    : Number.isFinite(answers.effort?.confidence)
      ? answers.effort.confidence
      : 0;
  const floor = profile.confidenceMin;
  if (primaryConfidence < floor) {
    return {
      action: "skip",
      reason: `confidence ${primaryConfidence.toFixed(2)} < ${floor}`,
      confidence: primaryConfidence,
      answers,
      model,
      usage,
      latencyMs,
    };
  }
  const check = predicateHolds(answers, profile.delegate, config.questions);
  if (!check.pass) {
    return { action: "skip", reason: check.reason, confidence: primaryConfidence, answers, model, usage, latencyMs };
  }
  const classLabel = String(taskClassAnswer?.value ?? "").toLowerCase();
  const role = config.routeFor[classLabel] ?? config.defaultRoute;
  const route = config.routes[role] ?? config.routes[config.defaultRoute];
  if (!route) {
    return {
      action: "skip",
      reason: `no route for role "${role}"`,
      confidence: primaryConfidence,
      answers,
      model,
      usage,
      latencyMs,
    };
  }
  return {
    action: "delegate",
    reason: check.reason,
    confidence: primaryConfidence,
    model,
    usage,
    latencyMs,
    answers,
    role,
    route,
  };
}

/**
 * Short level label for a score answer: the text before the " — " separator
 * in the level description ("S — one file" → "S"), or the raw number when
 * the criteria do not follow that convention.
 */
function scoreLabel(config, id, value) {
  const criteria = config.questions?.[id]?.criteria;
  if (!Array.isArray(criteria)) return String(value);
  const level = criteria[Math.min(criteria.length - 1, Math.max(0, Math.round(value)))];
  if (typeof level !== "string") return String(value);
  const match = level.match(/^[^—-]+/);
  return (match?.[0] ?? String(value)).trim();
}

/**
 * Format one score answer's per-level probabilities as "name 0.42, ..."
 * — the tail risk a probabilityMax policy gates on. Null for answers
 * without usable distributions.
 * @param answer - a normalized score answer with `probabilities`.
 * @returns the distribution text, or null.
 */
function distributionLine(answer) {
  const probabilities = answer?.probabilities;
  if (probabilities === null || typeof probabilities !== "object") return null;
  const entries = Object.entries(probabilities);
  if (entries.length === 0) return null;
  return entries.map(([name, value]) => `${name} ${Number(value).toFixed(2)}`).join(", ");
}

/**
 * Render the injected user message. English on purpose: it instructs the
 * agent, not the user, and the agent's instructions are English.
 * @param decision - a `"delegate"` decision from {@link decide}.
 * @param config - resolved plugin configuration.
 * @param options - `{ preview }` renders an evaluation-only message;
 *   `routeAdvice` names the route only when the session's model-selection
 *   policy allows it (see capabilities.mjs).
 * @returns the message text.
 */
export function renderVerdictMessage(decision, config, { preview = false, routeAdvice = { kind: "named", route: decision.route } } = {}) {
  const { answers, role, confidence } = decision;
  if (decision.action === "skip") {
    // Reachable only in preview mode: show the miss WITH its answers so the
    // verdict log and the preview explain why the policy declined.
    const effort = answers.effort !== undefined
      ? `${scoreLabel(config, "effort", answers.effort.value)} (${answers.effort.value})`
      : "n/a";
    const blast = answers.blast_radius !== undefined
      ? `${scoreLabel(config, "blast_radius", answers.blast_radius.value)} (${answers.blast_radius.value})`
      : "n/a";
    const taskClass = String(answers.task_class?.value ?? "unknown");
    const lines = [
      "[jev-subagent-dispatch] PREVIEW — evaluation only: this is a System One verdict for the verdict log, NOT a routing instruction. Do not delegate based on it.",
      `- verdict: skip — ${decision.reason ?? "policy declined"}`,
      `- class: ${taskClass} (confidence ${Number(decision.confidence ?? 0).toFixed(2)}, effort ${effort}, blast radius ${blast})`,
    ];
    const noul = Object.entries(answers)
      .filter(([id, answer]) => config.questions?.[id]?.type === "noul" && Number.isFinite(answer?.value))
      .map(([id, answer]) => `${id}=${answer.value.toFixed(2)}`)
      .join(", ");
    if (noul.length > 0) lines.push(`- noul: ${noul}`);
    for (const [id, answer] of Object.entries(answers)) {
      const distribution = distributionLine(answer);
      if (distribution !== null) lines.push(`- ${id} distribution: ${distribution}`);
    }
    return lines.join("\n");
  }
  const effort = answers.effort !== undefined
    ? `${scoreLabel(config, "effort", answers.effort.value)} (${answers.effort.value})`
    : "n/a";
  const blast = answers.blast_radius !== undefined
    ? `${scoreLabel(config, "blast_radius", answers.blast_radius.value)} (${answers.blast_radius.value})`
    : "n/a";
  const taskClass = String(answers.task_class?.value ?? "unknown");
  const noul = Object.entries(answers)
    .filter(([id, answer]) => config.questions?.[id]?.type === "noul" && Number.isFinite(answer?.value))
    .map(([id, answer]) => `${id}=${answer.value.toFixed(2)}`)
    .join(", ");
  const lines = preview
    ? [
      "[jev-subagent-dispatch] PREVIEW — evaluation only: this is a System One verdict for the verdict log, NOT a routing instruction. Do not delegate based on it.",
    ]
    : [
      "[jev-subagent-dispatch] Dispatch recommendation for this turn (Jev-guided, not a human instruction — use your judgment):",
    ];
  lines.push(
    `- class: ${taskClass} (confidence ${confidence.toFixed(2)}, effort ${effort}, blast radius ${blast})`,
  );
  if (noul.length > 0) lines.push(`- noul: ${noul}`);
  if (preview) {
    for (const [id, answer] of Object.entries(answers)) {
      const distribution = distributionLine(answer);
      if (distribution !== null) lines.push(`- ${id} distribution: ${distribution}`);
    }
  }
  if (routeAdvice.kind === "named") {
    const { provider, model } = routeAdvice.route;
    lines.push(`- recommended route: subagent role "${role}" → provider ${provider}, model ${model}`);
  } else if (routeAdvice.kind === "fork") {
    // subagent_fork is fixed-route by design: it omits model selection, so
    // naming a model here would be advice the tool cannot follow.
    lines.push(`- recommended route: subagent_fork → the fork inherits your model and context (fixed-route; model selection does not apply)`);
  } else if (routeAdvice.kind === "child-default") {
    lines.push(`- recommended route: subagent role "${role}" → the session's configured child default (model selection is off; the model is not chosen here)`);
  } else {
    const { provider, model } = routeAdvice.route ?? {};
    const configured = provider !== undefined ? ` (the configured default ${provider}/${model} is not allowed)` : "";
    lines.push(`- recommended route: subagent role "${role}" → pick a model from the session allowlist (list_subagent_models)${configured}`);
  }
  if (!preview) {
    lines.push(
      "If you delegate, spawn that subagent with a self-contained brief: goal, exact files or APIs in scope, acceptance checks, and what must NOT change.",
    );
    if (config.includeFallbackLine) {
      lines.push("If the subagent tool is unavailable in this session, proceed yourself and keep the change as small as the brief allows.");
    }
  }
  return lines.join("\n");
}
/**
 * Render the diagnostic injected for an explicit routing request when
 * delegation is unavailable: what exactly is missing, and where to look.
 * Ordinary turns never see this — they stay silent and make no API call.
 * @param missing - the capability gaps from {@link checkDispatchCapabilities}.
 * @returns the message text.
 */
export function renderUnavailableMessage(missing) {
  return [
    "[jev-subagent-dispatch] Dispatch is unavailable in this session, so no Jev call was made. Missing:",
    ...(missing ?? []).map((item) => `- ${item}`),
    "Check the subagent setup — the Subagent plugin enabled under Plugins, its tools allowed for this session, and the depth limit in Settings → Subagent — then re-run the request.",
  ].join("\n");
}
