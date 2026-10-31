'use strict';

/* ════════════════════════════════════════════════════════════════════
   date helpers — everything is local time, no UTC round-trips
   ════════════════════════════════════════════════════════════════════ */
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n, w = 2) => String(n).padStart(w, '0');
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n,
  d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

function addMonths(d, n) {
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, lastDay));
  return t;
}

const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDate(s) {                       // "YYYY-MM-DD" → local midnight
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function parseDateTime(s) {                   // "YYYY-MM-DDTHH:MM"
  if (!s) return null;
  const [datePart, timePart = '00:00'] = s.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh = 0, mm = 0] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
const toLocalInput = d => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtShortY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/* ════════════════════════════════════════════════════════════════════
   the counting engine
   ────────────────────────────────────────────────────────────────────
   A "counted" day is one that survives the skip rules. Two quantities
   are tracked side by side for every countdown:
     · counted  — skipped days contribute nothing, the clock parks on them
     · full     — plain wall-clock time, nothing is skipped
   ════════════════════════════════════════════════════════════════════ */

const ALL_DAYS = { excludeWeekdays: [], ranges: [] };   // the "full" ruleset

function makeSkipTest(cfg) {
  const weekdays = new Set(cfg.excludeWeekdays || []);
  const ranges = (cfg.ranges || []).map(r => {
    const a = parseDate(r.start);
    const b = parseDate(r.end || r.start);
    return a && b ? { a: +a, b: +b } : null;
  }).filter(Boolean);
  const memo = new Map();

  return function isCounted(dayStart) {
    const key = +dayStart;
    let hit = memo.get(key);
    if (hit !== undefined) return hit;
    hit = true;
    if (weekdays.has(dayStart.getDay())) hit = false;
    else for (const r of ranges) if (key >= r.a && key <= r.b) { hit = false; break; }
    memo.set(key, hit);
    return hit;
  };
}

/** Milliseconds between a and b that land on counted days. */
function countedMsBetween(a, b, isCounted) {
  if (b <= a) return 0;
  let total = 0, day = startOfDay(a);
  const lastDay = +startOfDay(b);
  for (let guard = 0; +day <= lastDay && guard < 200000; guard++) {
    const next = addDays(day, 1);
    if (isCounted(day)) {
      const from = Math.max(+a, +day), to = Math.min(+b, +next);
      if (to > from) total += to - from;
    }
    day = next;
  }
  return total;
}

/** Whole counted dates in [a, b], by calendar date. */
function countedDaysBetween(a, b, isCounted) {
  if (startOfDay(b) < startOfDay(a)) return 0;
  let n = 0, day = startOfDay(a);
  const lastDay = +startOfDay(b);
  for (let guard = 0; +day <= lastDay && guard < 200000; guard++) {
    if (isCounted(day)) n++;
    day = addDays(day, 1);
  }
  return n;
}

/** Next counted date on or after `from` (null if none before `limit`). */
function nextCountedDay(from, limit, isCounted) {
  let day = startOfDay(from);
  const lastDay = +startOfDay(limit);
  for (let guard = 0; +day <= lastDay && guard < 200000; guard++) {
    if (isCounted(day)) return day;
    day = addDays(day, 1);
  }
  return null;
}

/**
 * Split the remaining counted time into units.
 * Years and months are walked on the real calendar — one "month" means one
 * calendar month's worth of counted days, whatever that happens to be — so the
 * breakdown stays truthful even when most of the month is skipped.
 */
function breakdown(now, target, isCounted, units) {
  const out = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0, over: false };
  if (target <= now) { out.over = true; return out; }

  let cursor = new Date(now);
  if (units.years)  while (addMonths(cursor, 12) <= target) { cursor = addMonths(cursor, 12); out.years++; }
  if (units.months) while (addMonths(cursor, 1)  <= target) { cursor = addMonths(cursor, 1);  out.months++; }

  let ms = countedMsBetween(cursor, target, isCounted);
  let days = Math.floor(ms / DAY);
  ms -= days * DAY;
  if (units.weeks) { out.weeks = Math.floor(days / 7); days -= out.weeks * 7; }
  out.days = days;
  out.hours = Math.floor(ms / HOUR); ms -= out.hours * HOUR;
  out.minutes = Math.floor(ms / MIN); ms -= out.minutes * MIN;
  out.seconds = Math.floor(ms / 1000);
  return out;
}

