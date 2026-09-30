/**
 * `dsh-jev-subagent-dispatch` — configuration resolution.
 *
 * The single configuration source is the plugin row's `config` (the bundle
 * patch ships defaults; the user's profile patch overrides the same row by
 * id). On DSH 0.1.7+ an edit through the Plugins row page or the profile patch
 * reaches the live listener without a restart, because the row's volatile
 * `Config` fields are handed to `apply` as live accessors and re-read every
 * turn; on 0.1.5 the settings bridge supplies the same freshness.
 *
 * The `questions` map mirrors TypeSafe's documented request shape exactly
 * (map keyed by question id; each entry carries `type`, `instructions`,
 * `criteria`) so what is configured is what goes on the wire — no
 * transformation step to drift. Merging is per question id: overriding one
 * question replaces that whole entry, the others keep their defaults.
 *
 * @module dsh-jev-subagent-dispatch/config
 */

export const PLUGIN_NAME = "jev-subagent-dispatch";
export const PLUGIN_SOURCE_KIND = `plugin:${PLUGIN_NAME}`;

/** Deep-merge plain objects; arrays, maps keyed by id, and scalars replace. */
export function mergeDefaults(defaults, input) {
  if (input === undefined || input === null) return structuredClone(defaults);
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)
    || typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const out = { ...defaults };
  for (const [key, value] of Object.entries(input)) {
    out[key] = key in defaults ? mergeDefaults(defaults[key], value) : value;
  }
  return out;
}

/** Merge a defaults map and an input map one level deep, by key. */
function mergeMaps(defaultsMap, inputMap) {
  return { ...structuredClone(defaultsMap ?? {}), ...(inputMap ?? {}) };
}

/**
 * The rubric in TypeSafe's documented request format. Choice `criteria` is a
 * map of option name → description; Score `criteria` is an ordered array of
 * level descriptions (positions 0..n, the score may land between two);
 * Noul takes optional `criteria: { true, false }`.
 */
export const DEFAULT_QUESTIONS = {
  task_class: {
    type: "choice",
    instructions: "Which class does this coding task fall into?",
    criteria: {
      mechanical:
        "Rename, reformat, boilerplate, comments or docstrings — mechanical edits with an unambiguous spec.",
      bugfix:
        "Fix a failing thing whose cause is understood; the fix itself is contained.",
      feature_work:
        "Add behavior that changes what the product does.",
      refactor:
        "Restructure code without changing behavior; design decisions involved.",
      research:
        "Gather facts, read code, compare options; change nothing.",
      meta_chat:
        "Conversation, questions, or planning; no code task in this turn.",
    },
  },
  effort: {
    type: "score",
    instructions: "How much work is this task?",
    criteria: [
      "S — one file, minutes of work",
      "M — a few files, contained; an hour or two",
      "L — many files or a full day of work",
      "XL — multiple days, cross-cutting design work",
    ],
  },
  blast_radius: {
    type: "score",
    instructions:
      "If this task is done wrong, what is the worst credible consequence?",
    criteria: [
      "trivial — nothing of consequence can break",
      "module — one internal module misbehaves",
      "cross_module — several internal modules misbehave",
      "public_api — published interfaces, schemas, or user-visible behavior break",
      "infra — build, CI, credentials, data, or production systems break",
    ],
  },
  needs_repo_context: {
    type: "noul",
    instructions:
      "Doing this task well requires reading and reconciling several modules of this repository, not just the named files.",
  },
  user_explicit: {
    type: "noul",
    instructions:
      "The user explicitly asked the main agent to do this task itself or to plan first, rather than just get it done.",
    criteria: {
      true:
        "The user addressed the main agent directly: “you do it”, “plan first”, “stay in this session”.",
      false:
        "The user just wants the outcome; who does the work is unspecified.",
    },
  },
  risky: {
    type: "noul",
    instructions:
      "The task touches secrets, credentials, data migrations, infrastructure, or destructive operations.",
    criteria: {
      true:
        "Credentials, production data, migrations, deploy scripts, or irreversible operations are in play.",
      false:
        "Ordinary code changes only.",
    },
  },
};

/**
 * Rubric level names for a question, in order: for score questions the part
 * of each criteria entry before the " — " description separator; for choice
 * questions the criteria keys; noul has no levels.
 * (string names, or structured objects — object levels are addressed by their numeric index)
 * @param question - a configured question definition.
 * @returns the ordered level names (empty for noul).
 */
export function criteriaLevelNames(question) {
  if (!question || question.type === "noul") return [];
  if (question.type === "choice") return Object.keys(question.criteria ?? {});
  return (Array.isArray(question.criteria) ? question.criteria : [])
    .map((entry, index) => (
      typeof entry === "string" ? entry.split(" — ")[0].trim() : String(index)
    ));
}

