/* Runs the same link-queue DES kernel as JavaScript, as Rust compiled to
   WebAssembly, and as native Rust, on one thread, for one game-day on a
   100 x 100 grid. Checks that all three give the same hash, and writes
   results/<timestamp>.json.

   Build first:  (cd rust && cargo build --release &&
                  cargo build --release --target wasm32-unknown-unknown --lib)
   Then:         node run.mjs [agents ...]   (default 1000 10000 100000 1000000) */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { simulate } from './kernel.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const G = 100, SEED = 1, GDD_1X = 24 * 60;   // GDD §8: 1x is one game-day per 24 real minutes
const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
if (!SIZES.length) SIZES.push(1000, 10000, 100000, 1000000);

const wasmBytes = fs.readFileSync(path.join(HERE, 'rust/target/wasm32-unknown-unknown/release/des_kernel.wasm'));
const native = path.join(HERE, 'rust/target/release/des-kernel');

const rows = [];
for (const n of SIZES){
  let t0 = performance.now();
  const js = simulate(G, n, SEED);
  const jsMs = performance.now() - t0;

  /* a fresh instance per run, so no memory carries over */
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  t0 = performance.now();
  const wEvents = instance.exports.run(G, n, SEED);
  const wMs = performance.now() - t0;
  const wHash = (instance.exports.last_hash() >>> 0).toString(16).padStart(8, '0');

  const nat = JSON.parse(execFileSync(native, [G, n, SEED].map(String)).toString());

  for (const [engine, ms, events, hash] of [['js', jsMs, js.events, js.hash],
                                            ['wasm', wMs, wEvents, wHash],
                                            ['rust-native', nat.ms, nat.events, nat.hash]]){
    rows.push({ engine, agents: n, events, eventsPerAgentDay: +(events / n).toFixed(1),
                ms: Math.round(ms), mEventsPerSec: +(events / ms / 1000).toFixed(1),
                speedVs1x: +(GDD_1X * 1000 / ms).toFixed(1), hash });
  }
  console.error(`  ${n} agents done`);
}

const cols = Object.keys(rows[0]);
const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
const line = r => cols.map((c, i) => String(r[c]).padStart(w[i])).join('  ');
console.log(`\nLink-queue DES, ${G}x${G} grid, one game-day, one thread\n`);
console.log([line(Object.fromEntries(cols.map(c => [c, c]))), ...rows.map(line)].join('\n'));
const agree = SIZES.every(n => new Set(rows.filter(r => r.agents === n).map(r => r.hash)).size === 1);
console.log(`\nSame hash in all three engines at every size: ${agree ? 'YES' : 'NO'}`);
console.log('speedVs1x: how many times faster than the GDD 1x clock (24 real minutes per game-day)');

fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
const when = new Date().toISOString();
fs.writeFileSync(path.join(HERE, 'results', when.replace(/[:.]/g, '-') + '.json'), JSON.stringify({
  when, grid: G, seed: SEED,
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30),
             platform: `${os.platform()} ${os.release()}`, node: process.version },
  rows, enginesAgree: agree }, null, 2) + '\n');
if (!agree) process.exitCode = 1;
