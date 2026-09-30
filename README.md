# dsh-jev-subagent-dispatch

**Cut LLM costs: routine tasks go to cheap subagent models; the main model keeps the hard parts.**

Jev-guided subagent dispatch for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the plugin asks [Jev](https://docs.typesafe.ai) — TypeSafe's typed-decision model — a handful of atomic questions about the task, applies your routing policy, and appends a **dispatch recommendation**: which subagent model route should take the turn. The division of labor is deliberate — Jev guides, the main agent performs the handoff through the harness-native subagent tool; the plugin owns no delegation machinery of its own.

Jev does not write code and is not a chat LLM. It answers typed questions (`choice` / `score` / `noul`) with probabilities and a confidence, in one parallel pass, in tens of milliseconds. That makes it an ideal guide: the expensive main agent stops spending tokens deciding *who should do the work*.

> `[jev-subagent-dispatch]` is to your agent what a team lead is to a developer: it reads the ticket for 200 ms and decides whether it goes to a junior — and it never lets a junior touch production.

The injection is **advice, not enforcement**: the main agent weighs it and can ignore it. Measure the recommendation's quality (see [Measuring impact](#measuring-impact)) before trusting it in daily work.

## Dispatch capability is a prerequisite

For a dispatch plugin, calling Jev before knowing whether the agent can delegate at all would waste the call. DSH needs **three pieces** for delegation — the subagent service, a child provider behind it, and a delegation tool visible to the agent — and a **depth limit of 0 disables delegation entirely**. Installing this plugin implies none of that, so every routing request re-verifies capability at request time against the live host services (never a package dependency, never a boot-time snapshot):

- a delegation tool (`subagent` / `subagent_fork`) is visible to **this** agent;
- the subagent service is present and the provider behind the visible tool is registered;
- the agent has remaining delegation depth (`session.header.delegationDepth` against the effective depth limit — provider-managed limits always leave room locally);
- the session's model-selection policy (`subagentModelSelectionPolicy` projection): when model selection is **off**, the subagent tool takes no model argument and the recommendation names no model — the session's configured child default applies; when it is **on**, a configured route is named only if the session allowlist contains it, otherwise the message points the agent at `list_subagent_models`;
- **which tool, and its provider**: a fork is fixed-route no matter what the tool is called — the advice renders as "the fork inherits your model and context" for `subagent_fork` and for a custom-named tool with `provider: fork` alike. A model name is only ever advice the visible tool can follow.

| Situation | Explicit `/route` request | Ordinary turn (`auto`) |
|---|---|---|
| Capability check passes | classify → inject recommendation | classify → inject recommendation |
| Capability check fails | inject a diagnostic naming what is missing; **no Jev call** | **fully silent** — no injection, no call, no log line |

Changes to session or plugin setup take effect on the next request — nothing is cached from boot.

The settings card carries a lighter, earlier version of the same check: it reads the Subagent plugin's own settings namespace, which the loader serves only while that row is composed and enabled, and shows a warning when it is gone. That catches the one case you would otherwise meet as a verdict with nowhere to go — a profile where the plugin was never enabled. It is a probe, not the authority: only the request-time check above sees the session's tool visibility, which is why a missing namespace warns while a depth-limited or tool-disabled session still reports itself through the diagnostic message.

## Modes: Jev runs when you ask, not on every turn

The default is `off` — nothing is registered, nothing is shared. Three activation models, cheapest first:

| Mode | How it works | Trade-off |
|---|---|---|
| `off` (default) | No pre-step listener at all. | Zero cost, zero data sharing; you must configure more to get value. |
| `once` | Only turns that **explicitly ask** are classified: `/route fix the failing tests` calls Jev once; every other turn passes through untouched. | Predictable cost and data sharing, but you must remember to ask. |
| `auto` | Every plain user turn is considered (the original behavior). | No user effort, but enable it only when the verdict log shows the recommendations earn their place. |

Trigger syntax (configurable via `triggers`):

```
/route fix the failing tests        → one Jev call, a routing recommendation
/jev should I delegate this?        → free-form decision request to the rubric
/route preview rename everything    → evaluation-only verdict (see below)
```

A request may **name the decision**: the text after the trigger leads the state sent to Jev (`/jev which specialist?` becomes a decision request the typed rubric answers through its vocabulary). This makes Jev a small decision service the agent can reuse, while the routing policy remains one specific use of it.

**Preview** — `/route preview <task>` classifies and injects an evaluation-only verdict: full answers — including score distributions (`blast_radius distribution: trivial 0.20, …`) so the risk policy can be tuned against real mass — an explicit "do not delegate based on this", and a `trigger: preview` mark in the verdict log. Misses are rendered too: a verdict the policy declines injects `verdict: skip — <reason>` with its answers, because the skipped cases are exactly the ones you cannot see any other way. Collect real examples this way and read them against actual outcomes before allowing automatic delegation.

Roadmap, in the order the evidence would justify it: an agent-called `route_task` tool (the main agent asks when unsure — natural in conversation, but it still spends a step deciding to call), and selective auto (cheap local rules first, Jev only for turns whose route stays unclear — needs collected data to tune the trigger).

## How a turn flows

```
user message ──▶ agent/pre-step waterfall
                   │
                   ├─ downstream listeners (memory plugins, …) run first
                   │
                   └─ jev-subagent-dispatch (prepended, sees the final batch)
                        ├─ mode gate: off → never; once → only /route, /jev turns
                        ├─ capability gate: delegation tool + provider + depth
                        ├─ build state: redacted turn + explicit request, capped
                        ├─ POST {provider endpoint}{apiPath} (6 atomic questions, one call)
                        ├─ apply profile policy (predicate + confidence gates)
                        ├─ log verdict to NDJSON (opt-in)
                        └─ "delegate" verdict? append a routing recommendation
                              ▼
        main agent spawns the recommended subagent (harness-native tool)
```

Fail-open everywhere: a missing key, a timeout, a 429, or a broken config logs the reason and the turn proceeds unrouted. The plugin injects only when it is confident; otherwise it stays silent.

## Privacy

The state sent to TypeSafe is deliberately minimal and is **redacted before it leaves the machine**:

- the user's turn text plus a `workspace:` line — no diffs, no tool output, no file contents;
- the **task text leads** the state and the workspace path trails as bounded context (≤ 120 chars) — the whole assembled payload is redacted (the path passes the same credential filters as the task text) and capped to `stateChars` (default 1200) as a whole, so no path length can leak, exceed the cap, or push the task out;
- credential-shaped substrings (`sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `Bearer …`, `api_key=…`, long base64 tokens) are replaced with `[redacted]` by built-in patterns; `redactPatterns` adds your own regex sources;
- logging is **opt-in** (`logDir`), and the user's turn text reaches the log only when `logTurnText` is true — the verdict itself (class, scores, probabilities, route, usage) is what you calibrate against.

Sending task text to TypeSafe is the point of the plugin; if that is unacceptable for a repository, set `enabled: false` for it.

## The rubric (what gets decided)

The `questions` config mirrors TypeSafe's documented request shape exactly — a **map keyed by question id**, each entry carrying `type`, `instructions`, and `criteria` — so what is configured is what goes on the wire. Six atomic questions in one request; adding questions does not add latency:

| Question | Type | Criteria |
|---|---|---|
| `task_class` | choice (map of option → description) | mechanical · bugfix · feature_work · refactor · research · meta_chat |
| `effort` | score (ordered level array) | S (0) · M (1) · L (2) · XL (3) |
| `blast_radius` | score (ordered level array) | trivial (0) · module (1) · cross_module (2) · public_api (3) · infra (4) |
| `needs_repo_context` | noul | probability the task spans several repo modules |
| `user_explicit` | noul | probability the user asked the main agent to do it personally |
| `risky` | noul | probability the task touches secrets, migrations, infra, destructive ops |

A Choice answer names the selected option (`choice`) with per-option probabilities. A Score answer is a **numeric position on the levels spectrum (0..n-1) that may land between two levels** — 1.4 means "between M and L" — with a probability per level. A Noul answer is a single 0..1 probability.

## The policy (how it decides)

```yaml
activeProfile: auto
profiles:
  auto:
    confidenceMin: 0.7
    delegate:
      taskClass: [mechanical, bugfix, research]
      effortMax: 1.5          # up to "between M and L"
      blastRadiusMax: 1.5     # up to "between module and cross_module"
      maxNoul:
        needs_repo_context: 0.5
        user_explicit: 0.3
        risky: 0.2
      # cap the probability of a severe level, not only the average score;
      # levels are rubric names (structured criteria entries are addressed
      # by index), "name+" sums that level and everything worse; an
      # incomplete score distribution fails the gate closed
      probabilityMax:
        blast_radius: { "public_api+": 0.15, infra: 0.05 }
routeFor:
  mechanical: implementer
  bugfix: implementer
  research: researcher
routes:
  implementer: { provider: openrouter, model: deepseek-v4-flash }
  researcher:  { provider: openrouter, model: qwen3.8-flash }
```

Delegation is recommended only when **all** of it holds: the declarative predicate over the answers (score ≤ ceiling, so boundary values pass; a missing answer fails closed), and the primary confidence above the profile floor. Two shipped profiles: `auto` delegates readily; `careful` (confidence 0.85, effort ≤ 0.5, blast radius ≤ 0.5) for repositories where a wrong delegation is expensive. Tune coefficients in config, not prompts. If you would rather gate on the *probability of exceeding* a level than on the numeric score, read `probabilities` from the score answer — the log records them per turn.

The `routes` mirror the allowlist in **Settings → Subagent → "Models agents may choose"** — the plugin owns no delegation machinery; the harness-native `subagent` tool spawns with the recommended `provider`/`model`.

## Providers: where your Jev access lives

The key's **issuer** determines the endpoint, the API path, the credential variable, and the pinned model id. One shared question format and routing policy sits on top; the `provider` preset swaps only the wire address and model:

| Key from | `provider` | Jev endpoint | Pinned model | Key env |
|---|---|---|---|---|
| B.AI | `bai` | `https://api.b.ai/v1/decisions` | `jev-1.13.0` | `OPENROUTER_API_KEY` |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1/systemone` | `jev-1.13` | `OPENROUTER_API_KEY` |
| TypeSafe | `typesafe` (default) | `https://api.typesafe.ai/v1/systemone` | `jev-1.13.0` | `TYPESAFE_API_KEY` |

B.AI's Decisions API and OpenRouter's System One API both return typed Jev answers in the same shape; the plugin sends the identical rubric and applies the identical policy regardless of provider. Explicit `endpoint`, `apiPath`, `apiKeyEnv`, or `model` values in the row config override the preset — so a self-hosted or proxied Jev endpoint needs only those four strings. If your key came from B.AI, set `provider: bai` and you are done.

## Install

```sh
dsh plugin --profile web add /path/to/dsh-jev-subagent-dispatch   # local checkout
# or, once published:
dsh plugin --profile web add dsh-jev-subagent-dispatch
```

Then set the issuer's key variable (`OPENROUTER_API_KEY` for B.AI, `TYPESAFE_API_KEY` for TypeSafe direct) in the environment you boot `dsh web` from, set `mode: once` (or `auto`) in the plugin row, and restart the profile. In `once` mode nothing is sent or classified until you send a trigger.

### Wiring test without a key

Set `mock: true` in the plugin row config. The mock classifier answers from keywords with fixed 0.9 confidence in the documented answer shapes, so you can see the injection, the log, and the thresholds end-to-end. It classifies nothing — flip it off for real routing.

## Settings

Two surfaces, one source of truth. The plugin's **own configuration page under Plugins** (DSH 0.1.7+, reachable from the row's **Configure** control) — or the **Plugins settings tab** on 0.1.5 — edits the top-level fields live: mode, provider preset, decision profile, triggers, routes, log directory and turn-text switch, state cap, and the classifier endpoint group — edits reach the next turn **without a host restart**, and a rejected value keeps the previous good config. Routes are here because they are the one nested field that fails quietly: a route naming a model your Subagent allowlist forbids still classifies, so the verdict reads as healthy while there is nowhere to dispatch. The card reads that allowlist from the `subagent-model-selection-settings` namespace — another plugin's, bound through `configForms.get`, which the framework documents for exactly this — and offers its models as one select per role, so the mistake is not available to make. Where that namespace is not served, the raw `role=provider/model` field returns unchanged. The **profile patch** remains the base layer for everything the card deliberately does not fake: profile thresholds (`effortMax`, `noulMax`, `probabilityMax`), `routeFor`, custom `questions`, `delegationTools`.

All settings live in the plugin row's `config`. The bundle patch ships the documented defaults; override the same row by id in your profile's `cordis.patch.yml` (edits there are the base layer the card rides on). Merging: `questions` and `routes` merge per key (override one entry, keep the rest); `profiles` deep-merge (tweak one threshold, keep the predicate); everything else follows ordinary deep-merge rules.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `off` | activation: `off` (inert), `once` (explicit triggers only), `auto` (every turn) |
| `triggers` | `["/route", "/jev"]` | leading commands that mark a turn for classification in `once` mode |
| `provider` | `typesafe` | which Jev issuer preset applies: `typesafe`, `bai`, `openrouter` |
| `endpoint` | per preset | TypeSafe API base — override for a proxied endpoint |
| `apiPath` | per preset | path appended to the endpoint (`/v1/systemone`, `/v1/decisions`, …) |
| `apiKeyEnv` | per preset | env var carrying the Bearer key |
| `model` | per preset | **pinned** System One model — thresholds are calibrated per version; do not use `jev-latest` |
| `timeoutMs` | `900` | classification budget; on expiry the turn proceeds unrouted |
| `stateChars` | `1200` | head cap of the redacted state built from the user turn |
| `redactPatterns` | `[]` | extra regex sources redacted from the state and log text, on top of the built-in credential patterns |
| `mock` | `false` | keyword classifier for wiring tests only |
| `questions` | see bundle patch | the atomic rubric in TypeSafe's request format |
| `activeProfile` | `auto` | which profile's policy applies |
| `profiles` | `auto`, `careful` | `{ confidenceMin, delegate }` predicates |
| `routeFor` | class → role | which named route a task class maps to |
| `defaultRoute` | `implementer` | fallback role when the class has no mapping |
| `routes` | three routes | `role → { provider, model }`; mirror your Subagent allowlist. The card shows one select per role, limited to the models that allowlist permits; without that namespace it falls back to comma-separated `role=provider/model`, where clearing the box restores the shipped triple |
| `skipSubagentSessions` | `true` | only main-agent turns are routed |
| `logDir` | `null` | NDJSON verdict sink; **`null` or `""` disables logging**; set a directory path to opt in |
| `logTurnText` | `false` | when logging is on, include the (redacted) turn text in the log |
| `includeFallbackLine` | `true` | add the "proceed yourself if subagents are unavailable" line |
| `delegationTools` | `subagent`, `subagent_fork` | `{ toolName, provider }` pairs the capability gate probes; a preset that configures a custom `toolName` must list it here, or dispatch reports itself unavailable |

## Observability and recalibration

With `logDir` set, every verdict — delegate, skip, or error — appends one NDJSON line:

```json
{"at":"2026-09-27T20:41:03.114Z","action":"delegate","reason":"predicate holds",
 "confidence":0.94,"role":"implementer","route":{"provider":"openrouter","model":"deepseek-v4-flash"},
 "model":"jev-1.13.0","usage":{"input_tokens":360,"output_tokens":39},"latencyMs":180,"answers":{…}}
```

The recalibration loop: when tests fail or work needs redoing after a delegation, that is a routing miss — raise `confidenceMin` or tighten the predicate for the failing class; when the log shows mechanical turns routed to the main model, loosen it.

## Measuring impact

The recommendation costs one classification call per turn; it should earn its place with evidence, not faith. The verdict log plus `usage` gives you the inputs:

- **verdict rate** — share of turns ending in a `delegate` verdict. Every record carries an `id` and a `delivered` flag (whether the recommendation was actually injected — a missing message factory makes a verdict undelivered);
- **latency and cost** — `latencyMs` and `usage.input_tokens` per verdict against the main model's tokens saved on mechanical turns;
- **rework** — count test failures and re-delegations after routed turns versus unrouted ones (toggle `enabled` off for a comparable baseline period).

If the deltas do not justify the extra call, tighten the policy so it fires less often — a quiet router is a good router.

Be honest about the gap: today's log measures **policy verdicts and delivery**, not adoption — it cannot see whether the main agent actually spawned a child, which model ran, or whether the work was re-done. The next step is a closed-loop **routing ledger**: correlate each verdict `id` with the actual subagent call, elapsed time, and rework, then report follow-rate and time-saved by task class. Observe first; retune thresholds on that evidence, not on intuition.

### Replaying policy changes offline

You do not need more Jev calls to evaluate a candidate policy — the verdict log already stores every answer set. Replay re-decides the recorded answers locally and shows what would flip, grouped by task class and reason:

```sh
npx jev-replay ~/.dsh/verdicts/verdicts.ndjson candidate.json
# candidate.json — plugin-input overrides, e.g.
# { "profiles": { "auto": { "delegate": { "effortMax": 1, "probabilityMax": { "blast_radius": { "public_api+": 0.1 } } } } } }
```

```text
[jev-subagent-dispatch] replay: 42 judged, 35 unchanged, 7 would flip
flips by task class:
  5  research
  2  mechanical
flips by reason:
  7  effort 1.4 > effortMax
```

Route-only changes are counted separately: a candidate that maps a task class to another role reports `N route-only` flips with a `from → to` breakdown per route, distinct from delegate↔skip flips. Records from older logs without route fields are never counted as route changes. Add `--json` for machine-readable output. Replay keeps decisions reviewable: you see exactly which historical turns a threshold change would have flipped before you commit it. The planned routing ledger (correlating verdict `id`s with actual child calls and rework) will let replay compare policy changes against observed outcomes too.

## Testing

```sh
npm run check   # lint (node --check over every .mjs) + unit tests
```

The suite covers the TypeSafe wire contract (`questions` as an id-keyed map with `type`/`instructions`/`criteria`; documented answer normalization including fractional scores), score boundary cases (exactly at the ceiling passes, above fails), the declarative predicate, redaction, config merging, and the host integration path with a fake context (registration, injection, fail-open, skip rules, opt-in logging). No real TypeSafe request is made by the tests; the first real request against a live key is the remaining integration check.

## Caveats

- **English in, confidence out.** Jev is trained primarily on English; classify a brief English statement of intent rather than raw non-English text, and lean on the confidence gates.
- **Pin the model.** `jev-latest` moves; thresholds do not. The response's `model` field is logged with every verdict so drift is visible.
- **State hygiene.** The state is the redacted user turn plus the workspace path — see [Privacy](#privacy). The `risky` gate exists because routers are cheap to fool.
- **Price.** Input tokens only ($42/Btok, output free): a 1.2k-state turn with six questions costs a fraction of a cent at tens of millions of turns per month.

## Compatibility

Pure ESM, no runtime npm dependencies; the `@deepseek-ai/dsh-llm` peer is resolved from the host. If the peer is unreachable (a bare checkout), the plugin **skips the injection** rather than fabricating a message outside DSH's message contract. The optional `@deepseek-ai/schemastery` peer (≥3.18.1) backs the settings schema; without it the profile patch stays the sole configuration source. Node ≥ 22. Developed and tested against DSH `0.1.5`, `0.1.7`, and `0.2.0` (web profile) — the settings surface is chosen by service injection, never a version check.

## License

MIT
