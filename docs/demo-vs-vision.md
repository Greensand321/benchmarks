# Traffic Studio demo vs. the City Simulation Engine vision

**Written:** 2026-09-24 · **Measured on:** a 4-core Intel Xeon @ 2.10 GHz cloud container, one thread

## What this document is

This is an assessment of how far the current demo (`traffic-studio-3d/index.html`) can be taken toward the goals in the three design documents: `01_game_design.md`, `02_architecture_decisions.md` and `03_milestone_plan.md`. It answers four questions:

1. **Where does the demo stand against the specs?** A spec-by-spec table (§1).
2. **How does it perform?** Measured numbers, not estimates, for the demo and for a minimal version of the model the specs call for (§2).
3. **Which architecture should come next?** Six options compared in tables, from keeping one HTML file to a full Rust + Bevy rewrite (§3), with a recommendation.
4. **Could this reach Cities: Skylines (2015) parity as a single HTML file?** (§4)

**The short answer:** the demo's limit comes from its simulation model, not its language. Switching to the model the specs describe (discrete events and link queues) cut traffic cost per vehicle by about 1,500–2,000×. Switching from JavaScript to native Rust gained about 1.6×. The demo's renderer, road editor and UI are worth keeping. Its simulation core needs replacing whichever language is chosen.

