/**
 * `dsh-jev-subagent-dispatch` — host half.
 *
 * A pre-step router for DeepSeek Harness: when asked (explicitly, or on
 * every turn in `auto` mode) it asks TypeSafe's System One model (Jev) a
 * set of atomic questions about the user's task, applies the active
 * profile's declarative policy, and — only when the verdict clears the
 * confidence gates — appends a source-attributed user message recommending
 * which subagent model route should take the turn. Everything is fail-open:
 * a slow, failing, or unconfigured router must never break or delay a turn
 * beyond its own timeout.
 *
 * The plugin owns no delegation machinery of its own. The routes it
 * recommends mirror the allowlist configured in Settings → Subagent
 * ("Models agents may choose"); the harness's native `subagent` tool does
 * the actual spawning. The injection is advice the agent may weigh and
 * ignore — measure it via the verdict log before trusting it.
 *
 * Dispatch capability is a prerequisite, checked at request time against
 * the live host services: a delegation tool visible to this agent, the
 * subagent service behind it, and remaining delegation depth. When the
 * check fails, explicit requests get a diagnostic saying what is missing;
 * ordinary turns stay silent and make no API call.
 *
 * Privacy posture: the state sent to TypeSafe is the redacted user turn
 * plus the workspace path, capped to `stateChars`. Credential-shaped
 * strings are replaced before anything leaves the machine. In `once` mode
 * nothing is shared at all unless the user asks for a verdict. Logging is
 * opt-in (`logDir`), and the user's turn text reaches the log only when
 * `logTurnText` is true.
 *
 * @module dsh-jev-subagent-dispatch
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLUGIN_NAME, PLUGIN_SOURCE_KIND, resolveConfig } from "./config.mjs";
import { checkDispatchCapabilities, routeAdviceFor } from "./capabilities.mjs";
import { classify } from "./jev.mjs";
import { buildState, decide, findTrigger, redact, renderUnavailableMessage, renderVerdictMessage } from "./verdict.mjs";

export const name = PLUGIN_NAME;

/**
 * Build a DSH user message via the pinned peer (`@deepseek-ai/dsh-llm`),
 * which owns message invariants including identity. Returns null when the
 * peer is unreachable (a bare checkout): the caller then SKIPS the
 * injection rather than fabricating a message that might violate the
 * session's format contract.
 */
async function pluginMessage(content) {
  try {
    const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
    return createUserMessage({
      content: [{ type: "text", text: content }],
      source: { kind: PLUGIN_SOURCE_KIND, plugin: PLUGIN_NAME },
    });
  } catch {
    return null;
  }
}

/** Whether logging is configured on (a non-empty directory path). */
function loggingEnabled(config) {
  return typeof config.logDir === "string" && config.logDir.length > 0;
}

