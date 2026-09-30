/**
 * Browser half of dsh-jev-subagent-dispatch: registers the
 * `jev-subagent-dispatch` configuration card on whichever Plugins surface the
 * running client offers, without a version check.
 *
 * - DSH 0.1.7+ moved Plugins to a sidebar page (`dsh-client-ui-plugin-manager`)
 *   and keys row configuration by `<package name>#<row id>` on the
 *   `plugins.row.config` slot. The page owns the row's form and draws the title
 *   and crumb around it, and `ctx.configForms.get(NS)` is the scope the card
 *   binds — deliberately the same `getSnapshot`/`subscribe`/`set`/`unset` shape
 *   the old settings scope had, so the card itself did not have to change with
 *   the seam.
 * - DSH 0.1.5 keeps the Plugins settings tab and the `settings.plugin.item`
 *   slot, bound through `ctx.settingsScope.bind({ namespace: NS })`.
 *
 * Each surface is registered through its own `ctx.inject`, so a fiber fires
 * only where its service exists: 0.1.7 has no `settingsScope` and 0.1.5 has no
 * `configForms`. Only framework services (`slots`, `locale`, `configForms`,
 * `settingsScope`) and its own components are used — no DSH client package
 * imports as values — so if a future platform drops the settings UI the fiber
 * simply never fires and nothing throws.
 */
import * as React from 'react'
import { JevSettingsCard } from './JevSettingsCard.js'
import { bindTranslator, notifyLocale } from './i18n.js'
import { en, zh, ru } from './locales.js'
import { PACKAGE_NAME, PLUGIN_NAME, ROW_CONFIG_KEY, SETTINGS_NAMESPACE as NS, SUBAGENT_ALLOWLIST_NAMESPACE } from '../shared/config.mjs'

/** Register the copy dictionaries and bind the translator. */
function wireLocale(ctx: any): void {
  const locale = ctx.locale
  if (!locale) return
  try {
    ctx.effect(() => locale.register(NS, 'en', en))
    ctx.effect(() => locale.register(NS, 'zh', zh))
    ctx.effect(() => locale.register(NS, 'ru', ru))
    const hasRu = (locale.getSnapshot?.().locales ?? []).some((entry: { id: string }) => entry.id === 'ru')
    if (!hasRu) ctx.effect(() => locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }))
    const translate = locale.bind(NS)
    bindTranslator((key: string) => translate(key))
    // Re-render the mounted card when the active language changes.
    ctx.effect(() => locale.subscribe(() => notifyLocale()))
  } catch {
    // The i18n shim already renders English; a locale anomaly must not hide the card.
  }
}

export const name = 'dsh-jev-subagent-dispatch'
export const inject = ['slots', 'locale']

/**
 * DSH 0.1.7+ — the plugin manager page asks for this row's configuration.
 *
 * There are two keyed slots for the form, and the choice decides how many clicks
 * it is worth. `plugins.bundle.config`, keyed by package name, is what the shipped
 * bundles use: the page draws the section itself and the form is there the moment
 * the plugin page opens. `plugins.row.config`, keyed `<package>#<row id>`, instead
 * files the form on the row's own page, one click away behind a Configure control
 * in Components — correct, but not what anyone expects next to a shipped plugin.
 *
 * So we register the package slot as the primary surface and keep the row slot for
 * 0.1.7, which knows only that one. The page draws the title and crumb around the
 * form, so the card drops its own heading. `view: 'summary'` is the row's
 * one-liner, used only when the package carries no description of its own — this
 * package has one, so the page never asks, and returning nothing keeps a single
 * source for that line.
 *
 * @param ctx - the browser plugin context.
 */
function registerRowConfig(ctx: any): void {
  ctx.inject(['configForms'], (c: any) => {
    const card = (props: { view?: string }) =>
      props?.view === 'summary'
        ? null
        : React.createElement(JevSettingsCard, {
          scope: c.configForms.get(NS),
          // The Subagent allowlist lives in another plugin's namespace. Reading it
          // is what lets the route selects offer only models dispatch may use; if
          // that plugin is absent the scope simply reports nothing and the card
          // keeps its raw field.
          allowlist: c.configForms.get(SUBAGENT_ALLOWLIST_NAMESPACE),
          heading: false,
        })

    // Each surface is guarded on its own, so a loader that predates the package
    // slot still gets the row page instead of losing the form entirely.
    const register = () => {
      try {
        c.slots.inject('plugins.bundle.config', () =>
          c.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: NS }, card))
      } catch {
        // 0.1.7 declares no package-page slot; the row page below is the surface.
      }
      try {
        c.slots.inject('plugins.row.config', () =>
          c.slots.register({ name: 'plugins.row.config', key: ROW_CONFIG_KEY, locale: NS }, card))
      } catch {
        // A slot anomaly must never break the Plugins page itself.
      }
    }

    try {
      // `whileServed` keeps the registration alive only while the Host actually
      // serves our namespace, so a deployment that never composed us shows no
      // trace of the entry.
      if (typeof c.configForms?.whileServed === 'function') {
        c.effect(() => c.configForms.whileServed([NS], register), 'jev-subagent-dispatch: settings page')
      } else {
        register()
      }
    } catch {
      // A slot anomaly must never break the Plugins page itself.
    }
  })
}

/**
 * DSH 0.1.5 — the Plugins settings tab, keyed by the settings namespace the host
 * registered imperatively with `ctx.settings.installSection`.
 *
 * @param ctx - the browser plugin context.
 */
function registerSettingsItem(ctx: any): void {
  ctx.inject(['settingsScope'], (c: any) => {
    try {
      const scope = c.settingsScope.bind({ namespace: NS })
      c.slots.inject('settings.plugin.item', () =>
        c.slots.register({ name: 'settings.plugin.item', key: NS, id: PLUGIN_NAME, order: 30 }, () =>
          React.createElement(JevSettingsCard, { scope }),
        ),
      )
    } catch {
      // Binding anomalies must never break the settings page itself.
    }
  })
}

/**
 * Client entry point.
 *
 * Deliberately NO `export default`: the client module system resolves the
 * plugin from the module namespace, and a default export makes it treat the
 * bare `apply` function as the plugin — which loses `inject`, so the first
 * `ctx.locale` read fails the fiber with "cannot get property ... without
 * inject". The named exports are the contract (mirrors the proven reference).
 */
export function apply(ctx: any) {
  wireLocale(ctx)
  registerRowConfig(ctx)
  registerSettingsItem(ctx)
}
