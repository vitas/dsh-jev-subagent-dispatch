/**
 * `dsh-jev-subagent-dispatch` — runtime capability checks.
 *
 * A dispatch recommendation is only worth a Jev call when the agent can
 * actually delegate. DSH needs three pieces for that: a delegation tool
 * visible to THIS agent, the subagent service (with its provider) behind
 * it, and remaining delegation depth — a depth limit of 0 disables
 * delegation entirely. None of that is implied by this plugin being
 * installed, so every routing request re-verifies it at request time
 * against the live services; session or setup changes take effect on the
 * next turn without a restart.
 *
 * The model-selection policy is also read here: when it is off, the subagent
 * tool takes no model argument and the recommendation must not name one
 * (the session's configured child default applies); when it is on, a named
 * route is only recommended if the session's allowlist contains it.
 *
 * @module dsh-jev-subagent-dispatch/capabilities
 */

/** The delegation tools DSH composes, and the subagent provider behind each. */
export const DELEGATION_TOOLS = [
  { toolName: "subagent", provider: "spawn" },
  { toolName: "subagent_fork", provider: "fork" },
];

/**
 * Read an agent's delegation depth the same way the subagent service does:
 * the persisted session header is the monotone floor, runtime options may
 * deepen it. Absence means top-level depth zero.
 * @param agent - the agent whose header and options carry the depth.
 * @returns its non-negative depth.
 */
export function delegationDepthOf(agent) {
  const runtime = agent?.options?.subagentDepth;
  return Math.max(agent?.session?.header?.delegationDepth ?? 0, Number.isFinite(runtime) ? runtime : 0);
}

function tryCall(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Verify this agent can delegate before any Jev call is made.
 * @param services - `{ tools, subagents, sessionProjections }` as resolved
 *   from the host at request time (each may be undefined).
 * @param agent - the agent asking for the routing verdict.
 * @returns `{ ok, missing, routePolicy, toolName }` where `routePolicy` is
 *   `"named"` (allowlist present — a named route may be checked against it),
 *   `"fixed"` (model selection off — recommend the child default without
 *   naming a model), or `"unknown"` (policy unreadable).
 */
export function checkDispatchCapabilities(services, agent) {
  const { tools, subagents, sessionProjections } = services ?? {};
  const missing = [];

  const visible = DELEGATION_TOOLS.filter(({ toolName }) => (
    tools?.get !== undefined && tryCall(() => tools.get(toolName, agent)) !== undefined
  ));
  if (visible.length === 0) {
    missing.push("no delegation tool is visible to this agent (the subagent service is not installed, or its tools are disabled for this session)");
  }

  if (subagents === undefined) {
    missing.push("the subagent service is unavailable");
  } else {
    const providerName = visible[0]?.provider;
    if (providerName !== undefined && tryCall(() => subagents.getProvider(providerName)) === undefined) {
      missing.push(`subagent provider "${providerName}" is unavailable`);
    }
    const maxDepth = tryCall(() => subagents.resolveMaxDepth());
    const depth = delegationDepthOf(agent);
    if (Number.isFinite(maxDepth) && depth + 1 > maxDepth) {
      missing.push(`delegation depth is exhausted (this agent is at depth ${depth}, limit ${maxDepth})`);
    }
  }

  // Policy semantics per dsh-tool-subagent: a recorded projection holds the
  // session's allowlist (model selection on); an absent or null state means
  // the fixed-route definition (model selection off, the tool takes no model
  // argument). An unreadable registry is "unknown" — never guess a model.
  let routePolicy = "unknown";
  if (sessionProjections?.stateOf !== undefined) {
    try {
      const policy = sessionProjections.stateOf(agent?.session, "subagentModelSelectionPolicy");
      routePolicy = Array.isArray(policy) ? "named" : "fixed";
    } catch {
      routePolicy = "unknown";
    }
  }

  return { ok: missing.length === 0, missing, routePolicy, toolName: visible[0]?.toolName ?? null };
}

/**
 * Turn the policy verdict for a chosen route into rendering advice.
 * @param routePolicy - from {@link checkDispatchCapabilities}.
 * @param route - the configured route `{ provider, model }` for the role.
 * @param policyRoutes - the session allowlist when `routePolicy` is `"named"`.
 * @returns `{ kind: "named", route } | { kind: "child-default" } |
 *   { kind: "allowlist", route }`.
 */
export function routeAdviceFor(routePolicy, route, policyRoutes) {
  if (routePolicy === "named") {
    const allowed = Array.isArray(policyRoutes)
      && policyRoutes.some((candidate) => candidate?.provider === route?.provider && candidate?.model === route?.model);
    return allowed ? { kind: "named", route } : { kind: "allowlist", route };
  }
  if (routePolicy === "fixed") return { kind: "child-default" };
  return { kind: "allowlist", route };
}
