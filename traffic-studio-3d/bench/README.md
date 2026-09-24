# Traffic Studio benchmark

A headless scaling benchmark for `../index.html`. It loads the page in
headless Chromium, stops the frame loop, and runs the simulation directly
through `window.GRID3D` on grids of increasing size.

```
npm install
npm run bench          # full ladder, 4x4 to 32x32 (a few minutes)
npm run bench:quick    # 4x4 and 8x8 only
```

Three.js and Clipper are downloaded once into `.vendor/` and served from
there, so a run does not depend on the browser reaching a CDN.

Each run prints a table and writes `results/<timestamp>.json` with the
machine it ran on. Commit the result files: they make up the scaling ledger.

| Column | Meaning |
|---|---|
| `vehicles` | mean vehicles on the network during measurement |
| `stepMs` | wall time of one 50 ms simulation step, single thread, no rendering |
| `usPerVeh` | `stepMs` per vehicle. **Should stay flat as scale grows**; if it rises, cost is growing faster than linearly |
| `simSpeed` | simulated seconds per real second, sim only (1.0 = real time) |
| `routeUs` | one uncached Dijkstra search between two spread-out junctions |
| `drawJsMs` | JavaScript cost of one frame's scene update, GPU time excluded |

**Determinism** is checked twice, with the same seed in two fresh pages each time:

- *Replay from load*: the frame loop never runs, so only the benchmark's own
  calls advance the sim. This tests the simulation logic.
- *After live play*: the page runs normally for 1.5 s first, stepping by real
  frame times, and then the same replay is attempted.

The exit code is non-zero only when *replay from load* fails.
