/* ============================================================
   Traffic Studio — headless scaling benchmark

   Loads ../index.html in headless Chromium, pauses the frame loop,
   and drives the simulation directly through window.GRID3D.  For a
   ladder of grid sizes and demand levels it records:

     stepMs        wall time of one 50 ms simulation step
     usPerVeh      that cost divided by the vehicles on the road
     simSpeed      simulated seconds per real second, sim only,
                   one thread (1.0 = real time)
     routeUs       one uncached Dijkstra between two random nodes
     drawJsMs      JavaScript cost of one frame's scene update
                   (GPU time excluded; see perfProbe in index.html)

   and a determinism check: the same seed stepped twice in two
   fresh pages must leave identical vehicle state.

   Usage:   npm install  &&  npm run bench          (full ladder)
            npm run bench:quick                     (small ladder)
   Output:  a table on stdout, and results/<timestamp>.json
   ============================================================ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..', 'index.html');
const VENDOR = path.join(HERE, '.vendor');
const RESULTS = path.join(HERE, 'results');
const QUICK = process.argv.includes('--quick');

/* Grid side (junctions), network inflow (veh/h), warm-up steps.
   Inflow grows with the perimeter, since vehicles enter only at
   the boundary stubs. */
const LADDER = QUICK
  ? [ { n: 4, inflow: 1400, warm: 1200 }, { n: 8, inflow: 4000, warm: 2400 } ]
  : [ { n: 4,  inflow: 1400,  warm: 1600 },
      { n: 4,  inflow: 4200,  warm: 1600 },
      { n: 8,  inflow: 6000,  warm: 3000 },
      { n: 12, inflow: 10000, warm: 4000 },
      { n: 16, inflow: 14000, warm: 5000 },
      { n: 24, inflow: 20000, warm: 6000 },
      { n: 32, inflow: 60000, warm: 10000 } ];
const MEASURE_STEPS = 200;

/* ------------------------------------------------------------
   Third-party scripts.  The page imports Three.js and Clipper from
   a CDN; they are fetched once into .vendor/ and served from
   there, so a run neither depends on the browser reaching the CDN
   nor changes if the CDN does.
   ------------------------------------------------------------ */
const VENDORED = [
  { match: /three\.module\.min\.js$/, file: 'three.module.min.js', type: 'text/javascript',
    url: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js' },
  { match: /clipper(\.min)?\.js$/, file: 'clipper.min.js', type: 'text/javascript',
    url: 'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.min.js' },
];

async function ensureVendor(){
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const v of VENDORED){
    const dest = path.join(VENDOR, v.file);
    if (fs.existsSync(dest)) continue;
    try {
      const r = await fetch(v.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    } catch {
      /* curl honours the proxy settings of locked-down machines */
      execFileSync('curl', ['-sSfL', '-o', dest, v.url]);
    }
  }
}

function serve(){
  const html = fs.readFileSync(PAGE);
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      r.writeHead(200, { 'content-type': 'text/html' }); r.end(html);
    }).listen(0, () => res(srv));
  });
}

async function openPage(browser, url, { frozen = false } = {}){
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  /* frozen: the frame loop never starts, so nothing but our own
     calls ever advances the simulation — not even one frame of
     real-time stepping between boot and the first evaluate */
  if (frozen) await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\//, route => {
    const v = VENDORED.find(x => x.match.test(route.request().url()));
    if (!v) return route.abort();
    route.fulfill({ status: 200, contentType: v.type,
                    headers: { 'access-control-allow-origin': '*' },
                    body: fs.readFileSync(path.join(VENDOR, v.file)) });
  });
  await page.goto(url);
  await page.waitForFunction(() => window.GRID3D && document.getElementById('boot').classList.contains('gone'),
                             null, { timeout: 120000 });
  /* stop the frame loop from stepping the sim behind our back */
  await page.evaluate(() => { window.GRID3D.SIM.running = false; });
  return page;
}

