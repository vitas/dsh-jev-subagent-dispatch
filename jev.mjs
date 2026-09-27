/**
 * `dsh-jev-subagent-dispatch` — TypeSafe System One client.
 *
 * The wire contract is the one documented at docs.typesafe.ai/api —
 * `POST {provider endpoint}{apiPath}` with `{ state, model, questions }`,
 * where `questions` is a MAP keyed by question id and each question carries
 * `type`, `instructions`, and `criteria` (a choice's criteria is a map of
 * option name → description, a score's is an ordered array of level
 * descriptions, a noul's is an optional `{ true, false }` map). The plugin's
 * question config uses this same shape, so `buildRequestBody` is the
 * contract: what is configured is what is sent. All providers (TypeSafe,
 * B.AI's Decisions API, OpenRouter's System One API) speak this format and
 * return typed Jev answers; only the URL, the model id, and the credential
 * variable differ, and the provider preset owns those.
 *
 * Answers come back as a map under the same ids: Choice answers carry
 * `choice` + `probabilities` + `confidence`; Score answers carry `score`
 * (a position on the levels spectrum, 0..n-1, which MAY land between two
 * levels) + `legend` + `probabilities` + `confidence`; Noul answers carry
 * `noul` (0..1). Normalization is defensive so a client bug degrades to a
 * skipped turn, never to a mis-routed one.
 *
 * `mock` mode exists for wiring tests without an API key: it answers from
 * keywords with fixed confidence in the documented answer shapes. It
 * classifies nothing — never enable it outside a bench.
 *
 * @module dsh-jev-subagent-dispatch/jev
 */

/**
 * Build the request URL for the configured provider: `endpoint` + `apiPath`
 * (the provider preset supplies them; explicit config values win).
 * Exported so tests can assert the per-provider addresses.
 * @param config - resolved plugin configuration.
 * @returns the absolute URL to POST to.
 */
export function buildRequestUrl(config) {
  return `${config.endpoint.replace(/\/+$/, "")}${config.apiPath}`;
}

/**
 * Build the request body per the documented API contract. Exported so the
 * contract test can assert the shape without any network.
 * @param config - resolved plugin configuration.
 * @param state - the state text to evaluate.
 * @returns the exact body for the provider's Jev endpoint.
 */
export function buildRequestBody(config, state) {
  return {
    state,
    model: config.model,
    questions: structuredClone(config.questions),
  };
}

/**
 * Classify one state against the configured rubric.
 * @param config - resolved plugin configuration.
 * @param state - the text state (redacted task description + context).
 * @param logger - host logger with `.warn()`.
 * @returns `{ answers, model, usage, latencyMs }` where `answers` maps
 *   question id to a normalized answer and `usage` is the response's
 *   `{ input_tokens, output_tokens }` when present.
 */
export async function classify(config, state, logger = console) {
  const startedAt = Date.now();
  if (config.mock) {
    return {
      answers: mockAnswers(config, state),
      model: "mock",
      usage: null,
      latencyMs: Date.now() - startedAt,
    };
  }
  const apiKey = process.env[config.apiKeyEnv];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error(`jev-subagent-dispatch: environment variable ${config.apiKeyEnv} is not set`);
  }
  const response = await fetch(buildRequestUrl(config), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildRequestBody(config, state)),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`jev-subagent-dispatch: System One HTTP ${response.status}${body ? ` — ${body}` : ""}`);
  }
  const payload = await response.json();
  return {
    answers: normalizeAnswers(payload, config.questions),
    model: typeof payload?.model === "string" ? payload.model : config.model,
    usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : null,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Normalize a documented System One response into a map keyed by question
 * id: choice → `{ value, probabilities, confidence }`; score → `{ value
 * (number, may be fractional), legend, probabilities, confidence }`; noul →
 * `{ value }`. Throws on a structurally impossible response.
 * @param payload - parsed response body.
 * @param questions - the configured questions map (for probability keys).
 * @returns map of id → normalized answer.
 */
export function normalizeAnswers(payload, questions) {
  const raw = payload?.answers;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("jev-subagent-dispatch: response carries no answers map");
  }
  const out = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = raw[id];
    if (answer !== undefined && answer !== null) out[id] = pickAnswer(question, answer);
  }
  return out;
}