function unitList(b, units) {
  const rows = [];
  if (units.years)  rows.push(['years', 'Years']);
  if (units.months) rows.push(['months', 'Months']);
  if (units.weeks)  rows.push(['weeks', 'Weeks']);
  rows.push(['days', 'Days'], ['hours', 'Hours'], ['minutes', 'Minutes'], ['seconds', 'Seconds']);
  return rows.map(([k, label]) => ({ key: k, label, value: b[k] }));
}

/* ════════════════════════════════════════════════════════════════════
   store
   ════════════════════════════════════════════════════════════════════ */
const STORE_KEY = 'countdown.app.v1';

function normalize(cd) {
  return {
    id: cd.id || ('c' + Math.random().toString(36).slice(2, 9)),
    name: cd.name || 'Untitled countdown',
    subtitle: cd.subtitle || '',
    emoji: cd.emoji || '⏳',
    accent: cd.accent || '#ffb703',
    target: cd.target || toLocalInput(new Date(Date.now() + 7 * DAY)),
    start: cd.start || toLocalInput(new Date()),
    excludeWeekdays: Array.isArray(cd.excludeWeekdays) ? cd.excludeWeekdays.slice() : [],
    ranges: Array.isArray(cd.ranges) ? cd.ranges.map(r => ({
      start: r.start, end: r.end || r.start, label: r.label || '', tag: r.tag || 'purple',
    })) : [],
    units: Object.assign({ years: false, months: false, weeks: false }, cd.units || {}),
    updatedAt: Number(cd.updatedAt) || 0,   // per-countdown edit time, used to merge devices
  };
}

/*
 * state = { countdowns, activeId, deleted, savedAt }
 *   deleted  — ids of removed countdowns, so a delete on one device sticks on the others
 *   savedAt  — 0 means "untouched seed": a fresh device never overwrites the cloud
 */
let state = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && Array.isArray(raw.countdowns) && raw.countdowns.length) {
      return {
        countdowns: raw.countdowns.map(normalize),
        activeId: raw.activeId,
        deleted: Array.isArray(raw.deleted) ? raw.deleted : [],
        savedAt: Number(raw.savedAt) || 0,
      };
    }
  } catch { /* fall through to the seed */ }
  const seed = normalize(SCUSD_2026_27);
  return { countdowns: [seed], activeId: seed.id, deleted: [], savedAt: 0 };
}

/** Write to this device only (cache + offline copy). */
function persistLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode etc. */ }
}

/** A real change: stamp it, keep a local copy, and hand it to cloud sync. */
function save() {
  state.savedAt = Date.now();
  persistLocal();
  if (window.CloudSync) window.CloudSync.changed();
}

const touch = cd => { cd.updatedAt = Date.now(); return cd; };
const tombstone = ids => { state.deleted = [...new Set([...(state.deleted || []), ...ids])]; };

/* the small surface cloud sync talks to */
window.CountdownApp = {
  normalize,
  snapshot: () => JSON.parse(JSON.stringify(state)),
  apply(data) {
    if (!data || !Array.isArray(data.countdowns) || !data.countdowns.length) return false;
    const prevActive = state.activeId;
    state = {
      countdowns: data.countdowns.map(normalize),
      activeId: data.activeId || prevActive,
      deleted: Array.isArray(data.deleted) ? data.deleted : [],
      savedAt: Number(data.savedAt) || Date.now(),
    };
    if (!state.countdowns.some(c => c.id === state.activeId)) state.activeId = state.countdowns[0].id;
    persistLocal();
    render();
    return true;
  },
};

function active() {
  return state.countdowns.find(c => c.id === state.activeId) || state.countdowns[0];
}