/* one rung of the ladder, run entirely inside the page */
function measure(page, c){
  return page.evaluate(({ n, inflow, warm, steps }) => {
    const G = window.GRID3D;
    const id = 'bench' + n;
    if (!G.LAYOUTS.find(l => l.id === id))
      G.LAYOUTS.push({ id, name: id, fn: () => G.layoutGrid(n, n, 140) });
    G.reseed(1);
    let t0 = performance.now();
    G.applyLayout(id);
    const compileMs = performance.now() - t0;
    G.CFG.inflow = inflow;

    for (let i = 0; i < warm; i++) G.stepSim(0.05);
    const vehStart = G.SIM.vehicles.length;
    let vehSum = 0;
    t0 = performance.now();
    for (let i = 0; i < steps; i++){ G.stepSim(0.05); vehSum += G.SIM.vehicles.length; }
    const stepMs = (performance.now() - t0) / steps;
    const veh = vehSum / steps;

    /* routing: uncached shortest paths between spread-out pairs */
    const nodes = G.NET.nodes.filter(x => x.deg > 1);
    let calls = 0;
    t0 = performance.now();
    for (let i = 0; i < 200; i++){
      const a = nodes[(i * 7919) % nodes.length], b = nodes[(i * 104729 + 13) % nodes.length];
      if (a === b) continue;
      G.bumpRouteCache(); G.findRoute(a, b, null); calls++;
    }
    const routeUs = (performance.now() - t0) / Math.max(1, calls) * 1000;
    const probe = G.perfProbe(20);

    return {
      grid: `${n}x${n}`, junctions: G.NET.nodes.length, links: G.NET.links.length,
      inflow, compileMs: Math.round(compileMs),
      vehicles: Math.round(veh), vehStart, peds: G.SIM.peds.length,
      stepMs: +stepMs.toFixed(3),
      usPerVeh: +(stepMs * 1000 / Math.max(1, veh)).toFixed(2),
      simSpeed: +(50 / stepMs).toFixed(1),
      routeUs: Math.round(routeUs),
      drawJsMs: probe.frameMs,
    };
  }, { ...c, steps: MEASURE_STEPS });
}

/* a canonical fingerprint of every vehicle's state */
function runForHash(page){
  return page.evaluate(() => {
    const G = window.GRID3D;
    G.reseed(42);
    G.applyLayout('grid4');
    G.applyScenario('grid');
    G.SIM.running = false;
    for (let i = 0; i < 3000; i++) G.stepSim(0.05);
    const vs = G.SIM.vehicles.slice().sort((a, b) => a.id - b.id);
    let h = 2166136261 >>> 0;
    const mix = x => { const s = String(x); for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    for (const v of vs){ mix(v.id); mix(v.s); mix(v.v); mix(v.ri); }
    return { vehicles: vs.length, hash: h.toString(16) };
  });
}

function table(rows){
  const cols = Object.keys(rows[0]);
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
  const line = r => cols.map((c, i) => String(r[c]).padStart(w[i])).join('  ');
  return [line(Object.fromEntries(cols.map(c => [c, c]))), ...rows.map(line)].join('\n');
}

await ensureVendor();
const srv = await serve();
const url = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const rows = [];
try {
  const page = await openPage(browser, url);
  const ua = await page.evaluate(() => navigator.userAgent);
  for (const c of LADDER){
    const r = await measure(page, c);
    rows.push(r);
    console.error(`  ${r.grid} @ ${r.inflow} veh/h: ${r.vehicles} vehicles, ${r.stepMs} ms/step`);
  }
  await page.close();

  /* Frozen: identical calls from page load must give identical
     state — the simulation logic itself is deterministic.  Live:
     the page runs as a player sees it for a moment first, stepping
     by real frame times, then the same replay is attempted. */
  const twice = async frozen => {
    const out = [];
    for (let k = 0; k < 2; k++){
      const p = await openPage(browser, url, { frozen });
      if (!frozen) await p.evaluate(() => { window.GRID3D.SIM.running = true; });
      if (!frozen) await p.waitForTimeout(1500);
      out.push(await runForHash(p)); await p.close();
    }
    return { pass: out[0].hash === out[1].hash, a: out[0], b: out[1] };
  };
  const detFrozen = await twice(true);
  const detLive = await twice(false);
  const deterministic = detFrozen.pass;

  console.log('\nScaling ladder (one thread, sim only unless noted)\n');
  console.log(table(rows));
  const say = (label, d) => console.log(`${label}: ${d.pass ? 'PASS' : 'FAIL'}  ` +
    `${d.a.hash} / ${d.b.hash}  (${d.a.vehicles} vehicles)`);
  console.log('\nDeterminism — same seed, two fresh pages, 150 sim-seconds on the 4x4 gridlock scenario');
  say('  replay from load (sim logic)     ', detFrozen);
  say('  after live play (frame-timed)    ', detLive);

  fs.mkdirSync(RESULTS, { recursive: true });
  const out = {
    when: new Date().toISOString(),
    machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30),
               platform: `${os.platform()} ${os.release()}`, browser: ua },
    ladder: rows, determinism: { replayFromLoad: detFrozen, afterLivePlay: detLive },
  };
  const file = path.join(RESULTS, out.when.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
  if (!deterministic) process.exitCode = 1;
} finally {
  await browser.close();
  srv.close();
}
