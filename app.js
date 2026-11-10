(() => {
  'use strict';
  const R = window.Relations, TL = window.TreeLayout;
  const STORE_KEY = 'balgam-family-v1';
  const NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['g', 'path', 'rect', 'text', 'title']);
  const $ = (s, r = document) => r.querySelector(s);
  const clone = o => JSON.parse(JSON.stringify(o));

  function el(tag, attrs = {}, ...kids) {
    const e = SVG_TAGS.has(tag) ? document.createElementNS(NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }

  // ---------------- data ----------------
  let state = load(), ix, selectedId = null, mode = 'all', tab = 'person';
  let relA = null, relB = null, hl = null; // hl = {nodes:Set, edges:Set, relation result}
  let lay = null;

  function normalize(s) {
    const ids = new Set(s.people.map(p => p.id));
    s.people.forEach(p => {
      p.parents = (p.parents || []).filter(x => ids.has(x) && x !== p.id).slice(0, 2);
      p.spouses = (p.spouses || []).filter(x => ids.has(x) && x !== p.id);
      p.gender = p.gender === 'M' || p.gender === 'F' ? p.gender : '';
      ['name', 'nickname', 'born', 'died', 'place', 'notes'].forEach(k => { p[k] = p[k] == null ? '' : String(p[k]); });
    });
    const by = new Map(s.people.map(p => [p.id, p]));
    s.people.forEach(p => p.spouses.forEach(x => { const o = by.get(x); if (!o.spouses.includes(p.id)) o.spouses.push(p.id); }));
    s.demo = !!s.demo;
    return s;
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const s = JSON.parse(raw); if (s && Array.isArray(s.people) && !(s.demo && !window.SEED.demo)) return normalize(s); }
    } catch (e) { /* ignore */ }
    return normalize(clone(window.SEED));
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const person = id => ix.byId.get(id);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const nick = p => (p.nickname ? `“${p.nickname}”` : '');
  const optLabel = p => [p.name, nick(p), life(p) && `(${life(p)})`].filter(Boolean).join(' ');
  const year = s => { const m = /\d{4}/.exec(s || ''); return m ? m[0] : ''; };
  function life(p) {
    const b = year(p.born), d = year(p.died);
    if (b && d) return `${b} – ${d}`;
    if (b) return p.died ? `${b} – ?` : `b. ${b}`;
    if (d) return `d. ${d}`;
    return p.died ? '† deceased' : '';
  }
  function descendantsOf(id) {
    const out = new Set(), st = [id];
    while (st.length) { const x = st.pop(); ix.children.get(x).forEach(c => { if (!out.has(c)) { out.add(c); st.push(c); } }); }
    return out;
  }

  // ---------------- rendering ----------------
  function render() {
    ix = R.buildIndex(state.people);
    if (selectedId && !ix.byId.has(selectedId)) selectedId = null;
    if (relA && !ix.byId.has(relA)) relA = null;
    if (relB && !ix.byId.has(relB)) relB = null;
    $('#banner').hidden = !state.demo;
    renderList(); renderTree(); renderPerson(); renderRelOptions();
    if (relA && relB) computeRelation(false); else { hl = null; $('#relResult').replaceChildren(); applyHighlight(); }
  }

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const list = state.people.filter(p => !q || (p.name + ' ' + p.nickname).toLowerCase().includes(q)).sort(byName);
    $('#count').textContent = `${state.people.length} ${state.people.length === 1 ? 'person' : 'people'}` + (q ? ` · ${list.length} match` : '');
    $('#list').replaceChildren(...list.map(p => el('li', {},
      el('button', { class: p.id === selectedId ? 'on' : '', onclick: () => pick(p.id, true) }, p.name, el('span', { class: 'yr' }, [nick(p), life(p)].filter(Boolean).join(' '))))));
  }

  function visiblePeople() {
    if (!selectedId || mode === 'all') return state.people;
    const set = new Set([selectedId]);
    const walk = (start, next) => { const st = [start]; while (st.length) { const x = st.pop(); next(x).forEach(n => { if (!set.has(n)) { set.add(n); st.push(n); } }); } };
    if (mode === 'lineage' || mode === 'ancestors') walk(selectedId, x => ix.parentsOf.get(x));
    if (mode === 'lineage' || mode === 'descendants') walk(selectedId, x => ix.children.get(x));
    if (mode === 'ancestors') ix.spouses.get(selectedId).forEach(s => set.add(s));
    else [...set].forEach(id => ix.spouses.get(id).forEach(s => set.add(s)));
    return state.people.filter(p => set.has(p.id));
  }

  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function renderTree() {
    const people = visiblePeople();
    $('#empty').hidden = state.people.length > 0;
    lay = TL.layout(people);
    const edges = $('#edges'), nodes = $('#nodes');
    edges.replaceChildren(); nodes.replaceChildren();
    lay.spouseEdges.forEach(e => edges.append(el('path', { class: 'edge spouse' + (e.implicit ? ' implicit' : ''), d: e.d, 'data-k': e.key })));
    lay.childEdges.forEach(e => edges.append(el('path', { class: 'edge child', d: e.d, 'data-k': e.keys.join(' '), style: '--c:hsl(' + e.hue + ' 55% var(--fl))' })));
    for (const n of lay.nodes.values()) {
      const p = person(n.id);
      nodes.append(el('g', { class: 'node ' + (p.gender || 'O'), transform: `translate(${n.x},${n.y})`, 'data-id': p.id, tabindex: 0, role: 'button', 'aria-label': `${p.name} ${life(p)}` },
        el('rect', { width: TL.NODE_W, height: TL.NODE_H, rx: 11 }),
        el('text', { class: 'nm', x: 12, y: 26 }, trunc(p.name, 19)),
        el('text', { class: 'yr', x: 12, y: 46 }, trunc([nick(p), life(p), p.place].filter(Boolean).join(' · '), 27)),
        el('text', { class: 'tag', x: TL.NODE_W - 12, y: 18, 'text-anchor': 'end' }),
        el('title', {}, [p.name, nick(p), life(p), p.place].filter(Boolean).join(' — '))));
    }
    applySelection();
    applyHighlight();
    if (!view.set) initialView(); else if (view.refit) { fit(); view.refit = false; }
  }

  function applySelection() {
    document.querySelectorAll('.node').forEach(n => {
      const id = n.dataset.id;
      n.classList.toggle('sel', id === selectedId);
      const t = $('.tag', n);
      t.textContent = id === relA ? 'A' : id === relB ? 'B' : '';
    });
  }
  function applyHighlight() {
    const active = !!(hl && hl.nodes.size);
    $('#viewport').classList.toggle('dimmed', active);
    document.querySelectorAll('.node').forEach(n => n.classList.toggle('hl', active && hl.nodes.has(n.dataset.id)));
    document.querySelectorAll('.edge').forEach(e => {
      const keys = e.dataset.k.split(' ');
      const on = active && keys.some(k => hl.edges.has(k));
      e.classList.toggle('hl', on);
      if (on) e.parentNode.append(e); // draw on top
    });
    applySelection();
  }

  // ---------------- pan & zoom ----------------
  const view = { k: 1, x: 0, y: 0, set: false, refit: false };
  const svg = $('#tree');
  function applyView() { $('#viewport').setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`); }
  function fitBox(box, maxK = 1.15) {
    const r = svg.getBoundingClientRect();
    if (!r.width || !box.w || !box.h) return;
    const pad = 30;
    view.k = Math.min((r.width - pad * 2) / box.w, (r.height - pad * 2) / box.h, maxK);
    view.x = (r.width - box.w * view.k) / 2 - box.x * view.k;
    view.y = (r.height - box.h * view.k) / 2 - box.y * view.k;
    view.set = true; applyView();
  }
  function fit() { if (lay) fitBox({ x: 0, y: 0, w: lay.width, h: lay.height }); }
  // Opening view: a readable zoom level, centred on the ancestor with the most descendants (the whole tree is one click away via the fit button)
  function initialView() {
    fit();
    if (view.k >= 0.55 || !lay) return;
    let best = null, most = -1;
    for (const id of lay.nodes.keys()) {
      if (ix.parentsOf.get(id).length) continue;
      const n = descendantsOf(id).size;
      if (n > most) { most = n; best = id; }
    }
    view.k = 0.55; centerOn(best);
    const r = svg.getBoundingClientRect(), n = lay.nodes.get(best);
    if (n) { view.y = 50 - n.y * view.k; applyView(); }
  }
  function boxOf(ids) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    ids.forEach(id => { const n = lay.nodes.get(id); if (!n) return; x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + TL.NODE_W); y2 = Math.max(y2, n.y + TL.NODE_H); });
    return isFinite(x1) ? { x: x1 - 40, y: y1 - 40, w: x2 - x1 + 80, h: y2 - y1 + 80 } : null;
  }
  function centerOn(id) {
    const n = lay && lay.nodes.get(id); if (!n) return;
    const r = svg.getBoundingClientRect();
    view.x = r.width / 2 - (n.x + TL.NODE_W / 2) * view.k; view.y = r.height / 2 - (n.y + TL.NODE_H / 2) * view.k; applyView();
  }
  function zoomAt(f, cx, cy) {
    const k = Math.max(0.12, Math.min(2.5, view.k * f)), s = k / view.k;
    view.x = cx - (cx - view.x) * s; view.y = cy - (cy - view.y) * s; view.k = k; applyView();
  }
  const ptrs = new Map(); let drag = null, pinch = 0;
  svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, node: e.target.closest('.node') };
    else { drag && (drag.moved = true); pinch = dist(); }
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const d = dist(), r = svg.getBoundingClientRect(), [a, b] = [...ptrs.values()];
      if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch = d; return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; svg.classList.add('dragging'); }
    if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; applyView(); }
  });
  const end = e => {
    ptrs.delete(e.pointerId); pinch = 0; svg.classList.remove('dragging');
    if (ptrs.size === 0 && drag) { if (!drag.moved && drag.node && e.type === 'pointerup') pick(drag.node.dataset.id, false); drag = null; }
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  svg.addEventListener('keydown', e => { const n = e.target.closest && e.target.closest('.node'); if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(n.dataset.id, false); } });
  $('#zIn').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); };
  $('#zOut').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); };
  $('#zFit').onclick = fit;
  window.addEventListener('resize', () => { if (!view.set) initialView(); });

  // ---------------- selection ----------------
  function pick(id, center) {
    if (tab === 'relation') {
      if (!relA || (relA && relB)) { relA = id; relB = null; hl = null; $('#relResult').replaceChildren(); }
      else if (id !== relA) { relB = id; }
      renderRelOptions();
      if (relA && relB) computeRelation(true);
      selectedId = id;
    } else selectedId = id;
    if (mode !== 'all') { view.refit = true; renderTree(); }
    renderList(); renderPerson(); applySelection();
    if (center && mode === 'all') centerOn(id);
  }

  // ---------------- person panel ----------------
  function chips(ids) {
    return el('div', { class: 'chips' }, ids.length ? ids.map(id => { const p = person(id); return el('button', { class: 'chip ' + (p.gender || ''), onclick: () => pick(id, true) }, p.name); }) : el('span', { class: 'muted small' }, 'none recorded'));
  }
  function siblingsOf(id) {
    const out = new Map();
    ix.parentsOf.get(id).forEach(pa => ix.children.get(pa).forEach(c => { if (c !== id) out.set(c, (out.get(c) || 0) + 1); }));
    return [...out.entries()].sort((a, b) => (year(person(a[0]).born) || 9999) - (year(person(b[0]).born) || 9999)).map(([c]) => c);
  }
  function renderPerson() {
    const box = $('#tab-person');
    const p = selectedId && person(selectedId);
    if (!p) { box.replaceChildren(el('p', { class: 'muted' }, 'Click anyone in the tree to see their details here.'), el('p', { class: 'muted small' }, 'Tip: drag to pan, scroll to zoom. Use the “Find relationship” tab to see how any two people are related.')); return; }
    const kids = ix.children.get(p.id), spouses = [...ix.spouses.get(p.id)], sibs = siblingsOf(p.id);
    box.replaceChildren(...[
      el('h2', {}, p.name),
      el('div', { class: 'muted' }, [nick(p), { M: 'Male', F: 'Female' }[p.gender], life(p), p.place].filter(Boolean).join(' · ')),
      el('div', { class: 'btnrow' },
        el('button', { class: 'primary', onclick: () => openEditor(p) }, 'Edit'),
        el('button', { onclick: () => addParent(p) }, '+ Parent'),
        el('button', { onclick: () => addSpouse(p) }, '+ Spouse'),
        el('button', { onclick: () => addChild(p) }, '+ Child'),
        el('button', { onclick: () => addSibling(p) }, '+ Sibling')),
      el('div', { class: 'btnrow' }, el('button', { onclick: () => { setTab('relation'); relA = p.id; relB = null; hl = null; $('#relResult').replaceChildren(); renderRelOptions(); applySelection(); } }, 'How am I related to… ?'),
        selectedId && mode === 'all' ? el('button', { onclick: () => { $('#viewMode').value = 'lineage'; mode = 'lineage'; view.refit = true; renderTree(); } }, 'Show direct line') : null),
      el('div', { class: 'kv' }, 'Parents'), chips(ix.parentsOf.get(p.id)),
      el('div', { class: 'kv' }, 'Spouse / partner'), chips(spouses),
      el('div', { class: 'kv' }, 'Children'), chips(kids),
      el('div', { class: 'kv' }, 'Siblings'), chips(sibs),
      p.notes ? el('div', { class: 'notes' }, p.notes) : null
    ].filter(Boolean));
  }

  // ---------------- add / edit ----------------
  const dlg = $('#personDialog'), form = $('#personForm'), F = form.elements;
  let editing = null, after = null;
  function fillSelect(sel, people, value, blank) {
    sel.replaceChildren(el('option', { value: '' }, blank), ...people.sort(byName).map(p => el('option', { value: p.id }, optLabel(p))));
    sel.value = value || '';
  }
  function openEditor(p, preset = {}, title, afterSave) {
    editing = p && p.id ? p : null; after = afterSave || null;
    const data = p || preset;
    const forbidden = new Set(editing ? [editing.id, ...descendantsOf(editing.id)] : []);
    const pool = state.people.filter(x => !forbidden.has(x.id));
    $('#pdTitle').textContent = title || (editing ? 'Edit ' + editing.name : 'Add person');
    F.name.value = data.name || ''; F.nickname.value = data.nickname || ''; F.gender.value = data.gender || '';
    F.born.value = data.born || ''; F.died.value = data.died || ''; F.place.value = data.place || ''; F.notes.value = data.notes || '';
    const par = data.parents || [];
    const fa = par.find(id => (person(id) || {}).gender === 'M') || par.find(id => (person(id) || {}).gender === '' && id !== par.find(i => (person(i) || {}).gender === 'F'));
    const mo = par.find(id => (person(id) || {}).gender === 'F') || par.find(id => id !== fa);
    fillSelect(F.father, pool.filter(x => x.gender !== 'F'), fa, '— unknown —');
    fillSelect(F.mother, pool.filter(x => x.gender !== 'M'), mo, '— unknown —');
    const sp = state.people.filter(x => !editing || x.id !== editing.id);
    fillSelect(F.spouses, sp, '', '— none —');
    const want = new Set(data.spouses || []);
    [...F.spouses.options].forEach(o => { o.selected = want.has(o.value); });
    $('#pdDelete').hidden = !editing;
    dlg.showModal(); F.name.focus();
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = F.name.value.trim();
    if (!name) return;
    const spouses = [...F.spouses.selectedOptions].map(o => o.value).filter(Boolean);
    const parents = [F.father.value, F.mother.value].filter(Boolean);
    let p = editing;
    if (!p) { p = { id: uid() }; state.people.push(p); }
    Object.assign(p, { name, nickname: F.nickname.value.trim(), gender: F.gender.value, born: F.born.value.trim(), died: F.died.value.trim(), place: F.place.value.trim(), notes: F.notes.value.trim(), parents, spouses });
    // keep spouse links two-way
    state.people.forEach(o => {
      if (o.id === p.id) return;
      const has = o.spouses.includes(p.id), should = spouses.includes(o.id);
      if (should && !has) o.spouses.push(p.id);
      if (!should && has) o.spouses = o.spouses.filter(x => x !== p.id);
    });
    save();
    dlg.close();
    if (after) after(p);
    selectedId = p.id; render();
  });
  $('#pdCancel').onclick = () => dlg.close();
  $('#pdDelete').onclick = () => {
    if (!editing || !confirm(`Delete ${editing.name}? Their links to relatives are removed too.`)) return;
    const id = editing.id;
    state.people = state.people.filter(p => p.id !== id);
    state.people.forEach(p => { p.parents = p.parents.filter(x => x !== id); p.spouses = p.spouses.filter(x => x !== id); });
    save(); dlg.close(); selectedId = null; render();
  };
  const opposite = g => (g === 'M' ? 'F' : g === 'F' ? 'M' : '');
  function addSpouse(p) { openEditor(null, { gender: opposite(p.gender), spouses: [p.id] }, `Add spouse of ${p.name}`); }
  function addChild(p) {
    const sp = [...ix.spouses.get(p.id)];
    openEditor(null, { parents: sp.length === 1 ? [p.id, sp[0]] : [p.id] }, `Add child of ${p.name}`);
  }
  function addParent(p) {
    const cur = ix.parentsOf.get(p.id);
    if (cur.length >= 2) { alert(`${p.name} already has two parents recorded. Edit them to change.`); return; }
    const haveF = cur.some(id => person(id).gender === 'M'), haveM = cur.some(id => person(id).gender === 'F');
    openEditor(null, { gender: haveF ? 'F' : haveM ? 'M' : '' }, `Add parent of ${p.name}`, np => { p.parents = [...p.parents, np.id].slice(0, 2); });
  }
  function addSibling(p) {
    const par = ix.parentsOf.get(p.id);
    if (!par.length) { alert(`Add a parent for ${p.name} first — siblings are linked through shared parents.`); return; }
    openEditor(null, { parents: par.slice() }, `Add sibling of ${p.name}`);
  }
  $('#btnAdd').onclick = $('#btnAdd2').onclick = () => openEditor(null, {});

  // ---------------- relationship finder ----------------
  const selA = $('#relA'), selB = $('#relB');
  function renderRelOptions() {
    const opts = state.people.slice().sort(byName);
    for (const [s, v] of [[selA, relA], [selB, relB]]) {
      s.replaceChildren(el('option', { value: '' }, '— choose —'), ...opts.map(p => el('option', { value: p.id }, optLabel(p))));
      s.value = v || '';
    }
  }
  selA.onchange = () => { relA = selA.value || null; applySelection(); };
  selB.onchange = () => { relB = selB.value || null; applySelection(); };
  $('#relSwap').onclick = () => { [relA, relB] = [relB, relA]; renderRelOptions(); if (relA && relB) computeRelation(true); else applySelection(); };
  $('#relGo').onclick = () => { if (!relA || !relB) { $('#relResult').replaceChildren(el('p', { class: 'muted' }, 'Choose two people first.')); return; } computeRelation(true); };

  function computeRelation(zoom) {
    const res = R.relate(ix, relA, relB);
    hl = { nodes: new Set(res.nodes), edges: new Set(res.edges), res };
    if (mode !== 'all') { mode = 'all'; $('#viewMode').value = 'all'; renderTree(); }
    applyHighlight();
    if (zoom) { const b = boxOf(res.nodes); if (b) fitBox(b, 1); }
    const A = person(relA), B = person(relB), nm = id => person(id).name;
    const card = el('div', { class: 'card' });
    if (res.sentenceAB) card.append(el('div', { class: 'big' }, res.sentenceAB));
    if (res.sentenceBA && res.sentenceBA !== res.sentenceAB) card.append(el('div', { class: 'rev' }, res.sentenceBA));
    if (res.kind === 'blood' && res.blood) {
      const b = res.blood, anc = b.lcas.map(nm).join(' & ');
      const gen = n => (n === 1 ? '1 generation' : n + ' generations');
      card.append(el('div', { class: 'fact' }, `Common ancestor${b.lcas.length > 1 ? 's' : ''}: `, el('strong', {}, anc),
        b.dA && b.dB ? ` — ${A.name} is ${gen(b.dA)} below, ${B.name} is ${gen(b.dB)} below.` : ` — ${b.dA ? A.name + ' is ' + gen(b.dA) + ' below' : B.name + ' is ' + gen(b.dB) + ' below'}.`));
      if (b.dA >= 2 && b.dB >= 2 && b.dA !== b.dB) card.append(el('div', { class: 'note' }, `“Removed” means the two people are in different generations: ${b.dA < b.dB ? A.name : B.name} is in the older one.`));
    } else if (res.kind === 'marital' && res.via.length) {
      card.append(el('div', { class: 'fact' }, 'Connected by marriage through: ', el('strong', {}, res.via.map(nm).join(' & '))));
    }
    res.notes.forEach(n => card.append(el('div', { class: 'note' }, n)));
    if (res.steps.length) {
      card.append(el('div', { class: 'kv' }, 'Shortest chain'), el('ul', { class: 'chain' },
        el('li', {}, el('strong', {}, A.name)),
        res.steps.map(s => el('li', {}, el('strong', {}, nm(s.to)), el('span', { class: 'lab' }, ` is ${nm(s.from)}’s ${s.label}`)))));
    }
    $('#relResult').replaceChildren(card);
  }

  // ---------------- tabs & view mode ----------------
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('#tab-person').hidden = t !== 'person'; $('#tab-relation').hidden = t !== 'relation';
    if (t === 'relation' && selectedId && !relA) { relA = selectedId; renderRelOptions(); applySelection(); }
  }
  document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
  $('#viewMode').onchange = e => { mode = e.target.value; if (mode !== 'all' && !selectedId) { alert('Select a person in the tree first.'); mode = 'all'; e.target.value = 'all'; return; } view.refit = true; renderTree(); };
  $('#search').oninput = renderList;

  // ---------------- import / export ----------------
  const ddlg = $('#dataDialog');
  $('#btnData').onclick = () => ddlg.showModal();
  $('#dataClose').onclick = () => ddlg.close();
  function download(name, text, type) {
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const CSV_COLS = ['name', 'nickname', 'gender', 'born', 'died', 'place', 'father', 'mother', 'spouse', 'notes'];
  function toCsv() {
    const nm = id => (person(id) || {}).name || '';
    const rows = [CSV_COLS.join(',')];
    state.people.slice().sort(byName).forEach(p => {
      const f = p.parents.find(id => person(id).gender !== 'F'), m = p.parents.find(id => id !== f);
      rows.push([p.name, p.nickname, p.gender, p.born, p.died, p.place, nm(f), nm(m), p.spouses.map(nm).join(';'), p.notes].map(csvCell).join(','));
    });
    return rows.join('\r\n');
  }
  $('#exJson').onclick = () => download('balgam-family.json', JSON.stringify(state, null, 2), 'application/json');
  $('#exCsv').onclick = () => download('balgam-family.csv', toCsv(), 'text/csv');
  $('#tplCsv').onclick = () => download('family-template.csv', CSV_COLS.join(',') + '\r\nRavi Kumar,Ravi,M,1950,,Hyderabad,,,Lakshmi,\r\nLakshmi,,F,1955,,,,,Ravi Kumar,\r\nSita Kumar,Chitti,F,1980,,,Ravi Kumar,Lakshmi,,Eldest daughter\r\n', 'text/csv');

  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  function fromCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('The CSV has no data rows.');
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/s$/, ''));
    const col = n => head.indexOf(n);
    if (col('name') < 0) throw new Error('The CSV needs a “name” column.');
    const people = [], idByName = new Map(), notes = [];
    const key = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const make = name => { const p = { id: uid(), name: name.trim(), gender: '', born: '', died: '', place: '', notes: '', parents: [], spouses: [] }; people.push(p); idByName.set(key(name), p.id); return p; };
    const get = (r, n) => (col(n) >= 0 ? (r[col(n)] || '').trim() : '');
    const body = rows.slice(1).filter(r => get(r, 'name'));
    body.forEach(r => {
      const name = get(r, 'name');
      if (idByName.has(key(name))) { notes.push(`Duplicate name “${name}” — only the first row was used. Make names unique (e.g. add a year).`); return; }
      const p = make(name);
      const g = get(r, 'gender').toLowerCase();
      p.gender = /^(m|male|man|boy)$/.test(g) ? 'M' : /^(f|female|woman|girl)$/.test(g) ? 'F' : '';
      ['nickname', 'born', 'died', 'place', 'notes'].forEach(k => { p[k] = get(r, k); });
    });
    const resolve = n => { n = n.trim(); if (!n) return null; if (!idByName.has(key(n))) { make(n); notes.push(`“${n}” was referenced but has no row — added as a blank person.`); } return idByName.get(key(n)); };
    const seen = new Set();
    body.forEach(r => {
      const p = people.find(x => key(x.name) === key(get(r, 'name')));
      if (!p || seen.has(p.id)) return; seen.add(p.id);
      const f = resolve(get(r, 'father')), m = resolve(get(r, 'mother'));
      p.parents = [f, m].filter(Boolean);
      p.spouses = get(r, 'spouse').split(/[;|]/).map(resolve).filter(Boolean);
    });
    return { s: { people, demo: false }, notes };
  }
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      let next, notes = [];
      if (/\.json$/i.test(f.name) || /^\s*[\[{]/.test(text)) {
        const j = JSON.parse(text);
        next = { people: Array.isArray(j) ? j : j.people, demo: false };
        if (!Array.isArray(next.people)) throw new Error('JSON must be a list of people or {"people": [...]}.');
        next.people.forEach(p => { if (!p.id) p.id = uid(); });
      } else { ({ s: next, notes } = fromCsv(text)); }
      if (!confirm(`Import ${next.people.length} people and replace what is currently in the app?`)) return;
      state = normalize(next); save(); selectedId = relA = relB = null; hl = null; view.set = false; render();
      ddlg.close();
      if (notes.length) alert(notes.slice(0, 8).join('\n') + (notes.length > 8 ? `\n…and ${notes.length - 8} more` : ''));
    } catch (err) { alert('Could not import: ' + err.message); }
  };
  function replaceAll(s) { state = normalize(s); save(); selectedId = relA = relB = null; hl = null; view.set = false; render(); }
  $('#resetSample').onclick = () => { if (confirm('Discard your edits in this browser and reload the original family data from data.js?')) { replaceAll(clone(window.SEED)); ddlg.close(); } };
  const startOwn = () => { if (confirm('Delete everyone and start with an empty tree?')) { replaceAll({ people: [], demo: false }); ddlg.close(); } };
  $('#clearAll').onclick = startOwn; $('#btnClear').onclick = startOwn;

  render();
})();
