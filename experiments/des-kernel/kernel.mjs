/* The link-queue DES kernel in JavaScript: the same algorithm as
   rust/src/lib.rs, line for line, on typed arrays. It must produce
   the same hash for the same (G, N, seed). */
const TT = 10, CAP = 36, STUCK = 300, NONE = 0xffffffff, HI = 4294967296;

function hash32(x){
  x >>>= 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function simulate(g, n, seed){
  const nodes = g * g;
  const occ = new Uint32Array(nodes * 4), nextExit = new Uint32Array(nodes * 4);
  const home = new Uint32Array(n), work = new Uint32Array(n);
  const link = new Uint32Array(n).fill(NONE), at = new Uint32Array(n);
  const phase = new Uint8Array(n), waitSince = new Uint32Array(n);

  /* binary min-heap of time * 2^32 + agent, exact in a double */
  const hk = new Float64Array(n + 1); let hn = 0;
  const push = key => {
    let i = hn++; hk[i] = key;
    while (i > 0){ const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; const t = hk[p]; hk[p] = hk[i]; hk[i] = t; i = p; }
  };
  const pop = () => {
    const top = hk[0]; const last = hk[--hn];
    if (hn > 0){
      hk[0] = last; let i = 0;
      for (;;){
        const l = 2 * i + 1; if (l >= hn) break;
        const r = l + 1; const m = r < hn && hk[r] < hk[l] ? r : l;
        if (hk[i] <= hk[m]) break;
        const t = hk[i]; hk[i] = hk[m]; hk[m] = t; i = m;
      }
    }
    return top;
  };

  for (let a = 0; a < n; a++){
    const h = hash32(seed ^ hash32(Math.imul(a, 3) + 1));
    const w = hash32(seed ^ hash32(Math.imul(a, 3) + 2));
    const d = hash32(seed ^ hash32(Math.imul(a, 3) + 3));
    home[a] = h % nodes; work[a] = w % nodes; at[a] = home[a]; waitSince[a] = NONE;
    push((7 * 3600 + d % 7200) * HI + a);
  }

  let events = 0, trips = 0;
  while (hn > 0){
    const key = pop(); events++;
    const now = Math.floor(key / HI), a = key - now * HI;
    const cur = link[a];
    const node = cur === NONE ? at[a] : linkHead(cur, g);
    const dest = phase[a] === 0 ? work[a] : home[a];

    if (cur !== NONE && nextExit[cur] > now){ push(nextExit[cur] * HI + a); continue; }
    if (node === dest){
      if (cur !== NONE){ nextExit[cur] = now + 1; occ[cur]--; link[a] = NONE; }
      at[a] = node; trips++;
      if (phase[a] === 0){ phase[a] = 1; push((now + 8 * 3600) * HI + a); }
      else phase[a] = 2;
      continue;
    }
    const nx = nextLink(node, dest, g);
    if (occ[nx] >= CAP){
      if (waitSince[a] === NONE) waitSince[a] = now;
      if (now - waitSince[a] < STUCK){ push((now + 1) * HI + a); continue; }
    }
    waitSince[a] = NONE;
    if (cur !== NONE){ nextExit[cur] = now + 1; occ[cur]--; }
    occ[nx]++; link[a] = nx;
    push((now + TT) * HI + a);
  }

  let h = 2166136261;
  for (let i = 0; i < nodes * 4; i++) h = Math.imul(h ^ nextExit[i], 16777619) >>> 0;
  for (let a = 0; a < n; a++) h = Math.imul(h ^ at[a], 16777619) >>> 0;
  return { events, trips, hash: h.toString(16).padStart(8, '0') };
}

function nextLink(node, dest, g){
  const x = node % g, y = (node / g) | 0, dx = dest % g, dy = (dest / g) | 0;
  const dir = dx > x ? 0 : dx < x ? 1 : dy > y ? 2 : 3;
  return node * 4 + dir;
}
function linkHead(l, g){
  const from = (l / 4) | 0;
  switch (l % 4){ case 0: return from + 1; case 1: return from - 1; case 2: return from + g; default: return from - g; }
}
