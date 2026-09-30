/**
 * The row's Config schema is the only complete copy of the configuration the
 * settings surface ever sees.
 *
 * A profile patch that addresses this row by id *replaces* the row config the
 * bundle layer inserted; the two do not merge. So for anyone who has edited the
 * plugin from the card even once, the stored row config is the handful of fields
 * the card wrote, and everything else has to come back from the schema. A field
 * declared `z.any()` with no default comes back missing — the card then drew no
 * route rows at all, and `triggers` materialised as `[]` rather than the shipped
 * pair. These asserts are that bug, one field at a time.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

/** Volatile fields arrive as live accessors; read through them. */
const plain = (value) => (value && typeof value.get === 'function' ? value.get() : value)

let cached
/**
 * Loaded lazily, inside the tests, and never at module scope: top-level await
 * here makes the file finish registering after the runner has already reported,
 * which silently drops these tests from the suite's count.
 */
async function schema() {
  if (cached !== undefined) return cached
  try {
    const host = await import('../src/host/index.js')
    cached = host.Config ? { Config: host.Config } : null
  } catch {
    cached = null // bare checkout without the optional peer
  }
  return cached
}

const SKIP = 'schemastery is not installed'

test('schema: an empty row config still describes the whole configuration', async (t) => {
  const s = await schema()
  if (s === null) return t.skip(SKIP)
  const parsed = s.Config({})
  assert.deepEqual(plain(parsed.triggers), ['/route', '/jev'], 'triggers must not collapse to []')
  assert.deepEqual(Object.keys(plain(parsed.routes)).sort(), ['implementer', 'junior', 'researcher'], 'routes must survive a partial row config')
  assert.deepEqual(plain(parsed.routeFor), { mechanical: 'junior', bugfix: 'implementer', research: 'researcher' })
  assert.equal(plain(parsed.defaultRoute), 'implementer')
  assert.equal(plain(parsed.activeProfile), 'auto')
  assert.equal(plain(parsed.includeFallbackLine), true)
  assert.ok(Object.keys(plain(parsed.questions)).length > 0, 'the rubric is part of the defaults')
  assert.ok(Object.keys(plain(parsed.profiles)).length > 0, 'the policy is part of the defaults')
  assert.ok(Array.isArray(plain(parsed.delegationTools)))
})

test('schema: the endpoint group stays empty so the provider preset still wins', async (t) => {
  const s = await schema()
  if (s === null) return t.skip(SKIP)
  const parsed = s.Config({})
  // Materialising one preset's values here would turn "provider: bai" into a
  // stale explicit override of the preset that provider selects.
  for (const field of ['endpoint', 'apiPath', 'apiKeyEnv', 'model']) {
    assert.equal(plain(parsed[field]), undefined, `${field} must stay absent`)
  }
})

test('schema: explicit values are never overwritten by a default', async (t) => {
  const s = await schema()
  if (s === null) return t.skip(SKIP)
  const parsed = s.Config({ triggers: [], routes: { mine: { provider: 'p', model: 'm' } } })
  assert.deepEqual(plain(parsed.triggers), [], 'a deliberate empty trigger list stays empty')
  assert.deepEqual(Object.keys(plain(parsed.routes)), ['mine'], 'a deliberate route map is not merged with the defaults here')
})
