/**
 * Host-side schema and settings bridge for dsh-jev-subagent-dispatch.
 *
 * Two settings models, decided by service injection and never by a version
 * sniff:
 *
 * - DSH 0.1.7+ dropped `ctx.settings.installSection` and made a plugin's
 *   settings section the `Config` of its own Loader row. This module exports
 *   the volatile {@link Config} the loader validates the row against; the
 *   settings service projects its volatile fields into the Plugins row page.
 * - DSH 0.1.5 has no `Config` convention: its settings tab is claimed
 *   imperatively through {@link installSettings} with the PLAIN schema and the
 *   same `setSource` freshness the card used before.
 *
 * Every field of the exported {@link Config} is `.volatile()` — that is what
 * makes the settings service build a form for this row at all (`volatileForm`
 * in dsh-settings), and what lets a UI or profile-patch edit of those fields
 * commit into the running fiber's live references without a plugin restart. A
 * schema with no volatile field is dropped from `describe` entirely: no
 * namespace, no Configure control, and `isVolatilePath` rejects every write.
 *
 * The marker is NOT free: a volatile field resolves from outside the local
 * document, so a bare schemastery call such as `schema({})` yields nothing for
 * it. The imperative `installSection` path resolves the section that way, so it
 * keeps the plain schema and 0.1.5 behaves exactly as it always did.
 *
 * Dependency-free apart from the optional schemastery peer, imported lazily so
 * a bare checkout still composes (the profile patch stays authoritative).
 */

import { MODES, PLUGIN_NAME, PROVIDER_PRESETS } from "../shared/config.mjs";
import { defaults } from "../../config.mjs";

/** Provider preset ids, in the order the schema accepts them. */
const PRESET_IDS = Object.keys(PROVIDER_PRESETS);

/**
 * The shipped defaults, taken from the resolver's own `defaults()` so the schema
 * and the runtime cannot drift apart.
 *
 * These have to be declared *here*, in the schema, because this is the only copy
 * of them the settings surface ever sees. A profile patch that addresses this row
 * by id replaces the row config the bundle layer inserted — the two do not merge —
 * so for anyone who has ever edited this plugin from the card, the row config is
 * exactly the handful of fields the card wrote. Everything else has to come back
 * from the schema, and a field declared `z.any()` with no default comes back
 * missing: the card then draws no route rows at all, and `triggers` (an array with
 * no default) materialises as `[]`.
 *
 * The endpoint group is deliberately left without defaults: an empty
 * `endpoint`/`apiPath`/`apiKeyEnv`/`model` means "use the provider preset", and
 * materialising one preset's values into the row would turn a provider choice into
 * a stale explicit override.
 *
 * @returns a fresh copy, so no two schema builds share mutable defaults.
 */
function shipped() {
  const d = defaults();
  return {
    activeProfile: d.activeProfile,
    triggers: structuredClone(d.triggers),
    questions: structuredClone(d.questions),
    profiles: structuredClone(d.profiles),
    routeFor: structuredClone(d.routeFor),
    defaultRoute: d.defaultRoute,
    routes: structuredClone(d.routes),
    delegationTools: structuredClone(d.delegationTools),
    includeFallbackLine: d.includeFallbackLine,
  };
}

/**
 * Build the row schema, optionally marking every field volatile.
 *
 * @param z - the schemastery module.
 * @param volatile - mark every field `.volatile()`.
 * @returns the object schema.
 */
function makeSchema(z, volatile) {
  /** Apply the volatile marker where the schema type supports it. */
  const mark = (schema) => (volatile && typeof schema.volatile === "function" ? schema.volatile() : schema);
  const d = shipped();
  return z.object({
    // --- card surface ----------------------------------------------------
    mode: mark(z.union(MODES.map((id) => z.const(id))).default("off")),
    provider: mark(z.union(PRESET_IDS.map((id) => z.const(id))).default("typesafe")),
    activeProfile: mark(z.string().default(d.activeProfile)),
    triggers: mark(z.array(z.string()).default(d.triggers)),
    stateChars: mark(z.number().step(1).min(200).max(8000).default(1200)),
    timeoutMs: mark(z.number().step(1).min(50).max(30000).default(900)),
    logDir: mark(z.string()),
    logTurnText: mark(z.boolean().default(false)),
    // Endpoint overrides for gateways a preset does not cover.
    endpoint: mark(z.string()),
    apiPath: mark(z.string()),
    apiKeyEnv: mark(z.string()),
    model: mark(z.string()),
    // --- profile-patch surface, carried through unchanged -----------------
    // Defaulted for the same reason as the card fields: the settings surface must
    // still describe a complete configuration after a patch has replaced the row's.
    mock: mark(z.boolean().default(false)),
    questions: mark(z.any().default(d.questions)),
    profiles: mark(z.any().default(d.profiles)),
    routeFor: mark(z.any().default(d.routeFor)),
    defaultRoute: mark(z.string().default(d.defaultRoute)),
    routes: mark(z.any().default(d.routes)),
    delegationTools: mark(z.any().default(d.delegationTools)),
    skipSubagentSessions: mark(z.boolean().default(true)),
    redactPatterns: mark(z.array(z.string())),
    includeFallbackLine: mark(z.boolean().default(d.includeFallbackLine)),
  });
}