/* ════════════════════════════════════════════════════════════════════
   rendering
   ════════════════════════════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const stage = $('#stage');
let live = null;    // everything tick() needs, rebuilt by render()

function render() {
  const cd = active();
  if (!cd) return;
  document.documentElement.style.setProperty('--accent', cd.accent);
  document.title = `${cd.emoji} ${cd.name}`;

  renderTabs();
  stage.replaceChildren();

  const target = parseDateTime(cd.target);
  const start = parseDateTime(cd.start);
  const countedTest = makeSkipTest(cd);
  const fullTest = makeSkipTest(ALL_DAYS);

  /* ── hero: the counted countdown ───────────────────────────────── */
  const hero = el('section', 'card hero');

  const head = el('div', 'hero-head');
  head.append(el('div', 'hero-emoji', cd.emoji));
  const titles = el('div', 'hero-titles');
  titles.append(el('h1', null, cd.name));
  if (cd.subtitle) titles.append(el('p', null, cd.subtitle));
  head.append(titles);
  const when = el('div', 'hero-when');
  when.append(el('b', null, fmtDay.format(target)));
  when.append(document.createTextNode(fmtTime.format(target)));
  head.append(when);
  hero.append(head);

  const clock = el('div', 'clock');
  const countedNodes = {};
  for (const u of unitList(breakdown(new Date(), target, countedTest, cd.units), cd.units)) {
    const box = el('div', 'unit');
    box.dataset.unit = u.key;
    const n = el('span', 'n', '0');
    box.append(n, el('span', 'l', u.label));
    countedNodes[u.key] = { box, n };
    clock.append(box);
  }
  hero.append(clock);

  const foot = el('div', 'hero-foot');
  const status = el('span', 'badge');
  const nextUp = el('span', 'badge');
  foot.append(status, nextUp);
  hero.append(foot);
  stage.append(hero);

  /* ── stats ─────────────────────────────────────────────────────── */
  const stats = el('section', 'stats');
  const mk = (key, sub) => {
    const s = el('div', 'stat');
    s.append(el('div', 'k', key));
    const v = el('div', 'v', '—');
    const t = el('div', 's', sub || '');
    s.append(v, t);
    stats.append(s);
    return { v, t };
  };
  const sCounted = mk('Counted days left');
  const sTotal = mk('All days left');
  const sDone = mk('Counted days done');
  const sSkipped = mk('Days skipped ahead');
  stage.append(stats);

  /* ── progress ──────────────────────────────────────────────────── */
  const prog = el('section', 'card');
  prog.append(el('div', 'section-title', 'Progress'));
  const bar = el('div', 'bar');
  const fill = el('i');
  bar.append(fill);
  const barRow = el('div', 'bar-row');
  const barL = el('span', null, ''), barR = el('span', null, '');
  barRow.append(barL, barR);
  prog.append(bar, barRow);
  stage.append(prog);

  /* ── full countdown ────────────────────────────────────────────── */
  const fullCard = el('section', 'card');
  const fullTitle = el('div', 'section-title');
  fullTitle.append(document.createTextNode('Full time — nothing skipped'));
  fullTitle.append(el('em', null, 'every calendar day counts here'));
  fullCard.append(fullTitle);
  const fullClock = el('div', 'clock small');
  const fullNodes = {};
  for (const u of unitList(breakdown(new Date(), target, fullTest, cd.units), cd.units)) {
    const box = el('div', 'unit');
    const n = el('span', 'n', '0');
    box.append(n, el('span', 'l', u.label));
    fullNodes[u.key] = { box, n };
    fullClock.append(box);
  }
  fullCard.append(fullClock);
  stage.append(fullCard);

  /* ── what is being skipped ─────────────────────────────────────── */
  const skipCard = el('section', 'card');
  const skipTitle = el('div', 'section-title');
  skipTitle.append(document.createTextNode('Skipped'));
  const skipCount = el('em');
  skipTitle.append(skipCount);
  skipCard.append(skipTitle);

  const skips = el('div', 'skips');
  const wk = (cd.excludeWeekdays || []).slice().sort();
  if (wk.length) {
    const chip = el('span', 'skip');
    chip.dataset.tag = 'red';
    chip.append(el('i', 'sw'));
    const b = el('b', null, wk.map(i => WEEKDAYS[i]).join(', '));
    chip.append(b, document.createTextNode(' · every week'));
    skips.append(chip);
  }
  const today = startOfDay(new Date());
  for (const r of cd.ranges.slice().sort((a, b) => a.start.localeCompare(b.start))) {
    const a = parseDate(r.start), b = parseDate(r.end || r.start);
    if (!a || !b) continue;
    const chip = el('span', 'skip' + (b < today ? ' past' : ''));
    chip.dataset.tag = r.tag || 'purple';
    chip.append(el('i', 'sw'));
    chip.append(el('b', null, r.label || 'Skipped'));
    const span = (+a === +b) ? fmtShortY.format(a) : `${fmtShort.format(a)} – ${fmtShortY.format(b)}`;
    chip.append(document.createTextNode(' · ' + span));
    skips.append(chip);
  }
  if (!skips.children.length) skips.append(el('span', 'empty', 'Nothing skipped — every day counts.'));
  skipCard.append(skips);
  stage.append(skipCard);

  live = {
    cd, target, start, countedTest, fullTest,
    countedNodes, fullNodes, clock, status, nextUp,
    sCounted, sTotal, sDone, sSkipped, fill, barL, barR, skipCount,
  };
  tick();
}

