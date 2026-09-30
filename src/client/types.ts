/**
 * The `jev-subagent-dispatch` fields this card edits. Deeper policy
 * (profiles, probabilityMax, routeFor, routes) intentionally stays a
 * profile-patch surface — the card links to it instead of faking it.
 */
export interface JevSettings {
  mode?: string
  provider?: string
  endpoint?: string
  apiPath?: string
  apiKeyEnv?: string
  model?: string
  timeoutMs?: number
  stateChars?: number
  triggers?: string[]
  logDir?: string
  logTurnText?: boolean
  activeProfile?: string
}

/** Minimal slice of the framework settings scope this card consumes. */
export interface JevScope {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: JevSettings | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable?: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}