/**
 * The delegation tools DSH composes by default, and the subagent provider
 * behind each. A preset that configures a custom `toolName` (the harness
 * permits it) must override this list, or the capability check cannot see
 * the working tool.
 */
export const DEFAULT_DELEGATION_TOOLS = [
  { toolName: "subagent", provider: "spawn" },
  { toolName: "subagent_fork", provider: "fork" },
];

export const DEFAULT_PROFILES = {
  auto: {
    confidenceMin: 0.7,
    delegate: {
      taskClass: ["mechanical", "bugfix", "research"],
      effortMax: 1.5,
      blastRadiusMax: 1.5,
      maxNoul: { needs_repo_context: 0.5, user_explicit: 0.3, risky: 0.2 },
      // Cap the PROBABILITY of a severe outcome, not only the average score:
      // a low average blast radius can still carry a meaningful chance of an
      // infra-level result. Jev supplies per-level probabilities for score
      // answers; this map is questionId → { levelName: maxProbability }.
      probabilityMax: {},
    },
  },
  careful: {
    confidenceMin: 0.85,
    delegate: {
      taskClass: ["mechanical"],
      effortMax: 0.5,
      blastRadiusMax: 0.5,
      maxNoul: { needs_repo_context: 0.2, user_explicit: 0.1, risky: 0.05 },
    },
  },
};

export const DEFAULT_ROUTES = {
  implementer: { provider: "openrouter", model: "deepseek-v4-flash" },
  researcher: { provider: "openrouter", model: "qwen3.8-flash" },
};

/** Credential-shaped strings never leave the machine (or reach the log). */
export const BUILT_IN_REDACT_PATTERNS = [
  String.raw`\bsk-[A-Za-z0-9_-]{16,}\b`,
  String.raw`\bpk_(?:live|test)_[A-Za-z0-9_-]{16,}\b`,
  String.raw`\bghp_[A-Za-z0-9]{20,}\b`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}\b`,
  String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\bBearer\s+[A-Za-z0-9._-]{10,}`,
  String.raw`\b(?:api[_-]?key|apikey|token|secret|password|passwd|pwd)\s*[=:]\s*\S+`,
  String.raw`\b(?=[A-Za-z0-9+/_-]{40,})(?=[A-Za-z0-9+/_-]*[0-9])(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]+(?:={0,2})\b`,
];

/**
 * Where Jev access comes from. The key's issuer determines the endpoint,
 * the API path, the credential variable, and the pinned model id. One
 * shared question format and routing policy sits on top; the provider
 * preset only swaps the wire address and model. Explicit `endpoint`,
 * `apiPath`, `apiKeyEnv`, and `model` values in the row config override the
 * preset.
 */
export const PROVIDER_PRESETS = {
  typesafe: {
    endpoint: "https://api.typesafe.ai",
    apiPath: "/v1/systemone",
    apiKeyEnv: "TYPESAFE_API_KEY",
    model: "jev-1.13.0",
  },
  bai: {
    endpoint: "https://api.b.ai",
    apiPath: "/v1/decisions",
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: "jev-1.13.0",
  },
  openrouter: {
    endpoint: "https://openrouter.ai",
    apiPath: "/api/v1/systemone",
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: "jev-1.13",
  },
};

export function defaults() {
  return {
    // Activation model. `off` (default) registers nothing — the plugin is
    // inert. `once` registers the pre-step listener but classifies ONLY
    // turns that explicitly ask for it (a `/route` / `/jev` trigger): one
    // call per request, predictable cost and data sharing. `auto`
    // classifies every plain user turn — enable it only when the verdict
    // log has earned it.
    mode: "off",
    provider: "typesafe",
    endpoint: "https://api.typesafe.ai",
    apiPath: "/v1/systemone",
    apiKeyEnv: "TYPESAFE_API_KEY",
    model: "jev-1.13.0",
    timeoutMs: 900,
    stateChars: 1200,
    mock: false,
    questions: structuredClone(DEFAULT_QUESTIONS),
    activeProfile: "auto",
    profiles: structuredClone(DEFAULT_PROFILES),
    routeFor: { mechanical: "implementer", bugfix: "implementer", research: "researcher" },
    defaultRoute: "implementer",
    routes: structuredClone(DEFAULT_ROUTES),
    // Turn triggers for `once` mode (and preview requests in `auto`).
    triggers: ["/route", "/jev"],
    skipSubagentSessions: true,
    // Opt-in observability: null or "" turns logging OFF. When enabled, the
    // user's turn text is still excluded unless logTurnText is true.
    logDir: null,
    logTurnText: false,
  delegationTools: structuredClone(DEFAULT_DELEGATION_TOOLS),
    redactPatterns: [],
    includeFallbackLine: true,
  };
}

