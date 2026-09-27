/**
 * `dsh-jev-subagent-dispatch` — offline policy replay.
 *
 * Reads a verdict log (NDJSON as written by the host plugin, with the
 * answers each verdict stored), re-runs the recorded answers through a
 * CANDIDATE policy without another Jev call, and reports which historical
 * turns would flip, grouped by task class and reason. This gives users a
 * concrete way to tune `confidenceMin`, the predicate, and `probabilityMax`
 * against real traffic while keeping every decision reviewable — attach the
 * routing ledger later to also compare policy changes against observed
 * rework.
 *
 * @module dsh-jev-subagent-dispatch/replay
 */

import { criteriaLevelNames, resolveConfig } from "./config.mjs";
import { decide } from "./verdict.mjs";

const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * Replay one verdict record against a candidate config.
 * @param record - one NDJSON record with `action` and, for classifiable
 *   verdicts, `answers`.
 * @param config - the resolved candidate configuration.
 * @returns `{ id, taskClass, from, to, changed, reason, confidence }` or null
 *   for records a replay cannot judge (no answers: unavailable or failed
 *   calls, and non-verdict actions).
 */
export function replayRecord(record, config) {
  const answers = record?.answers;
  if (answers === null || typeof answers !== "object" || answers.task_class === undefined) return null;
  const decision = decide({ answers, model: record?.model, usage: record?.usage, latencyMs: record?.latencyMs }, config);
  return {
    id: record?.id ?? null,
    at: record?.at ?? null,
    taskClass: String(answers.task_class?.value ?? "unknown"),
    from: record?.action ?? null,
    to: decision.action,
    changed: decision.action !== record?.action,
    reason: decision.reason ?? null,
    confidence: numberOr(decision.confidence, null),
  };
}

/**
 * Replay a whole log and group the outcomes.
 * @param records - parsed NDJSON records (unparsed lines skipped).
 * @param candidateInput - candidate config overrides, merged onto the
 *   defaults exactly like plugin input (a candidate profile, tighter
 *   ceilings, new probabilityMax).
 * @returns `{ judged, unchanged, flips, byClass, byReason, results }` where
 *   `flips` counts `delegate→skip` plus `skip→delegate` and `byClass` /
 *   `byReason` group flips only.
 */
export function replayLog(records, candidateInput = {}) {
  const config = resolveConfig(candidateInput);
  const results = (records ?? [])
    .map((record) => replayRecord(record, config))
    .filter((result) => result !== null);
  const flips = results.filter((result) => result.changed);
  const group = (key) => flips.reduce((acc, result) => {
    acc[result[key]] = (acc[result[key]] ?? 0) + 1;
    return acc;
  }, {});
  return {
    judged: results.length,
    unchanged: results.length - flips.length,
    flips: flips.length,
    byClass: group("taskClass"),
    byReason: group("reason"),
    results,
  };
}

/**
 * Render a replay as a short human-readable report.
 * @param outcome - the object returned by {@link replayLog}.
 * @returns the report lines joined with newlines.
 */
export function renderReplayReport(outcome) {
  const lines = [
    `[jev-subagent-dispatch] replay: ${outcome.judged} judged, ${outcome.unchanged} unchanged, ${outcome.flips} would flip`,
  ];
  const section = (title, groups) => {
    lines.push(`${title}:`);
    const entries = Object.entries(groups);
    if (entries.length === 0) {
      lines.push("  (none)");
      return;
    }
    for (const [key, count] of [...entries].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${count}  ${key}`);
    }
  };
  section("flips by task class", outcome.byClass);
  section("flips by reason", outcome.byReason);
  return lines.join("\n");
}

/** Re-export for the CLI wrapper. */
export { criteriaLevelNames, resolveConfig };