function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

function tick() {
  if (!live) return;
  const { cd, target, start, countedTest, fullTest } = live;
  const now = new Date();

  /* clocks */
  const bC = breakdown(now, target, countedTest, cd.units);
  const bF = breakdown(now, target, fullTest, cd.units);
  let leadFound = false;
  for (const u of unitList(bC, cd.units)) {
    const node = live.countedNodes[u.key];
    if (!node) continue;
    setText(node.n, String(u.value));
    const isLead = !leadFound && (u.value > 0 || u.key === 'seconds');
    if (isLead) leadFound = true;
    node.box.classList.toggle('lead', isLead);
  }
  for (const u of unitList(bF, cd.units)) {
    const node = live.fullNodes[u.key];
    if (node) setText(node.n, String(u.value));
  }

  /* stats */
  const over = target <= now;
  const countedLeft = over ? 0 : countedDaysBetween(now, target, countedTest);
  const fullLeft = over ? 0 : countedDaysBetween(now, target, fullTest);
  const countedTotal = countedDaysBetween(start, target, countedTest);
  const done = Math.max(0, countedTotal - countedLeft);

  setText(live.sCounted.v, String(countedLeft));
  setText(live.sCounted.t, countedLeft === 1 ? 'day still counts' : 'days still count');
  setText(live.sTotal.v, String(fullLeft));
  setText(live.sTotal.t, 'calendar days on the way');
  setText(live.sDone.v, `${done}`);
  setText(live.sDone.t, `of ${countedTotal} total`);
  setText(live.sSkipped.v, String(Math.max(0, fullLeft - countedLeft)));
  setText(live.sSkipped.t, 'weekends, holidays, breaks');

  const pct = countedTotal ? Math.min(100, Math.max(0, (done / countedTotal) * 100)) : (over ? 100 : 0);
  live.fill.style.width = pct.toFixed(2) + '%';
  setText(live.barL, `${pct.toFixed(1)}% through`);
  setText(live.barR, over ? 'Finished' : `${countedLeft} counted ${countedLeft === 1 ? 'day' : 'days'} to go`);

  const skipsAhead = Math.max(0, fullLeft - countedLeft);
  setText(live.skipCount, over ? '' : `${skipsAhead} skipped ${skipsAhead === 1 ? 'day' : 'days'} between now and then`);

  /* status badges */
  live.clock.classList.toggle('done', over);
  const todayCounts = countedTest(startOfDay(now));

  live.status.replaceChildren();
  live.nextUp.replaceChildren();
  live.status.className = 'badge';
  live.nextUp.className = 'badge';

  if (over) {
    live.status.classList.add('live');
    live.status.append(el('i', 'dot'), document.createTextNode('Countdown complete'));
    live.nextUp.hidden = true;
  } else if (todayCounts) {
    live.status.classList.add('live');
    live.status.append(el('i', 'dot'), document.createTextNode('Today counts — clock running'));
    live.nextUp.hidden = true;
  } else {
    live.status.classList.add('warn');
    live.status.append(el('i', 'dot'), document.createTextNode('Today is skipped — clock parked'));
    const nd = nextCountedDay(now, target, countedTest);
    live.nextUp.hidden = false;
    if (nd) {
      const inMs = +nd - +now;
      const h = Math.floor(inMs / HOUR), d = Math.floor(inMs / DAY);
      const away = d >= 1 ? `${d}d ${h - d * 24}h` : `${h}h ${Math.floor((inMs % HOUR) / MIN)}m`;
      live.nextUp.append(document.createTextNode(`Restarts ${WEEKDAYS[nd.getDay()]} ${fmtShort.format(nd)} · in ${away}`));
    } else {
      live.nextUp.append(document.createTextNode('No counted days remain'));
    }
  }
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.replaceChildren();
  for (const c of state.countdowns) {
    const b = el('button', 'tab' + (c.id === state.activeId ? ' on' : ''), `${c.emoji} ${c.name}`);
    // switching tabs is per-device — not a change worth syncing
    b.onclick = () => { state.activeId = c.id; persistLocal(); render(); };
    tabs.append(b);
  }
}

