//! Link-queue traffic as a discrete-event simulation (ADR-001, ADR-002),
//! in its smallest form. `kernel.mjs` is the same algorithm in JavaScript,
//! line for line, and both must print the same hash for the same inputs.
//!
//! World: a G x G grid of junctions 140 m apart. Every directed link takes
//! 10 s at free flow, holds 36 vehicles, and lets one vehicle out per second.
//! Agents: each has a home and a work junction. It leaves home between 07:00
//! and 09:00, drives to work, leaves 8 h after arriving, and drives home.
//! The route is x first, then y. The next hop is O(1), standing in for a
//! cached habitual route (ADR-003). No pathfinding cost is measured.
//! Time is integer seconds. Events are ordered by (time, agent), so a run is
//! a pure function of (G, N, seed).

const TT: u32 = 10; // free-flow seconds per link
const CAP: u32 = 36; // storage per link
const STUCK: u32 = 300; // after this long blocked, a vehicle is let through (MATSim's stuck time)

#[inline]
fn hash32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846ca68b);
    x ^ (x >> 16)
}

struct Heap {
    k: Vec<u64>,
}
impl Heap {
    fn push(&mut self, key: u64) {
        let k = &mut self.k;
        let mut i = k.len();
        k.push(key);
        while i > 0 {
            let p = (i - 1) >> 1;
            if k[p] <= k[i] {
                break;
            }
            k.swap(p, i);
            i = p;
        }
    }
    fn pop(&mut self) -> Option<u64> {
        let k = &mut self.k;
        let n = k.len();
        if n == 0 {
            return None;
        }
        let top = k[0];
        let last = k.pop().unwrap();
        let n = n - 1;
        if n > 0 {
            k[0] = last;
            let mut i = 0;
            loop {
                let l = 2 * i + 1;
                if l >= n {
                    break;
                }
                let r = l + 1;
                let m = if r < n && k[r] < k[l] { r } else { l };
                if k[i] <= k[m] {
                    break;
                }
                k.swap(i, m);
                i = m;
            }
        }
        Some(top)
    }
}

pub struct Result {
    pub events: u64,
    pub hash: u32,
    pub trips: u32,
}

pub fn simulate(g: u32, n: u32, seed: u32) -> Result {
    let nodes = g * g;
    let mut occ = vec![0u32; (nodes * 4) as usize];
    let mut next_exit = vec![0u32; (nodes * 4) as usize];
    let mut home = vec![0u32; n as usize];
    let mut work = vec![0u32; n as usize];
    let mut link = vec![u32::MAX; n as usize]; // current link, MAX when parked
    let mut at = vec![0u32; n as usize]; // junction when parked
    let mut phase = vec![0u8; n as usize]; // 0 to work, 1 to home, 2 done
    let mut wait_since = vec![0u32; n as usize];
    let mut heap = Heap { k: Vec::with_capacity(n as usize) };

    for a in 0..n {
        let h = hash32(seed ^ hash32(a.wrapping_mul(3) + 1));
        let w = hash32(seed ^ hash32(a.wrapping_mul(3) + 2));
        let d = hash32(seed ^ hash32(a.wrapping_mul(3) + 3));
        home[a as usize] = h % nodes;
        work[a as usize] = w % nodes;
        at[a as usize] = home[a as usize];
        wait_since[a as usize] = u32::MAX;
        let t = 7 * 3600 + d % 7200;
        heap.push(((t as u64) << 32) | a as u64);
    }

    let mut events: u64 = 0;
    let mut trips: u32 = 0;
    while let Some(key) = heap.pop() {
        events += 1;
        let now = (key >> 32) as u32;
        let a = (key & 0xffff_ffff) as usize;
        let cur = link[a];
        // the junction this agent is at (parked) or heading into (on a link)
        let node = if cur == u32::MAX { at[a] } else { link_head(cur, g) };
        let dest = if phase[a] == 0 { work[a] } else { home[a] };

        if cur != u32::MAX {
            // flow capacity: one vehicle out of a link per second
            if next_exit[cur as usize] > now {
                heap.push(((next_exit[cur as usize] as u64) << 32) | a as u64);
                continue;
            }
        }
        if node == dest {
            if cur != u32::MAX {
                next_exit[cur as usize] = now + 1;
                occ[cur as usize] -= 1;
                link[a] = u32::MAX;
            }
            at[a] = node;
            trips += 1;
            if phase[a] == 0 {
                phase[a] = 1;
                heap.push((((now + 8 * 3600) as u64) << 32) | a as u64);
            } else {
                phase[a] = 2;
            }
            continue;
        }
        let nx = next_link(node, dest, g);
        let nxu = nx as usize;
        let blocked = occ[nxu] >= CAP;
        if blocked {
            if wait_since[a] == u32::MAX {
                wait_since[a] = now;
            }
            if now - wait_since[a] < STUCK {
                heap.push((((now + 1) as u64) << 32) | a as u64);
                continue;
            }
        }
        wait_since[a] = u32::MAX;
        if cur != u32::MAX {
            next_exit[cur as usize] = now + 1;
            occ[cur as usize] -= 1;
        }
        occ[nxu] += 1;
        link[a] = nx;
        heap.push((((now + TT) as u64) << 32) | a as u64);
    }

    let mut h: u32 = 2166136261;
    for i in 0..(nodes * 4) as usize {
        h = (h ^ next_exit[i]).wrapping_mul(16777619);
    }
    for a in 0..n as usize {
        h = (h ^ at[a]).wrapping_mul(16777619);
    }
    Result { events, hash: h, trips }
}

// link id = from_node * 4 + dir; dir 0 +x, 1 -x, 2 +y, 3 -y
#[inline]
fn next_link(node: u32, dest: u32, g: u32) -> u32 {
    let (x, y) = (node % g, node / g);
    let (dx, dy) = (dest % g, dest / g);
    let dir = if dx > x { 0 } else if dx < x { 1 } else if dy > y { 2 } else { 3 };
    node * 4 + dir
}
#[inline]
fn link_head(l: u32, g: u32) -> u32 {
    let from = l / 4;
    match l % 4 {
        0 => from + 1,
        1 => from - 1,
        2 => from + g,
        _ => from - g,
    }
}

static mut LAST_HASH: u32 = 0;
static mut LAST_TRIPS: u32 = 0;

/// WebAssembly entry point: returns the event count.
#[no_mangle]
pub extern "C" fn run(g: u32, n: u32, seed: u32) -> f64 {
    let r = simulate(g, n, seed);
    unsafe {
        LAST_HASH = r.hash;
        LAST_TRIPS = r.trips;
    }
    r.events as f64
}
#[no_mangle]
pub extern "C" fn last_hash() -> u32 {
    unsafe { LAST_HASH }
}
#[no_mangle]
pub extern "C" fn last_trips() -> u32 {
    unsafe { LAST_TRIPS }
}
