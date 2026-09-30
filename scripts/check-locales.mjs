/** Locale parity: zh and ru must cover exactly the en key set. */
import { en, zh, ru } from "../src/client/locales.ts";

const sets = [["zh", zh], ["ru", ru]];
let failed = false;
for (const [name, dict] of sets) {
  for (const key of Object.keys(en)) {
    if (!(key in dict)) { console.error(`${name}: missing "${key}"`); failed = true; }
  }
  for (const key of Object.keys(dict)) {
    if (!(key in en)) { console.error(`${name}: extra "${key}"`); failed = true; }
  }
}
if (failed) process.exit(1);
console.log("locales: en/zh/ru parity ok");
