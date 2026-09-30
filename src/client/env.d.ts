/**
 * Injected by `scripts/build-client.mjs` from `package.json`.
 *
 * The card shows it so a reader can tell *which* build they are looking at. That
 * matters more than it sounds: a browser tab keeps the bundle it loaded, and a
 * host restart does not reload it, so "the card looks wrong" is very often "the
 * tab is running last week's code". With the version on screen that is a glance
 * rather than an investigation.
 */
declare const __JEV_VERSION__: string
