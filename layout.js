/* Tree layout: generations as rows, couples as blocks, children centred under their parents. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./relations.js'));
  else root.TreeLayout = factory(root.Relations);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const NODE_W = 160, NODE_H = 62, GAP_X = 30, SPOUSE_GAP = 16, GAP_Y = 100, MARGIN = 40;
  const yearOf = s => { const m = /\d{4}/.exec(s || ''); return m ? +m[0] : Infinity; };

  function layout(people) {
    const ix = R.buildIndex(people);
    const ids = people.map(p => p.id);
    const idx = new Map(ids.map((id, i) => [id, i]));

    // 1. generation of every person
    const level = new Map(ids.map(id => [id, 0]));
    for (let it = 0; it < ids.length + 5; it++) {
      let changed = false;
      for (const id of ids) {
        const parents = ix.parentsOf.get(id);
        for (const pa of parents) if (level.get(pa) + 1 > level.get(id)) { level.set(id, level.get(pa) + 1); changed = true; }
        for (const s of ix.spouses.get(id)) if (level.get(s) > level.get(id)) { level.set(id, level.get(s)); changed = true; }
        if (!parents.length) {
          const kids = ix.children.get(id);
          if (kids.length) {
            const t = Math.min(...kids.map(k => level.get(k))) - 1;
            if (t > level.get(id)) { level.set(id, t); changed = true; }
          }
        }
      }
      if (!changed) break;
    }
    const minLevel = ids.length ? Math.min(...ids.map(i => level.get(i))) : 0;
    ids.forEach(i => level.set(i, level.get(i) - minLevel));

    // 2. blocks = people joined by marriage, laid out side by side
    const blockOf = new Map(), blocks = [];
    const orderChain = comp => {
      if (comp.length <= 2) return comp.slice().sort((a, b) => (ix.byId.get(a).gender === 'M' ? 0 : 1) - (ix.byId.get(b).gender === 'M' ? 0 : 1) || idx.get(a) - idx.get(b));
      const inComp = new Set(comp);
      const deg = id => [...ix.spouses.get(id)].filter(s => inComp.has(s)).length;
      const start = comp.slice().sort((a, b) => deg(a) - deg(b) || idx.get(a) - idx.get(b))[0];
      const seen = new Set([start]), out = [];
      (function dfs(x) { out.push(x); for (const s of ix.spouses.get(x)) if (inComp.has(s) && !seen.has(s)) { seen.add(s); dfs(s); } })(start);
      return out;
    };
    const setMembers = (b, members) => {
      b.members = members; b.offset = {};
      members.forEach((m, j) => { b.offset[m] = j * (NODE_W + SPOUSE_GAP); });
      b.width = members.length * NODE_W + (members.length - 1) * SPOUSE_GAP;
    };
    for (const id of ids) {
      if (blockOf.has(id)) continue;
      const comp = [], stack = [id];
      blockOf.set(id, -1);
      while (stack.length) { const x = stack.pop(); comp.push(x); for (const s of ix.spouses.get(x)) if (!blockOf.has(s)) { blockOf.set(s, -1); stack.push(s); } }
      const lv = Math.max(...comp.map(c => level.get(c)));
      comp.forEach(c => level.set(c, lv));
      const b = { id: blocks.length, level: lv, left: 0 };
      setMembers(b, orderChain(comp));
      const withParents = b.members.filter(m => ix.parentsOf.get(m).length);
      b.sortKey = Math.min(...(withParents.length ? withParents : b.members).map(m => yearOf(ix.byId.get(m).born)));
      b.order = Math.min(...b.members.map(m => idx.get(m)));
      b.members.forEach(m => blockOf.set(m, b.id));
      blocks.push(b);
    }
    const maxLevel = blocks.length ? Math.max(...blocks.map(b => b.level)) : 0;
    const levels = Array.from({ length: maxLevel + 1 }, () => []);
    blocks.forEach(b => levels[b.level].push(b));
    // Fix the left-to-right order of every row by walking down from the oldest ancestors, so each
    // family's children always stay together (this order is never changed afterwards).
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const childBlocks = b => {
      const out = [], seenB = new Set();
      for (const m of b.members) {
        const ks = ix.children.get(m).slice().sort((p, q) => cmp(yearOf(ix.byId.get(p).born), yearOf(ix.byId.get(q).born)) || idx.get(p) - idx.get(q));
        for (const k of ks) { const kb = blocks[blockOf.get(k)]; if (!seenB.has(kb.id)) { seenB.add(kb.id); out.push(kb); } }
      }
      return out;
    };
    const roots = blocks.filter(b => !b.members.some(m => ix.parentsOf.get(m).length)).sort((a, b) => cmp(a.sortKey, b.sortKey) || a.order - b.order);
    const visited = new Set(), seq = [];
    const visit = b => { if (visited.has(b.id)) return; visited.add(b.id); seq.push(b); childBlocks(b).forEach(visit); };
    roots.forEach(visit); blocks.forEach(visit);
    levels.forEach(lv => { lv.length = 0; });
    seq.forEach(b => levels[b.level].push(b));
    levels.forEach(lv => { let x = 0; lv.forEach(b => { b.left = x; x += b.width + GAP_X; }); });

    const mx = id => { const b = blocks[blockOf.get(id)]; return b.left + b.offset[id] + NODE_W / 2; };

    // least-squares placement of one row, keeping order and minimum spacing (pool-adjacent-violators)
    const place = (lv, desired) => {
      const items = lv.map((b, i) => ({ b, i, d: desired.has(b.id) ? desired.get(b.id) : b.left }));
      const o = []; let off = 0;
      items.forEach(it => { o.push(off); off += it.b.width + GAP_X; });
      const groups = [];
      items.forEach((it, k) => {
        groups.push({ sum: it.d - o[k], n: 1, start: k });
        while (groups.length > 1) {
          const a = groups[groups.length - 2], c = groups[groups.length - 1];
          if (a.sum / a.n > c.sum / c.n) { a.sum += c.sum; a.n += c.n; groups.pop(); } else break;
        }
      });
      groups.forEach(gr => { const v = gr.sum / gr.n; for (let k = gr.start; k < gr.start + gr.n; k++) items[k].b.left = v + o[k]; });
    };
    const parentAttach = id => { const ps = ix.parentsOf.get(id); return ps.length ? ps.reduce((s, p) => s + mx(p), 0) / ps.length : null; };

    for (let pass = 0; pass < 8; pass++) {
      for (let l = 1; l <= maxLevel; l++) {
        const desired = new Map();
        for (const b of levels[l]) {
          // turn a couple so the spouse whose parents sit further left goes on the left
          if (b.members.length === 2) {
            const [m0, m1] = b.members, a0 = parentAttach(m0), a1 = parentAttach(m1);
            const centre = b.left + b.width / 2;
            const flip = (a0 !== null && a1 !== null) ? a0 > a1 : (a0 !== null ? a0 > centre : a1 !== null ? a1 < centre : false);
            if (flip) setMembers(b, [m1, m0]);
          }
          const t = [];
          for (const m of b.members) { const a = parentAttach(m); if (a !== null) t.push(a - (b.offset[m] + NODE_W / 2)); }
          if (t.length) desired.set(b.id, t.reduce((s, v) => s + v, 0) / t.length);
        }
        place(levels[l], desired);
      }
      for (let l = maxLevel - 1; l >= 0; l--) {
        const desired = new Map();
        for (const b of levels[l]) {
          const parentsWithKids = b.members.filter(m => ix.children.get(m).length);
          if (!parentsWithKids.length) continue;
          const kids = new Set();
          parentsWithKids.forEach(m => ix.children.get(m).forEach(k => kids.add(k)));
          const kx = [...kids].reduce((s, k) => s + mx(k), 0) / kids.size;
          const anchor = parentsWithKids.reduce((s, m) => s + b.offset[m] + NODE_W / 2, 0) / parentsWithKids.length;
          desired.set(b.id, kx - anchor);
        }
        place(levels[l], desired);
      }
    }

    // 3. coordinates
    let minX = Infinity, maxX = -Infinity;
    const nodes = new Map();
    for (const b of blocks) for (const m of b.members) {
      const x = b.left + b.offset[m];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + NODE_W);
      nodes.set(m, { id: m, x, y: b.level * (NODE_H + GAP_Y), level: b.level });
    }
    if (!isFinite(minX)) { minX = 0; maxX = 0; }
    nodes.forEach(n => { n.x = n.x - minX + MARGIN; n.y += MARGIN; });
    const width = maxX - minX + MARGIN * 2, height = (maxLevel + 1) * NODE_H + maxLevel * GAP_Y + MARGIN * 2;

    // 4. edges
    const spouseEdges = [], seen = new Set(), attach = new Map();
    for (const a of ids) for (const b of ix.spouses.get(a)) {
      const key = R.pairKey(a, b);
      if (seen.has(key)) continue; seen.add(key);
      let l = nodes.get(a), r = nodes.get(b);
      if (l.x > r.x) [l, r] = [r, l];
      const cy = l.y + NODE_H / 2;
      const adjacent = Math.abs(r.x - (l.x + NODE_W)) < SPOUSE_GAP + 1;
      let d, ax, ay;
      if (adjacent) { d = `M${l.x + NODE_W} ${cy} H${r.x}`; ax = (l.x + NODE_W + r.x) / 2; ay = cy; }
      else {
        const by = l.y + NODE_H, dip = by + 18, lx = l.x + NODE_W / 2, rx = r.x + NODE_W / 2;
        d = `M${lx} ${by} V${dip} H${rx} V${by}`; ax = (lx + rx) / 2; ay = dip;
      }
      attach.set(key, { x: ax, y: ay });
      spouseEdges.push({ a, b, key, d, implicit: ix.implicit.has(key) });
    }
    // Children of one family share a horizontal "bus". Families whose buses would overlap get separate
    // lanes, and every family gets its own colour, so unrelated families never look joined together.
    const families = new Map();
    for (const c of ids) {
      const ps = ix.parentsOf.get(c);
      if (!ps.length) continue;
      const cn = nodes.get(c), cx = cn.x + NODE_W / 2;
      let ax, ay;
      const key = ps.length === 2 ? R.pairKey(ps[0], ps[1]) : null;
      if (key && attach.has(key)) ({ x: ax, y: ay } = attach.get(key));
      else { const p = nodes.get(ps[0]); ax = p.x + NODE_W / 2; ay = p.y + NODE_H; }
      const fk = cn.level + '#' + ps.slice().sort().join('|');
      if (!families.has(fk)) families.set(fk, { level: cn.level, top: cn.y, ax, ay, kids: [] });
      families.get(fk).kids.push({ c, ps, cx });
    }
    const perLevel = new Map();
    for (const f of families.values()) {
      f.lo = Math.min(f.ax, ...f.kids.map(k => k.cx)); f.hi = Math.max(f.ax, ...f.kids.map(k => k.cx));
      if (!perLevel.has(f.level)) perLevel.set(f.level, []);
      perLevel.get(f.level).push(f);
    }
    const childEdges = [];
    for (const [lvl, list] of perLevel) {
      list.sort((a, b) => a.lo - b.lo);
      const laneEnd = [];
      list.forEach((f, i) => {
        let lane = laneEnd.findIndex(end => end < f.lo - 10);
        if (lane < 0) lane = laneEnd.length;
        laneEnd[lane] = f.hi; f.lane = lane;
        f.hue = Math.round((i * 137.5 + lvl * 50) % 360);
      });
      const step = Math.min(9, (GAP_Y - 44) / Math.max(1, laneEnd.length - 1));
      for (const f of list) {
        const busY = f.top - GAP_Y / 2 + (f.lane - (laneEnd.length - 1) / 2) * step;
        for (const k of f.kids) {
          childEdges.push({ child: k.c, parents: k.ps, keys: k.ps.map(p => R.pairKey(k.c, p)), hue: f.hue, d: `M${f.ax} ${f.ay} V${busY} H${k.cx} V${f.top}` });
        }
      }
    }
    return { nodes, spouseEdges, childEdges, width, height, NODE_W, NODE_H };
  }

  return { layout, NODE_W, NODE_H };
});