/** Fire-and-forget NDJSON append; a logging failure is a warn, never a throw. */
async function logVerdict(logDir, record, logger) {
  try {
    await mkdir(logDir, { recursive: true });
    await appendFile(join(logDir, "verdicts.ndjson"), `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    logger?.warn?.(`jev-subagent-dispatch: log write failed: ${String(error)}`);
  }
}

/** Pull redacted text out of the claimed messages for the log (bounded). */
function summarizeMessages(messages, config) {
  const text = (messages ?? [])
    .map((message) => (Array.isArray(message?.content)
      ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join(" ")
      : String(message?.content ?? "")))
    .join(" | ");
  return redact(text.slice(0, 300), config.redactPatterns);
}

/**
 * Cordis plugin entry.
 * @param ctx - host context.
 * @param input - the `jev-subagent-dispatch` row's `config`.
 * @param deps - optional dependency overrides for tests.
 */
export function apply(ctx, input = {}, deps = {}) {
  const { pluginMessage: buildMessage = pluginMessage } = deps;
  let config;
  try {
    config = resolveConfig(input);
  } catch (error) {
    // A broken config must be loud but must not take the host down: keep the
    // plugin inert and log at error level on every boot.
    ctx.logger.error(String(error));
    return;
  }
  const logDir = loggingEnabled(config) ? config.logDir : null;
  const logger = ctx.logger;
  let warnedNoFactory = false;

  if (config.mode === "off") {
    // Opt-in starting point: register nothing, share nothing.
    ctx.logger.info("jev-subagent-dispatch: mode off; not listening");
    return;
  }

  // prepend: this listener runs after downstream listeners have produced
  // their decision, so it sees the final claimed batch and appends its
  // message last — the same etiquette the memory plugins use, so the
  // routing verdict sits below recall context in the turn.
  ctx.on("agent/pre-step", async ({ agent, messages, signal }, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== "enter" || signal?.aborted) return decision;
      if (config.skipSubagentSessions && agent?.session?.header?.origin === "subagent") return decision;

      const trigger = findTrigger(decision.messages, config);
      // mode "once": only explicit /route / /jev requests classify — one
      // call per request, everything else passes through untouched.
      if (config.mode === "once" && trigger === null) return decision;

      // Runtime capability gate, re-evaluated at request time: delegation
      // needs a visible delegation tool, the subagent service behind it,
      // and remaining depth — none of which this plugin's install implies.
      const services = deps.services ?? {
        tools: ctx.get("tools"),
        subagents: ctx.get("subagents"),
        sessionProjections: ctx.get("sessionProjections"),
      };
      const capabilities = checkDispatchCapabilities(services, agent);
      if (!capabilities.ok) {
        // Ordinary turns stay completely silent — no injection, no call, no
        // log spam. Only an explicit request gets a diagnostic (and a log
        // line) saying what is missing.
        if (trigger === null) return decision;
        const reason = capabilities.missing.join("; ");
        if (logDir !== null) {
          await logVerdict(logDir, {
            at: new Date().toISOString(),
            session: agent?.session?.id ?? null,
            mode: config.mode,
            trigger: trigger?.action ?? null,
            action: "unavailable",
            reason,
          }, logger);
        }
        logger.info?.(`jev-subagent-dispatch: dispatch unavailable — ${reason}`);
        const addition = await buildMessage(renderUnavailableMessage(capabilities.missing));
        return addition === null ? decision : { ...decision, messages: [...decision.messages, addition] };
      }

      const state = buildState(decision.messages, agent?.cwd ?? process.cwd(), config.stateChars, config.redactPatterns, trigger?.task ?? "");
      if (state === "") return decision; // nothing user-authored to route

      let outcome;
      try {
        const verdict = await classify(config, state, logger);
        outcome = decide(verdict, config);
      } catch (error) {
        // Fail-open: a timeout, a 429, a missing key — the turn proceeds
        // unrouted and the reason lands in the log.
        outcome = { action: "error", reason: String(error?.message ?? error) };
      }

      if (logDir !== null) {
        await logVerdict(logDir, {
          at: new Date().toISOString(),
          session: agent?.session?.id ?? null,
          mode: config.mode,
          trigger: trigger?.action ?? null,
          ...(config.logTurnText ? { turn: summarizeMessages(decision.messages, config) } : {}),
          action: outcome.action,
          reason: outcome.reason ?? null,
          confidence: outcome.confidence ?? null,
          route: outcome.route ?? null,
          role: outcome.role ?? null,
          model: outcome.model ?? null,
          usage: outcome.usage ?? null,
          latencyMs: outcome.latencyMs ?? null,
          answers: outcome.answers ?? null,
        }, logger);
      }

      if (outcome.action !== "delegate") {
        logger.info?.(`jev-subagent-dispatch: skip — ${outcome.reason}`);
        return decision;
      }
      logger.info?.(`jev-subagent-dispatch: recommend → ${outcome.role} (${outcome.route.provider}/${outcome.route.model}), confidence ${outcome.confidence.toFixed(2)}`);
      // The named route is only rendered when the session's model-selection
      // policy allows it; otherwise the recommendation defers to the child
      // default or the session allowlist. Re-read at request time.
      const routeAdvice = routeAdviceFor(capabilities.routePolicy, outcome.route, capabilities.routePolicy === "named"
        ? services.sessionProjections?.stateOf?.(agent?.session, "subagentModelSelectionPolicy")
        : undefined);
      const addition = await buildMessage(renderVerdictMessage(outcome, config, { preview: trigger?.action === "preview", routeAdvice }));
      if (addition === null) {
        if (!warnedNoFactory) {
          warnedNoFactory = true;
          logger.warn?.("jev-subagent-dispatch: @deepseek-ai/dsh-llm is unavailable; skipping injection instead of fabricating a message");
        }
        return decision;
      }
      return { ...decision, messages: [...decision.messages, addition] };
    } catch (error) {
      logger.warn?.(`jev-subagent-dispatch: unexpected failure, turn proceeds unrouted — ${String(error)}`);
      return decision;
    }
  }, { prepend: true });
}

export default apply;