/**
 * The two schemas, built once. Absent when schemastery does not resolve — a
 * bare development checkout without the peer still composes, with the
 * composition entry as the only configuration source.
 *
 * @returns `{ settings, config }`: the plain schema the imperative 0.1.5 path
 *   registers, and the volatile one the loader exposes as this row's `Config`.
 */
async function buildSchemas() {
  try {
    const { default: z } = await import("@deepseek-ai/schemastery");
    return { settings: makeSchema(z, false), config: makeSchema(z, true) };
  } catch {
    return { settings: undefined, config: undefined };
  }
}

/**
 * The row's Config schema, which the loader applies to `config` before `apply`.
 *
 * DSH 0.1.7 dropped `ctx.settings.installSection` and made a plugin's settings
 * section the Config of its own Loader row: the loader validates the row's
 * configuration against this export, and the settings service projects it into
 * a form the Plugins page renders. Without it a row has no schema, so the
 * settings service has no section for it and every user override is rejected —
 * the plugin silently keeps the composition entry's values.
 *
 * 0.1.5 has no such convention, so `installSettings` below still registers the
 * same fields imperatively and both versions stay configured. Cordis treats a
 * missing Config as "no schema", so the peer-less checkout composes exactly as
 * it did before.
 */
const SCHEMAS = await buildSchemas();

/** The volatile schema the loader exposes as this row's Config. */
export const Config = SCHEMAS.config;

/**
 * Read one resolved config field.
 *
 * DSH 0.1.7 hands a volatile field over as a live accessor rather than a value.
 * Reading that accessor as a scalar yields the accessor object itself, which
 * then looks like an absent field, so every row silently falls back to the
 * schema defaults and the user's own configuration never reaches the router —
 * which is exactly what happened to this plugin before the unwrapping was
 * added. 0.1.5 hands over plain values, so this is a no-op there. Reading
 * through the accessor on every call is also what makes a settings edit reach
 * the next turn without a restart.
 *
 * @param value - one field of the loader-resolved config.
 * @returns the current value behind it.
 */
export function readField(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
}

/** Project a whole resolved config through {@link readField}. */
export function readConfig(config) {
  if (config === null || typeof config !== "object") return {};
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, readField(value)]));
}

/**
 * Register the settings section on 0.1.5, where the seam still exists.
 *
 * DSH 0.1.7 replaced this seam: a plugin's settings section is now its own
 * Loader row's Config, which the loader already applied to the row config
 * before `apply` ran, so the missing method is the signal to stop — registering
 * there would be wrong rather than redundant.
 *
 * @param ctx - host cordis context (the plugin context `apply` received).
 * @param options - `{ baseInput, resolveConfig, logger, setSource }`.
 *   `baseInput` is the RAW row input the framework starts the section from
 *   (so a section edit arrives merged over the base layer, keeping patch-only
 *   fields intact); `setSource` receives a function returning the fully
 *   resolved configuration the live listener should read next.
 * @returns a detach function, or null when the seam is unavailable.
 */
export function installSettings(ctx, options = {}) {
  if (typeof ctx?.inject !== "function") return null;
  const { baseInput, resolveConfig, logger, setSource } = options;
  let detach = null;
  try {
    ctx.inject(["settings"], (settingsCtx) => {
      if (typeof settingsCtx?.settings?.installSection !== "function") return;
      // A volatile schema resolves to accessor objects and would break this
      // imperative path, so the plain one is used here.
      if (SCHEMAS.settings === undefined) return;
      const base = { ...(baseInput ?? {}) };
      settingsCtx.settings.installSection(ctx, PLUGIN_NAME, SCHEMAS.settings, base, {
        setSource: (source) => {
          // The framework hands the updated section through `source` — a
          // function on the installed seam, a plain object in tests.
          let section;
          try {
            section = typeof source === "function" ? source() : source;
          } catch {
            return;
          }
          try {
            // Section-over-RAW-BASE, never over resolved defaults: the section
            // carries only card fields, so merging it over resolved defaults
            // would silently reset patch-only fields (mock, questions,
            // profiles) to their boot values.
            const next = resolveConfig({ ...base, ...readConfig(section) });
            setSource?.(() => next);
            logger?.info?.(`${PLUGIN_NAME}: settings updated from UI (mode: ${next.mode})`);
          } catch (error) {
            // A rejected patch keeps the previous good config.
            logger?.warn?.(`${PLUGIN_NAME}: UI config rejected, keeping previous: ${String(error?.message ?? error)}`);
          }
        },
        onChange: () => {},
      });
      detach = () => {};
    });
  } catch {
    return null;
  }
  return detach;
}