const QUESTION_TYPES = new Set(["choice", "score", "noul"]);
const ID_PATTERN = /^[a-z][a-z0-9_]*$/i;

function validCriteriaEntry(entry) {
  return typeof entry === "string"
    || (typeof entry === "object" && entry !== null && !Array.isArray(entry));
}

/**
 * Validate the merged configuration. Throws with a human message on the
 * first structural problem; a broken config must fail loudly at
 * composition, not silently mis-route turns.
 * @param config - merged configuration object.
 * @returns the same object, validated.
 */
export function validate(config) {
  const where = "jev-subagent-dispatch config";
  if (!["off", "once", "auto"].includes(config.mode)) {
    throw new Error(`${where}: mode must be one of off, once, auto`);
  }
  if (!Array.isArray(config.triggers) || config.triggers.length === 0
    || !config.triggers.every((t) => typeof t === "string" && t.startsWith("/"))) {
    throw new Error(`${where}: triggers must be a non-empty array of "/command" strings`);
  }
  if (typeof config.provider !== "string" || !PROVIDER_PRESETS[config.provider]) {
    throw new Error(`${where}: provider must be one of ${Object.keys(PROVIDER_PRESETS).join(", ")}`);
  }
  if (typeof config.endpoint !== "string" || !/^https?:\/\//.test(config.endpoint)) {
    throw new Error(`${where}: endpoint must be an http(s) URL`);
  }
  if (typeof config.apiPath !== "string" || !config.apiPath.startsWith("/")) {
    throw new Error(`${where}: apiPath must be a path starting with "/"`);
  }
  if (typeof config.apiKeyEnv !== "string" || config.apiKeyEnv.length === 0) {
    throw new Error(`${where}: apiKeyEnv must name an environment variable`);
  }
  if (typeof config.model !== "string" || config.model.length === 0) {
    throw new Error(`${where}: model must be a TypeSafe model id or alias`);
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 50) {
    throw new Error(`${where}: timeoutMs must be a number >= 50`);
  }
  if (!Number.isFinite(config.stateChars) || config.stateChars < 100) {
    throw new Error(`${where}: stateChars must be a number >= 100`);
  }
  const questions = config.questions ?? {};
  if (typeof questions !== "object" || Array.isArray(questions) || Object.keys(questions).length === 0) {
    throw new Error(`${where}: questions must be a non-empty map of question id → question`);
  }
  for (const [id, question] of Object.entries(questions)) {
    if (!ID_PATTERN.test(id)) throw new Error(`${where}: question id "${id}" must match [a-z][a-z0-9_]*`);
    if (!QUESTION_TYPES.has(question?.type)) {
      throw new Error(`${where}: question "${id}" has unknown type "${question?.type}"`);
    }
    if (typeof question.instructions !== "string" || question.instructions.length === 0) {
      throw new Error(`${where}: question "${id}" needs instructions`);
    }
    if (question.type === "choice") {
      const criteria = question.criteria;
      if (typeof criteria !== "object" || criteria === null || Array.isArray(criteria)
        || Object.keys(criteria).length < 2
        || !Object.values(criteria).every(validCriteriaEntry)) {
        throw new Error(`${where}: choice question "${id}" needs a criteria map with at least two named options`);
      }
    }
    if (question.type === "score") {
      const criteria = question.criteria;
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10
        || !criteria.every(validCriteriaEntry)) {
        throw new Error(`${where}: score question "${id}" needs an ordered criteria array of 2..10 levels`);
      }
    }
    if (question.type === "noul" && question.criteria !== undefined) {
      const criteria = question.criteria;
      if (typeof criteria !== "object" || criteria === null || Array.isArray(criteria)
        || !validCriteriaEntry(criteria.true) || !validCriteriaEntry(criteria.false)) {
        throw new Error(`${where}: noul question "${id}" criteria must be { true, false } when present`);
      }
    }
  }
  const profiles = config.profiles ?? {};
  const active = config.activeProfile;
  if (typeof active !== "string" || typeof profiles[active] !== "object" || profiles[active] === null) {
    throw new Error(`${where}: activeProfile "${String(active)}" names no defined profile`);
  }
  for (const [name, profile] of Object.entries(profiles)) {
    const min = profile?.confidenceMin;
    if (!Number.isFinite(min) || min < 0 || min > 1) {
      throw new Error(`${where}: profile "${name}" needs confidenceMin in [0, 1]`);
    }
    const del = profile?.delegate;
    if (typeof del !== "object" || del === null) {
      throw new Error(`${where}: profile "${name}" needs a delegate predicate object`);
    }
    for (const key of ["effortMax", "blastRadiusMax"]) {
      if (del[key] !== undefined && (!Number.isFinite(del[key]) || del[key] < 0)) {
        throw new Error(`${where}: profile "${name}" ${key} must be a number >= 0 (score positions may be fractional)`);
      }
    }
    for (const [noulId, ceiling] of Object.entries(del.maxNoul ?? {})) {
      if (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > 1) {
        throw new Error(`${where}: profile "${name}" maxNoul.${noulId} must be in [0, 1]`);
      }
    }
    const probMax = del.probabilityMax ?? {};
    if (typeof probMax !== "object" || Array.isArray(probMax)) {
      throw new Error(`${where}: profile "${name}" probabilityMax must be an object keyed by question id`);
    }
    for (const [questionId, limits] of Object.entries(probMax)) {
      const question = config.questions?.[questionId];
      if (question?.type !== "score") {
        throw new Error(`${where}: profile "${name}" probabilityMax.${questionId} names no configured score question`);
      }
      if (typeof limits !== "object" || limits === null || Object.keys(limits).length === 0) {
        throw new Error(`${where}: profile "${name}" probabilityMax.${questionId} must map level names to probabilities`);
      }
      const names = criteriaLevelNames(question);
      for (const [level, max] of Object.entries(limits)) {
        if (!Number.isFinite(max) || max < 0 || max > 1) {
          throw new Error(`${where}: profile "${name}" probabilityMax.${questionId}.${level} must be in [0, 1]`);
        }
        // Accept rubric names ("infra"), tail sums ("public_api+" = that
        // level or worse), or numeric indices — nothing else.
        const bare = level.endsWith("+") ? level.slice(0, -1) : level;
        const index = /^\d+$/.test(bare) ? Number(bare) : names.indexOf(bare);
        if (index === -1 || index >= names.length) {
          throw new Error(`${where}: profile "${name}" probabilityMax.${questionId}.${level} is not in the rubric (${names.join("|")})`);
        }
      }
    }
  }
  const tools = config.delegationTools ?? [];
  if (!Array.isArray(tools) || tools.length === 0
    || tools.some((tool) => typeof tool?.toolName !== "string" || tool.toolName.length === 0
      || typeof tool?.provider !== "string" || tool.provider.length === 0)) {
    throw new Error(`${where}: delegationTools must list { toolName, provider } pairs`);
  }
  for (const [role, route] of Object.entries(config.routes ?? {})) {
    if (typeof route?.provider !== "string" || typeof route?.model !== "string"
      || route.provider.length === 0 || route.model.length === 0) {
      throw new Error(`${where}: routes.${role} needs non-empty provider and model`);
    }
  }
  if (typeof config.defaultRoute !== "string" || !(config.defaultRoute in (config.routes ?? {}))) {
    throw new Error(`${where}: defaultRoute "${String(config.defaultRoute)}" names no configured route`);
  }
  if (config.logDir !== null && config.logDir !== "" && typeof config.logDir !== "string") {
    throw new Error(`${where}: logDir must be a directory path, or null/"" to disable logging`);
  }
  if (typeof config.logTurnText !== "boolean") throw new Error(`${where}: logTurnText must be a boolean`);
  if (!Array.isArray(config.redactPatterns)) throw new Error(`${where}: redactPatterns must be an array of regex source strings`);
  return config;
}

/**
 * Merge the plugin row's `config` over the provider preset and the
 * defaults, and validate. The preset for `provider` supplies endpoint,
 * apiPath, apiKeyEnv, and model; explicit values in the row config win
 * over the preset. `questions` and `routes` merge per key (override one
 * entry, keep the rest); `profiles` deep-merges so a single threshold
 * tweak keeps the predicate; everything else follows ordinary deep-merge
 * rules.
 * @param input - the cordis row config (may be undefined).
 * @returns validated, fully-populated configuration.
 */
export function resolveConfig(input = {}) {
  const base = defaults();
  const provider = input?.provider ?? base.provider;
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) {
    throw new Error(`jev-subagent-dispatch config: provider must be one of ${Object.keys(PROVIDER_PRESETS).join(", ")}`);
  }
  const presetApplied = { ...structuredClone(base), provider, ...preset };
  const { questions, routes, ...rest } = input ?? {};
  const merged = mergeDefaults(presetApplied, rest);
  merged.questions = mergeMaps(presetApplied.questions, questions);
  merged.routes = mergeMaps(presetApplied.routes, routes);
  return validate(merged);
}
