/**
 * Integration test for the HTTP path: a local server stands in for a
 * provider endpoint (B.AI's Decisions API shape) and the REAL classify()
 * runs against it — URL building, auth header, request body, response
 * normalization, and usage capture, with no mock classifier involved.
 *
 * Run: node --test test/
 */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { resolveConfig } from "../config.mjs";
import { classify } from "../jev.mjs";

/** A documented-shape B.AI-style Jev endpoint on an ephemeral port. */
function startServer() {
  const seen = {};
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      seen.url = request.url;
      seen.authorization = request.headers.authorization;
      seen.body = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        model: "jev-1.13.0",
        usage: { input_tokens: 214, output_tokens: 31 },
        answers: {
          task_class: { type: "choice", choice: "mechanical", probabilities: { mechanical: 0.93 }, confidence: 0.95 },
          effort: { type: "score", score: 1, confidence: 0.91 },
          blast_radius: { type: "score", score: 1, confidence: 0.9 },
          needs_repo_context: { type: "noul", noul: 0.07 },
          user_explicit: { type: "noul", noul: 0.04 },
          risky: { type: "noul", noul: 0.02 },
        },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen }));
  });
}

test("http: classify completes a real round trip against a provider endpoint", async () => {
  const { server, seen } = await startServer();
  try {
    const port = server.address().port;
    process.env.JEV_HTTP_TEST_KEY = "test-key-123";
    const config = resolveConfig({
      provider: "bai",
      endpoint: `http://127.0.0.1:${port}`, // stand-in for https://api.b.ai
      apiKeyEnv: "JEV_HTTP_TEST_KEY",
    });
    const verdict = await classify(config, "workspace: /w\ntask:\nrename foo everywhere");
    assert.equal(verdict.model, "jev-1.13.0");
    assert.deepEqual(verdict.usage, { input_tokens: 214, output_tokens: 31 });
    assert.equal(verdict.answers.task_class.value, "mechanical");
    assert.equal(verdict.answers.effort.value, 1);

    assert.equal(seen.url, "/v1/decisions"); // B.AI path from the preset
    assert.equal(seen.authorization, "Bearer test-key-123");
    assert.equal(seen.body.model, "jev-1.13.0");
    assert.equal(Array.isArray(seen.body.questions), false); // map, not array
    assert.ok(seen.body.questions.task_class.criteria.mechanical); // documented shape
  } finally {
    server.close();
    delete process.env.JEV_HTTP_TEST_KEY;
  }
});
