#!/usr/bin/env node
/**
 * Offline policy replay for `dsh-jev-subagent-dispatch`.
 *
 * Usage:
 *   jev-replay <verdicts.ndjson> [overrides.json] [--json]
 *
 * Reads the verdict log, re-runs every recorded answer set through the
 * candidate policy (defaults + the given overrides JSON, merged exactly like
 * plugin input), and reports which historical turns would flip — grouped by
 * task class and reason. No network calls: the saved answers are re-decided
 * locally.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";
import { replayLog, renderReplayReport } from "../replay.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--json");
const asJson = process.argv.includes("--json");
const [logPath, overridesPath] = args;

if (!logPath) {
  console.error("usage: jev-replay <verdicts.ndjson> [overrides.json] [--json]");
  process.exit(2);
}

try {
  const records = (await readFile(logPath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const candidateInput = overridesPath === undefined ? {} : JSON.parse(await readFile(overridesPath, "utf8"));
  const outcome = replayLog(records, candidateInput);
  if (asJson) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    console.log(renderReplayReport(outcome));
  }
} catch (error) {
  console.error(`jev-replay: ${String(error?.message ?? error)}`);
  process.exit(1);
}
