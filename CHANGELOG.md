# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semantic versioning.

## [0.7.5] - 2026-09-30

### Fixed

- **A linked checkout dropped every injection in silence — the plugin could not
  work there at all.** The injected message is built with the harness's own
  `@deepseek-ai/dsh-llm`, which the plugin reached through a bare
  `import("@deepseek-ai/dsh-llm")` while declaring no dependency on it. Node
  resolves bare specifiers from the importing module's *real* path, and a plugin
  installed as a `link:` (a dev checkout, which is how this one is normally run)
  has no `node_modules` of its own — so the import failed with
  `ERR_MODULE_NOT_FOUND`, `pluginMessage` caught it and returned `null`, and every
  verdict *and* every diagnostic was discarded. Nothing reached the conversation in
  any mode, for any trigger, which made a working router indistinguishable from an
  unwired one — and made the 0.7.4 diagnostics invisible too.

  The factory is now resolved through the entry point of the running host (the
  same copy the host builds its own injections with, so message invariants hold),
  falling back to the bare import. `@deepseek-ai/dsh-llm` is declared as an
  optional peer. When no path resolves, the skip is reported once through the
  logger instead of being swallowed.

  Verified end to end: the same `/route` turn against a stand now lands one
  `user/message` with `source.kind: plugin:jev-subagent-dispatch` in the session
  transcript; before the fix that count was zero.

## [0.7.4] - 2026-09-30

### Fixed

- **A failed classification is no longer silent.** A timeout, a rejected key or an
  HTTP error was fail-open *and* mute: the turn proceeded unrouted and nothing
  reached the conversation, so an explicit `/route` that never got an answer looked
  identical to a plugin that was never wired up. An explicit trigger now gets a
  one-line diagnostic naming the failure. Ordinary turns stay silent in `auto` mode
  — a bad key must not write a diagnostic into every turn.
- **The key no longer has to be an environment variable.** It is resolved before
  every call: the credentials store first (the one the Models page writes, where an
  issuer key normally already lives), then `process.env`. Same precedence as the
  search plugin, so one stored key serves both. The field is labelled *Key
  reference* accordingly.
- **`timeoutMs` default was below a real answer.** A live decision against
  `api.b.ai/v1/decisions` took 1517 ms while the shipped budget was 900 ms, so every
  real classification quietly abandoned itself. The default is now 4000 ms.

### Changed

- The row schema takes every default from the resolver's own `defaults()`; the
  values are no longer repeated in the schema, so they cannot drift again.
- The npm tarball no longer carries `docs/`: README screenshots are absolute
  `raw.githubusercontent` URLs, so the in-tarball copies were dead weight
  (148 kB → 48 kB packed).

## [0.7.3] - 2026-09-30

### Fixed

- **The card could show an empty configuration.** A profile patch that addresses
  this plugin's row by id *replaces* the row config the bundle layer inserted —
  the two do not merge. So for anyone who had ever edited the plugin from the card,
  the stored row was the handful of fields the card wrote, and everything else was
  missing: no route rows at all (hence no model selects), and `triggers` collapsed
  to `[]`. The row's `Config` schema now declares the shipped defaults, so the
  settings surface always describes a complete configuration. A regression test
  builds the schema and asserts it.
- `Key environment variable` was a dropdown listing the *provider* ids — `bai`,
  `openrouter`, `typesafe` — where a variable name belongs. It is free text now,
  with the provider preset's variable name as its placeholder.
- `Endpoint`, `API path` and `Model` showed as blank when they were inherited from
  the provider preset. They now show the inherited value as a placeholder, because
  empty there means "take it from the preset" rather than "unset".

## [0.7.2] - 2026-09-30

### Added

- The card prints the version it was built from. A browser tab keeps the bundle it
  loaded and a host restart does not reload it, so "the card looks wrong" is very
  often "this tab is running older code" — with the version on screen that is a
  glance instead of an investigation.

### Fixed

- Re-shot the README screenshots: the first pair was captured with the first-run
  "Preview Notice" dialog still open, which covered the card.

## [0.7.1] - 2026-09-30

### Added

- Screenshots of the configuration card and of the routes group (`docs/`), and
  the card is now described where it is documented rather than only in prose.

### Changed

- The README leads with the two facts that decide whether the plugin works at all
  — the Subagent plugin must be active, and routes must name allowlisted models —
  followed by the task-class → role → route table that used to be scattered across
  three sections.

## [0.7.0] - 2026-09-30

### Changed

- The third role is now `junior`, not `mechanical`. Roles name the worker —
  `implementer`, `researcher` — and `mechanical` was the *task class* it serves
  leaking into a role name. The class keeps its name (Jev's rubric decides it and
  `routeFor` still keys on it), so only the role key moved: `routeFor:
  { mechanical: junior }`, `routes: { junior: ... }`.
- Configurations written before the rename keep working: a stale `mechanical`
  route is folded into `junior` on load. That is a migration rather than a note
  because the card commits the whole routes map on any edit, so an edit made
  before the upgrade would otherwise leave a fourth, permanently unreachable role
  sitting in the patch. An explicit `junior` outranks the stale key.

## [0.6.0] - 2026-09-30

Two answers to "what if the setup is wrong, and what if the job is simple".

### Added

- The card warns when the Subagent plugin is not active, reading its settings
  namespace as a liveness probe: the loader serves a row's namespace only while
  that row is composed, so a missing one means the delegation tools are very
  likely absent — the state a user would otherwise discover as a verdict with
  nowhere to go. Verified against a profile with the plugin disabled: the warning
  appears, and the allowlist-driven selects keep working, because the two
  namespaces come from different plugins.
