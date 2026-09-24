# Link-queue DES kernel: JS vs WebAssembly vs native Rust

The smallest version of the simulation model in ADR-001 (discrete events)
and ADR-002 (link queues). The same algorithm is written twice: in
`kernel.mjs`, and in `rust/src/lib.rs`, which builds both natively and to
WebAssembly. It runs one game-day on one thread, and all three engines must
produce the same hash.

```
cd rust && cargo build --release \
        && cargo build --release --target wasm32-unknown-unknown --lib && cd ..
node --max-old-space-size=8192 run.mjs              # 1K, 10K, 100K, 1M agents
node run.mjs 50000                                  # or any sizes
```

What it models: a 100x100 junction grid, links of 10 s free-flow with
36-vehicle storage and one exit per second, spillback, and MATSim's 300 s
stuck rule. Each agent commutes home to work and back.

What it leaves out: pathfinding (the next hop is O(1), standing in for a
cached route), needs, economy, rendering, and multiple threads. Read the
numbers as the cost of the traffic core alone, and as the ratio between
engines.

`speedVs1x` compares against GDD §8's 1x clock, 24 real minutes per
game-day.
