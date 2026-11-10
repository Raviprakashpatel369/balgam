/* Relationship engine: builds a graph index from people and works out how two people are related. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Relations = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  // people: [{id, name, gender:'M'|'F'|'', parents:[id], spouses:[id]}]
  function buildIndex(people) {
    const byId = new Map(), children = new Map(), spouses = new Map(), parentsOf = new Map();
    const implicit = new Set();
    people.forEach(p => { byId.set(p.id, p); children.set(p.id, []); spouses.set(p.id, new Set()); });
    people.forEach(p => {
      const ps = (p.parents || []).filter(x => byId.has(x) && x !== p.id);
      parentsOf.set(p.id, ps);
      ps.forEach(x => children.get(x).push(p.id));
    });
    const link = (a, b, imp) => {
      if (a === b || !byId.has(a) || !byId.has(b) || spouses.get(a).has(b)) return;
      spouses.get(a).add(b); spouses.get(b).add(a);
      if (imp) implicit.add(pairKey(a, b));
    };
    people.forEach(p => (p.spouses || []).forEach(s => link(p.id, s, false)));
    // two people who share a child are partners even if no marriage is recorded
    people.forEach(p => { const ps = parentsOf.get(p.id); if (ps.length === 2) link(ps[0], ps[1], true); });
    return { byId, children, spouses, parentsOf, implicit };
  }

  // ---------- wording ----------
  const g = (p, m, f, n) => (p && p.gender === 'M' ? m : p && p.gender === 'F' ? f : n);
  const greatPrefix = k => (k <= 0 ? '' : k <= 3 ? 'great-'.repeat(k) : k + '× great-');
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const ancestorTerm = (n, p) => n === 1 ? g(p, 'father', 'mother', 'parent') : greatPrefix(n - 2) + g(p, 'grandfather', 'grandmother', 'grandparent');
  const descendantTerm = (n, p) => n === 1 ? g(p, 'son', 'daughter', 'child') : greatPrefix(n - 2) + g(p, 'grandson', 'granddaughter', 'grandchild');
  const spouseTerm = p => g(p, 'husband', 'wife', 'spouse');

  // What is A to B, when A is dA generations below the common ancestor and B is dB generations below it
  function bloodTerm(dA, dB, p, half) {
    const h = half ? 'half-' : '';
    if (dA === 0) return ancestorTerm(dB, p);
    if (dB === 0) return descendantTerm(dA, p);
    if (dA === 1 && dB === 1) return h + g(p, 'brother', 'sister', 'sibling');
    if (dA === 1) return h + greatPrefix(dB - 2) + g(p, 'uncle', 'aunt', 'uncle/aunt');
    if (dB === 1) return h + greatPrefix(dA - 2) + g(p, 'nephew', 'niece', 'nephew/niece');
    const k = Math.min(dA, dB) - 1, r = Math.abs(dA - dB);
    let t = h + ordinal(k) + ' cousin';
    if (r) t += ' ' + (r === 1 ? 'once' : r === 2 ? 'twice' : r + ' times') + ' removed';
    return t;
  }

  // ---------- blood relations ----------
  function ancMap(ix, id) {
    const m = new Map([[id, 0]]);
    let frontier = [id], d = 0;
    while (frontier.length) {
      d++;
      const next = [];
      for (const x of frontier) for (const p of ix.parentsOf.get(x)) if (!m.has(p)) { m.set(p, d); next.push(p); }
      frontier = next;
    }
    return m;
  }

  // shortest route going upward from -> to (inclusive), or []
  function pathUp(ix, from, to) {
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const x = q.shift();
      if (x === to) break;
      for (const p of ix.parentsOf.get(x)) if (!prev.has(p)) { prev.set(p, x); q.push(p); }
    }
    if (!prev.has(to)) return [];
    const out = [];
    for (let c = to; c !== null; c = prev.get(c)) out.push(c);
    return out.reverse();
  }

  function findBlood(ix, a, b) {
    if (a === b) return null;
    const MA = ancMap(ix, a), MB = ancMap(ix, b);
    let best = Infinity, list = [];
    for (const [id, dA] of MA) {
      if (!MB.has(id)) continue;
      const t = dA + MB.get(id);
      if (t < best) { best = t; list = [id]; } else if (t === best) list.push(id);
    }
    if (!list.length) return null;
    const dA = MA.get(list[0]), dB = MB.get(list[0]);
    const lcas = list.filter(id => MA.get(id) === dA && MB.get(id) === dB);
    let half = false, note = null;
    if (dA >= 1 && dB >= 1 && lcas.length === 1) {
      const below = (x) => { const p = pathUp(ix, x, lcas[0]); return p[p.length - 2]; };
      const pa = ix.parentsOf.get(below(a)).length, pb = ix.parentsOf.get(below(b)).length;
      if (pa >= 2 && pb >= 2) half = true;
      else note = 'Only one shared ancestor is recorded (the other parent may be unknown), so this could really be a full relation.';
    }
    return { dA, dB, lcas, half, note };
  }

  // ---------- marriage-based relations ----------
  // A is the spouse of S, and S is blood-related to B
  function viaOwnSpouse(bl, A) {
    const { dA: dS, dB } = bl;
    if (dS === 0) return dB === 1 ? g(A, 'stepfather', 'stepmother', 'stepparent') : greatPrefix(dB - 2) + g(A, 'step-grandfather', 'step-grandmother', 'step-grandparent');
    if (dB === 0) return dS === 1 ? g(A, 'son-in-law', 'daughter-in-law', 'child-in-law') : greatPrefix(dS - 2) + g(A, 'grandson-in-law', 'granddaughter-in-law', 'grandchild-in-law');
    if (dS === 1 && dB === 1) return g(A, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    if (dS === 1) return greatPrefix(dB - 2) + g(A, 'uncle', 'aunt', 'uncle/aunt') + ' by marriage';
    if (dB === 1) return greatPrefix(dS - 2) + g(A, 'nephew', 'niece', 'nephew/niece') + ' by marriage';
    return 'cousin-in-law';
  }
  // B's spouse is T, and A is blood-related to T
  function viaOtherSpouse(bl, A) {
    const { dA, dB: dT } = bl;
    if (dA === 0) return dT === 1 ? g(A, 'father-in-law', 'mother-in-law', 'parent-in-law') : greatPrefix(dT - 2) + g(A, 'grandfather-in-law', 'grandmother-in-law', 'grandparent-in-law');
    if (dT === 0) return dA === 1 ? g(A, 'stepson', 'stepdaughter', 'stepchild') : greatPrefix(dA - 2) + g(A, 'step-grandson', 'step-granddaughter', 'step-grandchild');
    if (dA === 1 && dT === 1) return g(A, 'brother-in-law', 'sister-in-law', 'sibling-in-law');
    if (dA === 1) return greatPrefix(dT - 2) + g(A, 'uncle-in-law', 'aunt-in-law', 'uncle/aunt-in-law');
    if (dT === 1) return greatPrefix(dA - 2) + g(A, 'nephew-in-law', 'niece-in-law', 'nephew/niece-in-law');
    return 'cousin-in-law';
  }

  // What is A to B? -> {kind, term, cost, via:[ids], notes:[], blood} or null
  function relateOne(ix, aId, bId) {
    if (aId === bId) return { kind: 'self' };
    const A = ix.byId.get(aId), B = ix.byId.get(bId);
    const bl = findBlood(ix, aId, bId);
    if (bl) return { kind: 'blood', term: bloodTerm(bl.dA, bl.dB, A, bl.half), blood: bl, via: bl.lcas, notes: bl.note ? [bl.note] : [] };

    const c = [];
    if (ix.spouses.get(aId).has(bId)) {
      c.push({ cost: 1, term: ix.implicit.has(pairKey(aId, bId)) ? 'partner' : spouseTerm(A), via: [] });
    }
    for (const S of ix.spouses.get(aId)) {
      if (S === bId) continue;
      const x = findBlood(ix, S, bId);
      if (x) c.push({ cost: x.dA + x.dB + 1, term: viaOwnSpouse(x, A), via: [S] });
    }
    for (const T of ix.spouses.get(bId)) {
      if (T === aId) continue;
      const x = findBlood(ix, aId, T);
      if (x) c.push({ cost: x.dA + x.dB + 1, term: viaOtherSpouse(x, A), via: [T] });
    }
    for (const S of ix.spouses.get(aId)) for (const T of ix.spouses.get(bId)) {
      if (S === bId || T === aId) continue;
      if (S === T) { c.push({ cost: 2, term: g(A, 'co-husband', 'co-wife', 'co-spouse'), via: [S] }); continue; }
      const x = findBlood(ix, S, T);
      if (x && x.dA === 1 && x.dB === 1) c.push({ cost: 4, term: g(A, 'co-brother-in-law', 'co-sister-in-law', 'co-sibling-in-law'), via: [S, T],
        note: 'Your spouses are siblings.' });
    }
    // co-parents-in-law: my child is married to your child
    for (const ch of ix.children.get(aId)) for (const ch2 of ix.children.get(bId)) {
      if (ix.spouses.get(ch).has(ch2) && !ix.parentsOf.get(ch).includes(bId) && !ix.parentsOf.get(ch2).includes(aId)) {
        c.push({ cost: 4, term: g(A, 'co-father-in-law', 'co-mother-in-law', 'co-parent-in-law'), via: [ch, ch2], note: 'Your children are married to each other.' });
      }
    }
    // step-siblings: my parent is partnered with your parent
    for (const P of ix.parentsOf.get(aId)) for (const Q of ix.parentsOf.get(bId)) {
      if (ix.spouses.get(P).has(Q) && !ix.parentsOf.get(aId).includes(Q) && !ix.parentsOf.get(bId).includes(P)) {
        c.push({ cost: 3, term: g(A, 'stepbrother', 'stepsister', 'stepsibling'), via: [P, Q] });
      }
    }
    if (!c.length) return null;
    c.sort((x, y) => x.cost - y.cost);
    const best = c[0];
    return { kind: 'marital', term: best.term, via: best.via, notes: best.note ? [best.note] : [] };
  }

  // ---------- generic shortest chain (fallback + highlighting) ----------
  function stepLabel(ix, u, v) {
    const V = ix.byId.get(v);
    if (ix.parentsOf.get(u).includes(v)) return g(V, 'father', 'mother', 'parent');
    if (ix.parentsOf.get(v).includes(u)) return g(V, 'son', 'daughter', 'child');
    return ix.implicit.has(pairKey(u, v)) ? 'partner' : spouseTerm(V);
  }
  function bfsPath(ix, a, b) {
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const x = q.shift();
      if (x === b) break;
      const nb = [...ix.parentsOf.get(x), ...ix.children.get(x), ...ix.spouses.get(x)];
      for (const y of nb) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
    }
    if (!prev.has(b)) return null;
    const ids = [];
    for (let c = b; c !== null; c = prev.get(c)) ids.push(c);
    return ids.reverse();
  }

  // Full answer for the UI
  function relate(ix, aId, bId) {
    const A = ix.byId.get(aId), B = ix.byId.get(bId);
    const out = { a: aId, b: bId, kind: 'none', aIsToB: null, bIsToA: null, sentenceAB: '', sentenceBA: '', notes: [], via: [], blood: null, steps: [], nodes: [], edges: [] };
    if (aId === bId) { out.kind = 'self'; out.sentenceAB = 'That is the same person.'; out.nodes = [aId]; return out; }
    const ab = relateOne(ix, aId, bId), ba = relateOne(ix, bId, aId);
    const main = ab || ba;
    const path = bfsPath(ix, aId, bId);
    if (path) {
      for (let i = 0; i < path.length - 1; i++) out.steps.push({ from: path[i], to: path[i + 1], label: stepLabel(ix, path[i], path[i + 1]) });
    }
    const nodes = new Set(path || []), edges = new Set();
    if (main && main.kind === 'blood') {
      for (const l of main.blood.lcas) for (const x of [aId, bId]) {
        const p = pathUp(ix, x, l);
        p.forEach(n => nodes.add(n));
        for (let i = 0; i < p.length - 1; i++) edges.add(pairKey(p[i], p[i + 1]));
      }
      out.blood = ab ? ab.blood : { ...ba.blood, dA: ba.blood.dB, dB: ba.blood.dA };
    } else if (path) {
      for (let i = 0; i < path.length - 1; i++) edges.add(pairKey(path[i], path[i + 1]));
    }
    out.nodes = [...nodes]; out.edges = [...edges];
    if (!main) {
      if (path) { out.kind = 'path'; out.sentenceAB = `${A.name} and ${B.name} are connected, but through a longer chain than the standard relationship names cover.`; }
      else { out.kind = 'none'; out.sentenceAB = `No connection between ${A.name} and ${B.name} is recorded in this tree.`; }
      return out;
    }
    out.kind = main.kind;
    out.aIsToB = ab ? ab.term : null; out.bIsToA = ba ? ba.term : null;
    if (out.aIsToB) out.sentenceAB = `${A.name} is ${B.name}’s ${out.aIsToB}`;
    if (out.bIsToA) out.sentenceBA = `${B.name} is ${A.name}’s ${out.bIsToA}`;
    out.notes = [...new Set([...(ab ? ab.notes : []), ...(ba ? ba.notes : [])])];
    if (main.kind === 'blood' && ix.spouses.get(aId).has(bId)) out.notes.push(`They are also married/partners: ${A.name} is ${B.name}’s ${ix.implicit.has(pairKey(aId, bId)) ? 'partner' : g(A, 'husband', 'wife', 'spouse')}.`);
    out.via = main.via || [];
    return out;
  }

  return { buildIndex, relate, relateOne, findBlood, pairKey, bloodTerm };
});