Both test suites behind these numbers are in this repo and can be re-run (see [Re-running the measurements](#re-running-the-measurements)).

---

## 1. The demo against the specs

Based on reading `index.html` (10,715 lines) and running it.

| Spec | What the demo has | Verdict |
|---|---|---|
| Pillar 1: every person is real | Vehicles appear at the edge of the map and drive to another edge point (`trySpawn`). Nobody has a home, a job or needs. | **Missing** |
| Pillar 2 / ADR-007: economy and ledger | No money, taxes, budget or `transfer()` anywhere in the file | **Missing** |
| Zoning and buildings | Buildings are decoration: `buildCity()` fills whatever ground roads don't cover. No zoning, no capacity. | **Missing** (the procedural look can be reused) |
| ADR-001 discrete events | Fixed 20–50 ms steps; every vehicle is updated every step | **Replace** |
| ADR-002 link queues | Car-following (IDM), lane changes (MOBIL), gap acceptance at junctions | **Opposite model.** Richer per car, costly at scale. |
| ADR-003 routing | Flat Dijkstra, with the route cache invalidated every 2.5 s | Partial. It's the top cost at scale. |
| ADR-006 determinism | Seeded RNG; the audio section is the only place that uses `Math.random` | **Half.** Replays exactly from page load, but not after live play. Float time and positions. |
| GDD §8 time model | The clock moves 0.5 game-minutes per sim-second while cars move at real speed | **Doesn't match.** A "day" holds only 48 minutes of traffic. |
| ADR-012 render snapshot | The renderer reads live sim objects | Replace the interface; keep the look |
| Road editor (sections 1.6 PLAN and 2 compiler) | Any junction shape, incremental recompile, undo/redo | **Keep.** This is where most of the value is. |
| Instruments (GDD §11) | Inspector, follow camera, heat overlay, detectors, charts, speed and fps readout | **Keep and extend** |
| ADR-014 save/load | `localStorage` holds settings only; cities can't be saved | **Missing** |

---

## 2. Measurements

### 2a. The demo as it is

From `traffic-studio-3d/bench` (`npm run bench`). One thread, sim only unless noted. Run-to-run noise is about 30%.

| Grid | Vehicles | ms per step | µs per vehicle | Speed vs GDD 1× (60 sim-s per real s) | Draw cost per frame (JS only) |
|---|---|---|---|---|---|
| 4×4 | 32 | 0.03 | 1.0 | 26× | 0.8 ms |
| 16×16 | 957 | 1.05 | 1.1 | 0.8× | 2.2 ms |
| 24×24 | 1,646 | 2.55 | 1.6 | 0.33× | 3.8 ms |
| 32×32 | 6,784 | 20.8 | 3.1 | 0.04× | 16.9 ms |

What the numbers show:

- **Cost per vehicle triples as the city grows.** At 7K vehicles, a CPU profile puts about 33% of the time in `findRoute` and its heap, and about 21% in `findLeader`/`mayEnter`. Those two functions compare each car with nearby cars, which is the pairwise-cost problem ADR-000 warns about.
- **The frame budget is gone at 7K vehicles.** The draw step alone takes about 17 ms of JavaScript, which is the whole 60 fps budget before the GPU does anything.
- **The ceiling at GDD 1× is about 1,000 cars in transit on one core.** If 10–20% of people are on the road at once (ADR-012's figure), that's roughly 5–10K people, just short of M1.
- **Determinism:** the sim logic passes (same seed, same hash). Live play fails, because steps follow real frame timing.

### 2b. The model the specs call for, in three engines

From `experiments/des-kernel` (`node run.mjs`). This is a minimal ADR-001/002 kernel: link queues driven by discrete events. It is written the same way in JavaScript and in Rust, and the Rust version is also compiled to WebAssembly. It runs one game-day on a 100×100 grid, on one thread. **All three engines produce identical state hashes at every size.**

| Agents | Events per agent-day | JS | WASM | Rust native |
|---|---|---|---|---|
| 10K | 133 | 0.23 s (6,197× GDD 1×) | 0.12 s | 0.12 s |
| 100K | 135 | 2.9 s (496×) | 1.8 s | 1.7 s |
| 1M | 137 | 39 s (**37×**) | 26 s (55×) | 24 s (60×) |

Caveats:

- The kernel has no pathfinding, needs or economy.
- The speeds are a whole-day average. Rush hour is denser, so the speed that can be held at 8 a.m. will be lower.

Even so, the traffic core at 1M agents fits on one thread in plain JavaScript, with a lot of room left over.

### 2c. Model vs. language

| Change | Effect on traffic cost |
|---|---|
| Demo microsim → discrete-event link queues (same language) | about 1,500–2,000× cheaper per vehicle-second in transit |
| JavaScript → native Rust (same model) | about 1.6× faster |
| Rust WebAssembly → Rust native (same model) | about 1.05–1.4× |

How the model comparison was calculated:

- **Demo:** 15–21 ms per 0.05 s step with about 7K vehicles, which is about 45–60 µs per vehicle per simulated second.
- **Kernel:** about 1.3 billion vehicle-seconds in transit simulated in 39 s of JavaScript, which is about 0.03 µs per vehicle per simulated second.

---

## 3. Architecture options

| | A. One HTML file (now) | B. HTML + separate JS files | C. Bundled web app (TypeScript + Vite), sim in Web Workers | D. C with the sim in Rust → WASM | E. Rust sim engine + this frontend (Tauri or WebSocket) | F. Full Rust + Bevy rewrite (ADR-010) |
|---|---|---|---|---|---|---|
| Single-thread speed (measured, 1M agents) | 37× | 37× | 37× | 55× | 60× | 60× |
| Multi-core | Workers from Blob URLs; no shared memory from `file://` | Same | Workers passing messages; shared memory needs special server headers | Same as C | All cores, natively | All cores, natively |
| Memory ceiling | Browser tab (a few GB) | Same | Same | 4 GB (32-bit WASM) | Machine RAM | Machine RAM |
| Kept from the demo | Everything | Everything | Everything, split into modules | Renderer, editor, UI | Renderer, editor, UI | Behaviour and design only |
| Fit with the ADRs | Poor (006, 009, 013) | Poor | Good, except 010 | Good; a `sim` crate as ADR-010 wants | Very good | Exact |
| AI sessions | **Worst.** At 458 KB the file is too big to read in one pass; sessions work through it by section headers. | Better | Good (types, tests) | Good; the Rust compiler catches whole classes of bugs | Good | Good, but Bevy API churn |
| Ships as | A file you double-click | Needs a local server (browsers block module files opened from disk) | One HTML file as the build output | Same | Installer or local server | Native binary |
| Realistic reach | M1 | M1–M2 | M2, maybe M3 | M3; M4 limited by browser rendering | M4 | M4 |
| Main risk | Won't scale past M1 | Same risk without a build step | JS without determinism guarantees | Two languages to maintain | Keeping sim and view in sync across the process boundary | Throws away the demo's frontend |

### Recommendation: D, set up so it can grow into E

1. Write the `sim` crate that ADR-010 already describes. Build it natively for the headless M0–M3 benchmarks, and to WASM for the browser.
2. Put the demo's renderer, editor and instruments on top of it, reading through an ADR-012 snapshot.
3. If browser threads or 1M-agent rendering fail at M4, move the same crate into Tauri (option E) or Bevy (option F). The sim doesn't change in either case.

The measurements above already cover most of M0: identical hashes across engines (ADR-006) and 1K–1M numbers. The one gap is a wall-clock tracer (Tracy, which the plan specifies); a CPU profile stood in for it.

---

## 4. Cities: Skylines (2015) parity as one HTML file?

**The technology is yes. As a single source file, no. And the real barrier is how much there is to build.**

- **Scale is not the obstacle.** Cities: Skylines runs about 65K active citizens (the GDD's figure). The engine limits recalled here, which are unverified, are about 16K vehicles and a 9-tile map. The WASM kernel shows that scale fits in a browser with lots of headroom.
- **A single file works as a build output.** The bundler in options C and D can still produce one HTML file. Procedural art, which the demo already uses, keeps its size small.
- **Parity needs many systems the demo doesn't have:**
  - zoning and building growth
  - water and power networks
  - services
  - buses, metro and trains
  - terrain and water
  - districts and policies
  - budget and economy
  - save/load
  - a large UI
- **A single source file is the practical blocker.** The original was built by a professional studio over several years (team size and timeline not checked here). At 10K lines, one file already stops an AI session from seeing the whole codebase, and parity would be many times that.

---

## Limits of this assessment

- Everything was measured on one 4-core Xeon container at 2.1 GHz, one thread only. No multi-core speedup was measured.
- The headless GPU was a software renderer, so GPU cost wasn't measured. The draw costs above are JavaScript only.
- The DES kernel leaves out pathfinding, needs and economy.
- The Cities: Skylines engine limits are from memory, not checked.

## Re-running the measurements

| Suite | Location | Command | Output |
|---|---|---|---|
| Demo scaling ladder and determinism check | `traffic-studio-3d/bench/` | `npm install && npm run bench` | Table on stdout; `results/<timestamp>.json` |
| DES kernel in JS / WASM / Rust | `experiments/des-kernel/` | Build the Rust crate (see its README), then `node --max-old-space-size=8192 run.mjs` | Table on stdout; `results/<timestamp>.json` |

Commit the result JSON files each time. Together they form the scaling ledger from `03_milestone_plan.md`.

The only change to `index.html` is five extra entries on its existing `window.GRID3D` test handle: `layoutGrid`, `LAYOUTS`, `findRoute`, `bumpRouteCache` and `reseed`. Gameplay is unchanged.
