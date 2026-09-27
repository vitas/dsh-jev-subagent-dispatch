/** Offline policy replay: recorded answers re-decided against a candidate. */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { replayLog, renderReplayReport } from "../replay.mjs";
import { resolveConfig } from "../config.mjs";
import { normalizeAnswers } from "../jev.mjs";

const root = new URL("..", import.meta.url).pathname;

function documentedResponse() {
  return {
    answers: {
      task_class: { type: "choice", choice: "mechanical", probabilities: { mechanical: 0.91 }, confidence: 0.94 },
      effort: { type: "score", score: 1.4, probabilities: [0.1, 0.35, 0.4, 0.15], confidence: 0.9 },
      blast_radius: { type: "score", score: 1, probabilities: [0.2, 0.6, 0.15, 0.04, 0.01], confidence: 0.88 },
      needs_repo_context: { type: "noul", noul: 0.05 },
      user_explicit: { type: "noul", noul: 0.02 },
      risky: { type: "noul", noul: 0.01 },
    },
  };
}

test("replay: candidate policies flip historical verdicts without a Jev call", () => {
  const config = resolveConfig({ mode: "auto", mock: true });
  const answers = normalizeAnswers(documentedResponse(), config.questions);
  const records = [
    { at: "t1", id: "id-1", action: "delegate", answers, model: "jev-1.13.0" },
    { at: "t2", id: "id-2", action: "skip", reason: "effort 1.4 > effortMax", answers, model: "jev-1.13.0" },
    { at: "t3", id: "id-3", action: "unavailable", reason: "no delegation tool" }, // no answers → not judged
  ];
  // tight candidate: the historical delegate would flip to skip
  const tight = replayLog(records, { profiles: { auto: { delegate: { effortMax: 0.5 } } } });
  assert.equal(tight.judged, 2); // the unavailable record is not judged
  assert.equal(tight.flips, 1);
  assert.equal(tight.results[0].from, "delegate");
  assert.equal(tight.results[0].to, "skip");
  assert.equal(tight.results[0].changed, true);
  assert.equal(tight.results[1].changed, false);
  assert.equal(tight.byClass.mechanical, 1);
  assert.match(Object.keys(tight.byReason)[0], /effortMax/);

  // loosened candidate: the historical skip would flip to delegate
  const loose = replayLog(records, { profiles: { auto: { delegate: { effortMax: 2 } } } });
  assert.equal(loose.flips, 1);
  assert.equal(loose.results[1].to, "delegate");
  assert.match(renderReplayReport(loose), /1 would flip/);
  assert.match(renderReplayReport(loose), /flips by task class:/);
});

test("replay: the CLI reads a log and answers --json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-replay-cli-"));
  try {
    const config = resolveConfig({ mode: "auto", mock: true });
    const answers = normalizeAnswers(documentedResponse(), config.questions);
    const logPath = join(dir, "verdicts.ndjson");
    await writeFile(logPath, `${JSON.stringify({ at: "t1", id: "id-1", action: "delegate", answers, model: "jev-1.13.0" })}\n`);
    const overridesPath = join(dir, "candidate.json");
    await writeFile(overridesPath, JSON.stringify({ profiles: { auto: { delegate: { effortMax: 0.5 } } } }));
    const run = (args) => new Promise((resolve, reject) => {
      execFile(process.execPath, [join(root, "bin", "jev-replay.mjs"), logPath, overridesPath, "--json"], (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
    const outcome = JSON.parse(await run([]));
    assert.equal(outcome.judged, 1);
    assert.equal(outcome.flips, 1);
    assert.equal(outcome.results[0].to, "skip");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
