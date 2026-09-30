/**
 * Browser half of dsh-jev-subagent-dispatch: claims the `jev-subagent-dispatch`
 * namespace on the Plugins settings tab through the keyed `settings.plugin.item`
 * slot. Only framework services (`slots`, `locale`, `settingsScope`) and its own
 * components are used — no DSH client package imports as values — so if a
 * future platform drops the settings UI the fiber simply never fires and
 * nothing throws.
 */
import * as React from 'react'
import { JevSettingsCard } from './JevSettingsCard.js'
import { bindTranslator, notifyLocale } from './i18n.js'
import { en, zh, ru } from './locales.js'

const NS = 'jev-subagent-dispatch'

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

export function apply(ctx: any) {
  wireLocale(ctx)
  ctx.inject(['settingsScope'], (c: any) => {
    try {
      const scope = c.settingsScope.bind({ namespace: NS })
      c.slots.inject('settings.plugin.item', () =>
        c.slots.register({ name: 'settings.plugin.item', key: NS, id: 'jev-subagent-dispatch', order: 30 }, () =>
          React.createElement(JevSettingsCard, { scope }),
        ),
      )
    } catch {
      // Binding anomalies must never break the settings page itself.
    }
  })
}

export default apply
