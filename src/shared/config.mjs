/**
 * Configuration vocabulary shared by the host and browser halves.
 *
 * The host bridge merges settings-section edits over the raw row input, and
 * the browser card renders this same field metadata. Keeping both halves on
 * one table means a field can never drift between the form that writes it and
 * the plugin that reads it.
 *
 * Dependency-free and side-effect-free on purpose: the host imports it with a
 * plain `import`, and esbuild inlines it into the browser bundle.
 *
 * @module dsh-jev-subagent-dispatch/config
 */

/** Settings namespace owned by this plugin. */
export const SETTINGS_NAMESPACE = 'jev-subagent-dispatch'

/** Cordis plugin name, Loader row id, and settings-section name. */
export const PLUGIN_NAME = 'jev-subagent-dispatch'

/** npm package name this plugin ships as. */
export const PACKAGE_NAME = 'dsh-jev-subagent-dispatch'

/**
 * Key the browser half registers the row's configuration page under.
 *
 * DSH 0.1.7+ keys `plugins.row.config` by `<package name>#<row id>`, and this
 * plugin's row id is its cordis plugin name. 0.1.5 keys the old
 * `settings.plugin.item` by the settings namespace instead; both are derived
 * here so the two halves cannot disagree about which entry they own.
 */
export const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${PLUGIN_NAME}`

/** Activation modes. `off` classifies nothing; the listener stays quiet. */
export const MODES = ['off', 'once', 'auto']

/** Provider presets: preset id → the fields selecting it implies. */
export const PROVIDER_PRESETS = {
  bai: { endpoint: 'https://api.b.ai', apiPath: '/v1/decisions', apiKeyEnv: 'OPENROUTER_API_KEY', model: 'jev-1.13.0' },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1', apiPath: '/systemone', apiKeyEnv: 'OPENROUTER_API_KEY', model: 'jev-1.13' },
  typesafe: { endpoint: 'https://api.typesafe.ai', apiPath: '/v1/systemone', apiKeyEnv: 'TYPESAFE_API_KEY', model: 'jev-1.13.0' },
}

/**
 * The bare top-level fields the card edits. Deeper policy (profiles,
 * probabilityMax, routeFor, routes) stays a profile-patch surface for
 * power users; the card shows a read-only hint pointing there.
 */
export const CARD_FIELDS = [
  'mode',
  'provider',
  'endpoint',
  'apiPath',
  'apiKeyEnv',
  'model',
  'timeoutMs',
  'stateChars',
  'triggers',
  'logDir',
  'logTurnText',
  'activeProfile',
]