function pickAnswer(question, answer) {
  if (question.type === "noul") {
    const value = answer?.noul;
    if (!Number.isFinite(value)) throw new Error("jev-subagent-dispatch: noul answer is not numeric");
    return { value: clamp01(value) };
  }
  if (question.type === "score") {
    const value = answer?.score;
    if (!Number.isFinite(value)) throw new Error("jev-subagent-dispatch: score answer is not numeric");
    return {
      value: Math.max(0, value),
      legend: answer?.legend ?? null,
      probabilities: normalizeProbabilities(question, answer?.probabilities),
      confidence: numberOr(answer?.confidence, null),
    };
  }
  // choice: the selected option NAME (a criteria key), not an index.
  const value = answer?.choice;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("jev-subagent-dispatch: choice answer is not an option name");
  }
  const probabilities = normalizeProbabilities(question, answer?.probabilities);
  const selfProbability = probabilities && typeof probabilities === "object" && !Array.isArray(probabilities)
    ? probabilities[value]
    : undefined;
  return {
    value,
    probabilities,
    confidence: numberOr(answer?.confidence, Number.isFinite(selfProbability) ? selfProbability : null),
  };
}

/**
 * Pass probabilities through tolerantly: documented responses key them by
 * option/level name; an ordered array is mapped onto criteria order.
 */
function normalizeProbabilities(question, probabilities) {
  // Score responses key probabilities by POSITION — an ordered array, or an
  // object keyed by stringified indices ("0", "4"). Policies speak rubric
  // names ("infra"), so translate positions onto the configured level names;
  // unknown keys pass through unchanged.
  if (question.type === "score") {
    const names = (Array.isArray(question.criteria) ? question.criteria : []).map((entry) => String(entry).split(" — ")[0].trim());
    if (Array.isArray(probabilities)) {
      const out = {};
      names.forEach((name, index) => {
        out[name] = clamp01(numberOr(probabilities[index], 0));
      });
      return out;
    }
    if (probabilities && typeof probabilities === "object") {
      const out = {};
      for (const [key, value] of Object.entries(probabilities)) {
        if (!Number.isFinite(value)) continue;
        const position = Number.parseInt(key, 10);
        const name = String(Number.isInteger(position) && String(position) === key && position >= 0 && position < names.length ? names[position] : key);
        out[name] = clamp01(value);
      }
      // a level absent from the response carries no mass
      for (const name of names) out[name] ??= 0;
      return out;
    }
    return null;
  }
  if (Array.isArray(probabilities)) {
    const keys = Object.keys(question.criteria);
    const out = {};
    keys.forEach((key, index) => {
      out[key] = clamp01(numberOr(probabilities[index], 0));
    });
    return out;
  }
  if (probabilities && typeof probabilities === "object") {
    return Object.fromEntries(
      Object.entries(probabilities)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => [key, clamp01(value)]),
    );
  }
  return null;
}

const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * Keyword classifier for wiring tests. Deterministic; answers in the
 * documented shapes with fixed 0.9 confidence. NOT a real classifier.
 */
function mockAnswers(config, state) {
  const text = String(state).toLowerCase();
  const answers = {};
  for (const [id, question] of Object.entries(config.questions)) {
    if (question.type === "choice" && id === "task_class") {
      const keywordMap = {
        rename: "mechanical",
        format: "mechanical",
        typo: "mechanical",
        comment: "mechanical",
        docstring: "mechanical",
        boilerplate: "mechanical",
        research: "research",
        investigate: "research",
        redesign: "refactor",
        architecture: "feature_work",
        "what do you": "meta_chat",
      };
      let choice = "feature_work";
      for (const [word, value] of Object.entries(keywordMap)) {
        if (text.includes(word)) {
          choice = value;
          break;
        }
      }
      answers[id] = { value: choice, probabilities: null, confidence: 0.9 };
    } else if (question.type === "score" && id === "effort") {
      const score = text.includes("everywhere") || text.includes("all files") ? 1 : 0;
      answers[id] = { value: score, legend: null, probabilities: null, confidence: 0.9 };
    } else if (question.type === "score" && id === "blast_radius") {
      const score = text.includes("auth") || text.includes("api") || text.includes("migration") ? 2 : 1;
      answers[id] = { value: score, legend: null, probabilities: null, confidence: 0.9 };
    } else if (question.type === "noul") {
      const yes = id === "needs_repo_context" && text.includes("across");
      answers[id] = { value: yes ? 0.9 : 0.05 };
    }
  }
  return answers;
}