/* ════════════════════════════════════════════════════════════════════
   editor
   ════════════════════════════════════════════════════════════════════ */
let draft = null;

function openEditor(cd, isNew) {
  draft = JSON.parse(JSON.stringify(cd));
  $('#editorTitle').textContent = isNew ? 'New countdown' : 'Edit countdown';
  $('#fName').value = draft.name;
  $('#fSubtitle').value = draft.subtitle;
  $('#fEmoji').value = draft.emoji;
  $('#fAccent').value = draft.accent;
  $('#fTarget').value = draft.target;
  $('#fStart').value = draft.start;
  $('#btnDelete').hidden = isNew || state.countdowns.length < 2;

  for (const box of document.querySelectorAll('#unitToggles input')) {
    box.checked = !!draft.units[box.dataset.unit];
  }

  const wkWrap = $('#weekdayToggles');
  wkWrap.replaceChildren();
  WEEKDAYS.forEach((name, i) => {
    const label = el('label', 'chip');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = draft.excludeWeekdays.includes(i);
    input.onchange = () => {
      const set = new Set(draft.excludeWeekdays);
      input.checked ? set.add(i) : set.delete(i);
      draft.excludeWeekdays = [...set].sort();
    };
    label.append(input, el('span', null, name));
    wkWrap.append(label);
  });

  drawRanges();
  $('#editor').hidden = false;
}

function drawRanges() {
  const list = $('#rangeList');
  list.replaceChildren();
  if (!draft.ranges.length) list.append(el('p', 'empty', 'No skipped dates yet.'));
  draft.ranges.forEach((r, i) => {
    const row = el('div', 'range');
    const label = el('input');
    label.type = 'text'; label.placeholder = 'Label (e.g. Spring break)'; label.value = r.label || '';
    label.oninput = () => { r.label = label.value; };

    const from = el('input'); from.type = 'date'; from.value = r.start || '';
    from.onchange = () => { r.start = from.value; if (!r.end || r.end < r.start) { r.end = r.start; to.value = r.end; } };

    const to = el('input'); to.type = 'date'; to.value = r.end || r.start || '';
    to.onchange = () => { r.end = to.value || r.start; };

    const del = el('button', 'del', '✕');
    del.onclick = () => { draft.ranges.splice(i, 1); drawRanges(); };

    row.append(label, from, to, del);
    list.append(row);
  });
}

function closeEditor() { $('#editor').hidden = true; draft = null; }