- `mechanical` becomes a third role. `mechanical` and `bugfix` are delegated
  together but are not the same job — a rename has an unambiguous spec, a bug fix
  has to find the cause — and sharing one model meant paying the bug-fix price
  for renames.

### Changed

- The unavailable diagnostic and the log line name the plugin and point at
  Plugins; the log is a warning, since a turn that quietly never routed is not
  info.
- `refactor`, `feature_work` and `meta_chat` remain undelegated by design: they
  are absent from `profiles.*.delegate.taskClass`, so they never reach a route.

## [0.5.0] - 2026-09-30

Choosing a route is now a choice, not a spelling test. Each role gets its own
select fed by your Subagent allowlist — the same list every verdict is checked
against — so a route can no longer name a model dispatch is forbidden to use.

### Added

- One model select per role (`implementer`, `researcher`, and any role a profile
  adds), with the options read live from the `subagent-model-selection-settings`
  namespace through `configForms.get`, the framework's supported way to bind a
  namespace another plugin owns.
- A current value outside the allowlist stays visible as its own option instead of
  being silently reselected, so a stranded route is something you can see.

### Changed

- The raw `role=provider/model` field remains as the fallback wherever that
  namespace is not served — DSH 0.1.5, or a deployment without the Subagent
  model-selection plugin — so the card never loses the ability to set routes.

## [0.4.0] - 2026-09-30

Routes are editable in the settings card. They were the one nested field the card
left to the profile patch, which made a whole class of mistake invisible: a route
naming a model your Subagent allowlist does not carry still classifies, so the
verdict reads as healthy while there is nowhere to dispatch the task.

### Added

- A **Routes** field on the plugin's configuration card, written as
  comma-separated `role=provider/model` — `implementer=openrouter/glm-5.3-flash`.
  The value commits on Enter or blur, reaches the next turn without a host
  restart, and clears back to the shipped pair when emptied.
- Validation before the commit: a malformed entry reports `role=provider/model`,
  keeps the previous good value, and cannot half-apply a route map.

### Changed

- `routes` is no longer a patch-only field; `routeFor`, `profiles`, `questions`
  and `delegationTools` still are.

## [0.3.1] - 2026-09-30

The configuration card now sits on the plugin's own page, the way the shipped
plugins do it: opening Plugins → `dsh-jev-subagent-dispatch` shows the fields
immediately, instead of one click further in behind a **Configure** control that
nothing in the list announced.

### Changed

- Register the card in `plugins.bundle.config`, keyed by package name, the slot
  the plugin manager draws inline on the package page. `plugins.row.config` is
  kept alongside it, so DSH 0.1.7 — which knows only that slot — still gets a
  card rather than none.

## [0.3.0] - 2026-09-30

The configuration card works again, and it works on every settings model DSH
ships: the Plugins row page on 0.1.7 and 0.2.0, and the Plugins settings tab on
0.1.5. No configuration change is needed on any version — the same
`cordis.patch.yml` entry keeps working, and both the profile patch and the card
reach the next turn without a host restart.

### Added

- Row-configuration page for DSH 0.1.7+, which replaced `settings.plugin.item`
  with the keyed `plugins.row.config` slot. A row's own `Config` is its settings
  section there, so the form is registered against
  `dsh-jev-subagent-dispatch#jev-subagent-dispatch` and gives the row a
  **Configure** control on the Plugins page.
- `src/shared/config.mjs` now carries the package name and the row-config key,
  so the host and the browser cannot disagree about which entry they own.
- Optional `heading` prop on the settings card: the 0.1.7+ row page draws the
  title and crumb around the form itself, so the card drops its own there.

### Fixed

- **DSH 0.1.7+: the configuration card is reachable again.** The entry was
  missing from the Plugins page entirely — no Configure control and no namespace
  — because it is the *volatile* part of a `Config` schema that 0.1.7 projects a
  form from. Every field of the exported `Config` is now marked `.volatile()`,
  which is inert on 0.1.5, whose `schemastery` (3.18.2) has no such method.
- **DSH 0.1.7+: your configuration actually reaches the router again.** 0.1.7
  hands each volatile field to `apply` as a live accessor (`config.mode.get()`)
  rather than a value. Read as a scalar it looks like an absent field, so every
  turn silently fell back to the constants — `off` mode and the TypeSafe preset
  — whatever the patch or the form said. Every read is now unwrapped.
- **The browser half is loaded at all on 0.1.7+.** `package.json` declared no
  `dsh.client` platform and no `exports["./client"]`, so DSH's client-module
  scanner classified the package as "not a client package" and never served
  `lib/client.js` — the card could not register on any surface.
- **The `schemastery` peer is declared.** In a pnpm profile the module did not
  resolve from the plugin, `buildSchemas()` silently caught the failure, and
  `Config` came out `undefined` with no error anywhere. The peer (≥3.18.1) is
  now in `peerDependencies` beside the `devDependencies` pin.
- **The `patchReload: live` claim is gone from the docs.** Nothing in DSH reads
  that key; live application comes from volatile row fields re-read every turn
  (0.1.7+) or from the settings bridge (0.1.5), not from that setting.
- The dangling `config-schema.mjs` draft is folded into `src/host/index.js`
  (its field list became the real `Config`) and deleted.

## [0.2.0] - 2026-09-30

Settings card on the Plugins tab: live edits without a restart.
