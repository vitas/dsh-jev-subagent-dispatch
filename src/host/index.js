/**
 * Host-side settings bridge for dsh-jev-subagent-dispatch.
 *
 * Installs a `jev-subagent-dispatch` settings section (schemastery schema +
 * the composition entry's config as the base layer) and mirrors every
 * section change back onto the row object the plugin's `apply()` closes
 * over, so a UI edit reaches the live listener without a host restart:
 *
 *   card `set` → settings section → onChange → Object.assign(row, resolveConfig(merged))
 *
 * The merged object is passed through the same `resolveConfig` the boot path
 * uses — validation, preset application, and profile normalization happen in
 * exactly one place. A rejected patch keeps the previous good config.
 *
 * Dependency-free apart from the optional schemastery peer, imported lazily
 * so a bare checkout still composes (the profile patch stays authoritative).
 */

/** Build the settings schema, or null when schemastery does not resolve. */
export async function buildSchema() {
  let z;
  try {
    ({ default: z } = await import("@deepseek-ai/schemastery"));
  } catch {
    return null;
  }
  const presets = Object.keys(PROVIDER_PRESETS_SHARED);
  return z.object({
    mode: z.union(MODES_SHARED.map((id) => z.const(id))).default("off"),
    provider: z.union(presets.map((id) => z.const(id))).default("bai"),
    endpoint: z.string(),
    apiPath: z.string(),
    apiKeyEnv: z.string(),
    model: z.string(),
    timeoutMs: z.number().step(1).min(50).max(30000).default(900),
    stateChars: z.number().step(1).min(200).max(8000).default(1200),
    triggers: z.array(z.string()),
    logDir: z.string(),
    logTurnText: z.boolean().default(false),
    activeProfile: z.string(),
  });
}

import { MODES as MODES_SHARED, PLUGIN_NAME, PROVIDER_PRESETS as PROVIDER_PRESETS_SHARED } from "../shared/config.mjs";

/**
 * Install the settings section and keep the row config in sync.
 * @param ctx - host cordis context (the plugin context `apply` received).
 * @param row - the row config object `apply()` closes over; mutated in place.
 * @param baseInput - the RAW row input `apply()` received. The framework
 *   starts the section from this same object, so a section edit already
 *   arrives merged over the base layer — the bridge re-resolves
 *   `{...baseInput, ...section}` to keep patch-only fields (questions,
 *   profiles, routes) intact while card fields update.
 * @param resolveConfig - the plugin's own `resolveConfig` for re-validation.
 * @param logger - host logger for diagnostics.
 * @returns a detach function, or null when the seam is unavailable.
 */
export function installSettings(ctx, row, baseInput, resolveConfig, logger) {
  if (typeof ctx?.inject !== "function") return null;
  let detach = null;
  try {
    ctx.inject(["settings"], (settingsCtx) => {
      if (!settingsCtx?.settings?.installSection) return;
      const base = { ...(baseInput ?? {}) };
      settingsCtx.settings.installSection(
        ctx,
        PLUGIN_NAME,
        buildSchema(),
        base,
        {
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
              // Section-over-RAW-BASE, never over resolved defaults: the
              // section carries only card fields, so merging it over
              // resolved defaults would silently reset patch-only fields
              // (mock, questions, profiles) to their boot values.
              const next = resolveConfig({ ...base, ...section });
              // Reuse the live row object: apply()'s closures read `config`.
              for (const key of Object.keys(row)) delete row[key];
              Object.assign(row, next);
              logger?.info?.(`${PLUGIN_NAME}: settings updated from UI (mode: ${next.mode})`);
            } catch (error) {
              // A rejected patch keeps the previous good config.
              logger?.warn?.(`${PLUGIN_NAME}: UI config rejected, keeping previous: ${String(error?.message ?? error)}`);
            }
          },
          onChange: () => {},
        },
      );
      detach = () => {};
    });
  } catch {
    return null;
  }
  return detach;
}