function commit() {
  draft.name = $('#fName').value.trim() || 'Untitled countdown';
  draft.subtitle = $('#fSubtitle').value.trim();
  draft.emoji = $('#fEmoji').value.trim() || '⏳';
  draft.accent = $('#fAccent').value;
  draft.target = $('#fTarget').value || draft.target;
  draft.start = $('#fStart').value || draft.start;
  for (const box of document.querySelectorAll('#unitToggles input')) {
    draft.units[box.dataset.unit] = box.checked;
  }
  draft.ranges = draft.ranges.filter(r => r.start);

  const cd = touch(normalize(draft));
  const idx = state.countdowns.findIndex(c => c.id === cd.id);
  if (idx >= 0) state.countdowns[idx] = cd; else state.countdowns.push(cd);
  state.activeId = cd.id;
  save();
  closeEditor();
  render();
}

/* ════════════════════════════════════════════════════════════════════
   wiring
   ════════════════════════════════════════════════════════════════════ */
$('#btnEdit').onclick = () => openEditor(active(), false);
$('#btnNew').onclick = () => {
  const now = new Date();
  openEditor(normalize({
    id: 'c' + Math.random().toString(36).slice(2, 9),
    name: '', emoji: '🎯', accent: '#6ee7b7',
    start: toLocalInput(now),
    target: toLocalInput(new Date(+now + 30 * DAY)),
    excludeWeekdays: [0, 6],
  }), true);
};
$('#btnClose').onclick = closeEditor;
$('#btnCancel').onclick = closeEditor;
$('#btnSave').onclick = commit;
$('#btnAddRange').onclick = () => {
  draft.ranges.push({ start: ymd(new Date()), end: ymd(new Date()), label: '', tag: 'purple' });
  drawRanges();
};
$('#btnDelete').onclick = () => {
  if (!confirm(`Delete “${draft.name}”?`)) return;
  state.countdowns = state.countdowns.filter(c => c.id !== draft.id);
  tombstone([draft.id]);
  if (!state.countdowns.length) state.countdowns = [touch(normalize(SCUSD_2026_27))];
  state.activeId = state.countdowns[0].id;
  save(); closeEditor(); render();
};
$('#editor').onclick = e => { if (e.target.id === 'editor') closeEditor(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeEditor(); $('#menu').hidden = true; }
});
// another tab of the app on this device saved — pick it up
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  try { state = load(); render(); } catch { /* ignore */ }
});

const menu = $('#menu');
$('#btnMenu').onclick = e => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  menu.hidden = !menu.hidden;
  menu.style.top = (r.bottom + 8) + 'px';
  menu.style.right = (window.innerWidth - r.right) + 'px';
};
document.addEventListener('click', () => { menu.hidden = true; });
menu.onclick = e => {
  const act = e.target.dataset && e.target.dataset.act;
  if (!act) return;
  menu.hidden = true;
  if (act === 'duplicate') {
    const copy = touch(normalize(Object.assign({}, active(), { id: undefined, name: active().name + ' copy' })));
    state.countdowns.push(copy); state.activeId = copy.id; save(); render();
  } else if (act === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'countdowns.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (act === 'import') {
    $('#fileImport').click();
  } else if (act === 'account') {
    if (window.CloudSync) window.CloudSync.open();
  } else if (act === 'reset') {
    const seed = touch(normalize(SCUSD_2026_27));
    const idx = state.countdowns.findIndex(c => c.name === seed.name);
    if (idx >= 0) seed.id = state.countdowns[idx].id;
    if (idx >= 0) state.countdowns[idx] = seed; else state.countdowns.push(seed);
    state.activeId = seed.id; save(); render();
  }
};
$('#fileImport').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data.countdowns;
      if (!Array.isArray(list) || !list.length) throw new Error('no countdowns');
      // import replaces everything: what's not in the file counts as deleted
      const incoming = list.map(normalize).map(touch);
      const keep = new Set(incoming.map(c => c.id));
      tombstone(state.countdowns.map(c => c.id).filter(id => !keep.has(id)));
      state.deleted = state.deleted.filter(id => !keep.has(id));
      state.countdowns = incoming;
      state.activeId = state.countdowns[0].id;
      save(); render();
    } catch (err) {
      alert('That file did not contain any countdowns.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
};

render();
setInterval(tick, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
