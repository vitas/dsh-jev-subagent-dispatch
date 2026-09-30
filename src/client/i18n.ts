/**
 * Translation shim. Components call `tr(key)`; the active translator is bound
 * to DSH's locale service during apply (see index.tsx). If the locale service
 * is absent, everything keeps rendering in English from the dictionary instead
 * of failing.
 */
import { en, type CopyKey } from './locales.js'

export type Translator = (key: CopyKey) => string

let active: Translator = (key) => String((en as Record<string, string>)[key] ?? key)

/** Install the bound translate function (called once from apply). */
export function bindTranslator(translate: Translator): void {
  active = translate
}

/** Translate a copy key at render time; reads whatever locale is active now. */
export const tr: Translator = (key) => active(key)

/** Language-change signal: components re-render when the language flips. */
const listeners = new Set<() => void>()
let version = 0

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function localeRevision(): number {
  return version
}

/** Bump on language change (called from apply's locale subscription). */
export function notifyLocale(): void {
  version += 1
  for (const listener of listeners) listener()
}
