'use strict';
/* IronLog — personal workout tracker (PWA). All data lives in this device's localStorage. */

// ---------------------------------------------------------------- helpers
const STORE_KEY = 'ironlog.data.v1';
const APP_VERSION = '1.0.0';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const clone = o => JSON.parse(JSON.stringify(o));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round1 = n => Math.round(n * 10) / 10;
const fmtNum = n => { const r = round1(n); return Number.isInteger(r) ? String(r) : r.toFixed(1); };
const BODY_PARTS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Full Body', 'Other'];
const CATEGORIES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Smith Machine', 'Kettlebell', 'Bodyweight', 'Weighted Bodyweight', 'Assisted Bodyweight', 'Band', 'Other'];
const DAY = 86400000;

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtDurShort(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
function fmtDate(t, opts = { weekday: 'short', day: 'numeric', month: 'short' }) { return new Date(t).toLocaleDateString(undefined, opts); }
function fmtTime(t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function timeAgo(t) {
  const d = Math.floor((startOfDay(Date.now()) - startOfDay(t)) / DAY);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) { const w = Math.floor(d / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  const m = Math.floor(d / 30); return `${m} month${m > 1 ? 's' : ''} ago`;
}
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(t) { const d = new Date(startOfDay(t)); const dow = (d.getDay() + 6) % 7; return d.getTime() - dow * DAY; }

// ---------------------------------------------------------------- data
function builtinExercises() {
  return (window.BUILTIN_EXERCISES || []).map(([name, category, bodyPart, media]) => ({
    id: 'b-' + slug(name + '-' + category), name, category, bodyPart, custom: false, media: media || null
  }));
}
function newSet(weight = '', reps = '', type = 'n') { return { id: uid(), weight: String(weight), reps: String(reps), type, done: false }; }
function newWorkoutExercise(exerciseId, sets) { return { id: uid(), exerciseId, sets: sets || [newSet()] }; }

function seedTemplates() {
  const mk = (name, list) => ({
    id: uid(), name, notes: '', created: Date.now(),
    exercises: list.map(([key, n, reps]) => newWorkoutExercise('b-' + slug(key), Array.from({ length: n }, () => newSet('', reps))))
  });
  return [
    mk('Push (example)', [['Bench Press-Barbell', 3, 8], ['Shoulder Press-Dumbbell', 3, 10], ['Incline Bench Press-Dumbbell', 3, 10], ['Lateral Raise-Dumbbell', 3, 12], ['Triceps Pushdown-Cable', 3, 12]]),
    mk('Pull (example)', [['Deadlift-Barbell', 3, 5], ['Pull Up-Bodyweight', 3, 8], ['Seated Row-Cable', 3, 10], ['Face Pull-Cable', 3, 15], ['Bicep Curl-Dumbbell', 3, 12]]),
    mk('Legs (example)', [['Squat-Barbell', 3, 6], ['Romanian Deadlift-Barbell', 3, 8], ['Leg Press-Machine', 3, 10], ['Lying Leg Curl-Machine', 3, 12], ['Standing Calf Raise-Machine', 4, 12]]),
  ];
}

function freshState() {
  return {
    version: 1,
    settings: { unit: 'kg', rest: 90, sound: true, sets: 3 },
    exercises: builtinExercises(),
    templates: seedTemplates(),
    history: [],
    active: null,
  };
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const okId = v => typeof v === 'string' && SAFE_ID.test(v);
const numStr = v => String(v ?? '').replace(/[^0-9.,]/g, '').slice(0, 12);
const str = (v, max = 2000) => (v == null ? '' : String(v)).slice(0, max);
const num0 = v => (Number.isFinite(+v) ? +v : 0);
function cleanSets(sets) {
  return (Array.isArray(sets) ? sets : []).map(x => ({
    id: okId(x && x.id) ? x.id : uid(), weight: numStr(x && x.weight), reps: numStr(x && x.reps),
    type: ['n', 'w', 'd', 'f'].includes(x && x.type) ? x.type : 'n', ...(x && x.done ? { done: true } : {}),
  }));
}
function cleanWorkoutExercises(list, exIds) {
  return (Array.isArray(list) ? list : []).filter(e => e && exIds.has(e.exerciseId)).map(e => ({
    id: okId(e.id) ? e.id : uid(), exerciseId: e.exerciseId, sets: cleanSets(e.sets), ...(e.note != null ? { note: str(e.note) } : {}),
  }));
}
// Anything stored or restored is treated as untrusted: ids/units/types that end up inside HTML attributes
// are checked against strict patterns, so a tampered backup file can't inject markup or script.
function sanitize(s) {
  s.settings = { unit: s.settings.unit === 'lb' ? 'lb' : 'kg', rest: Math.max(0, Math.min(3600, num0(s.settings.rest))), sound: s.settings.sound !== false, sets: Math.max(1, Math.min(10, Math.round(num0(s.settings.sets)) || 3)) };
  s.exercises = s.exercises.filter(e => e && okId(e.id)).map(e => ({
    id: e.id, name: str(e.name, 120) || 'Exercise', category: str(e.category, 40), bodyPart: str(e.bodyPart, 40),
    custom: !!e.custom, media: /^\d{4}$/.test(e.media) ? e.media : null,
  }));
  const exIds = new Set(s.exercises.map(e => e.id));
  s.templates = s.templates.filter(t => t && typeof t === 'object').map(t => ({
    id: okId(t.id) ? t.id : uid(), name: str(t.name, 120), notes: str(t.notes), created: num0(t.created),
    exercises: cleanWorkoutExercises(t.exercises, exIds),
  }));
  const tplIds = new Set(s.templates.map(t => t.id));
  const cleanWorkout = w => ({
    id: okId(w.id) ? w.id : uid(), name: str(w.name, 120), notes: str(w.notes), templateId: tplIds.has(w.templateId) ? w.templateId : null,
    start: num0(w.start), end: num0(w.end) || num0(w.start), exercises: cleanWorkoutExercises(w.exercises, exIds),
    prs: (Array.isArray(w.prs) ? w.prs : []).filter(p => p && exIds.has(p.exerciseId))
      .map(p => ({ exerciseId: p.exerciseId, kind: str(p.kind, 40), value: num0(p.value) })),
  });
  s.history = s.history.filter(w => w && typeof w === 'object').map(cleanWorkout);
  if (s.active && typeof s.active === 'object') {
    const a = cleanWorkout(s.active);
    const r = s.active.rest;
    s.active = { ...a, rest: r && Number.isFinite(+r.end) && Number.isFinite(+r.total) ? { end: +r.end, total: +r.total } : null };
  } else s.active = null;
  return s;
}

function migrate(d) {
  const s = Object.assign(freshState(), d);
  s.settings = Object.assign({ unit: 'kg', rest: 90, sound: true, sets: 3 }, d.settings || {});
  s.exercises = Array.isArray(d.exercises) ? d.exercises : [];
  s.templates = Array.isArray(d.templates) ? d.templates : [];
  s.history = Array.isArray(d.history) ? d.history : [];
  // add any new built-in exercises shipped in an update
  const have = new Set(s.exercises.map(e => e.id));
  for (const b of builtinExercises()) if (!have.has(b.id)) s.exercises.push(b);
  const bmap = new Map(builtinExercises().map(b => [b.id, b]));
  for (const e of s.exercises) if (!e.custom && bmap.has(e.id)) e.media = bmap.get(e.id).media;
  return sanitize(s);
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.error('Load failed', e); }
  return freshState();
}

let state = load();
try { Object.keys(localStorage).filter(k => k.startsWith('ironlog.info.')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — storage full? Export a backup.'); console.error(e); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

function exById(id) { return state.exercises.find(e => e.id === id) || { id, name: 'Unknown exercise', category: 'Other', bodyPart: 'Other' }; }
const MEDIA_BASE = window.EXERCISE_MEDIA_BASE || '';
function exImg(e, frame = 0) { return e && e.media ? `${MEDIA_BASE}${e.media}-${frame ? 'tension' : 'relaxation'}.png` : null; }
function exThumb(e, cls = 'thumb') {
  const u = exImg(e);
  return `<span class="${cls}"><b>${esc((e.name || '?')[0].toUpperCase())}</b>${u ? `<img src="${u}" loading="lazy" alt="" data-fallback="remove">` : ''}</span>`;
}
function exHero(e) {
  if (!e.media) return '';
  return `<div class="hero"><img src="${exImg(e, 0)}" alt="" data-fallback="hero"><img class="f2" src="${exImg(e, 1)}" alt="" data-fallback="remove"></div>`;
}
// broken/offline images: hide them (replaces inline onerror handlers)
document.addEventListener('error', ev => {
  const t = ev.target;
  if (!t || t.tagName !== 'IMG' || !t.dataset.fallback) return;
  if (t.dataset.fallback === 'hero') { const h = t.closest('.hero'); if (h) h.remove(); } else t.remove();
}, true);
function exLabel(e) { return e.category && e.category !== 'Other' ? `${e.name} (${e.category})` : e.name; }
const noWeight = e => e.category === 'Bodyweight';
function weightHeader(e) {
  const u = state.settings.unit;
  if (e.category === 'Weighted Bodyweight') return '+' + u;
  if (e.category === 'Assisted Bodyweight') return '−' + u;
  return u;
}

// ---------------------------------------------------------------- stats
function e1rm(w, r) { w = num(w); r = num(r); if (w <= 0 || r <= 0) return 0; return r === 1 ? w : w * (1 + r / 30); }
function setStats(sets) {
  const st = { maxW: 0, e1rm: 0, maxVol: 0, maxReps: 0, volume: 0, count: 0 };
  for (const s of sets) {
    if (s.type === 'w') continue;
    const w = num(s.weight), r = num(s.reps);
    st.count++;
    st.maxW = Math.max(st.maxW, w);
    st.e1rm = Math.max(st.e1rm, e1rm(w, r));
    st.maxVol = Math.max(st.maxVol, w * r);
    st.maxReps = Math.max(st.maxReps, r);
  }
  for (const s of sets) st.volume += num(s.weight) * num(s.reps);
  return st;
}
function workoutVolume(w) { return w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + num(s.weight) * num(s.reps), 0), 0); }
function workoutSetCount(w) { return w.exercises.reduce((a, e) => a + e.sets.length, 0); }

function historyFor(exerciseId, excludeId) {
  // newest first: [{workout, sets}]
  const out = [];
  for (const w of state.history) {
    if (w.id === excludeId) continue;
    const sets = w.exercises.filter(e => e.exerciseId === exerciseId).flatMap(e => e.sets);
    if (sets.length) out.push({ workout: w, sets });
  }
  return out;
}
function previousSets(exerciseId, excludeId) {
  const h = historyFor(exerciseId, excludeId);
  return h.length ? h[0].sets : [];
}
function computePRs(record) {
  const prs = [];
  for (const e of record.exercises) {
    const prior = historyFor(e.exerciseId, record.id);
    if (!prior.length) continue; // first time doing it — not counted as a PR
    const before = setStats(prior.flatMap(p => p.sets));
    const now = setStats(e.sets);
    const ex = exById(e.exerciseId);
    if (noWeight(ex)) {
      if (now.maxReps > before.maxReps) prs.push({ exerciseId: e.exerciseId, kind: 'Most reps', value: now.maxReps });
      continue;
    }
    if (now.maxW > before.maxW) prs.push({ exerciseId: e.exerciseId, kind: 'Heaviest weight', value: now.maxW });
    if (now.e1rm > before.e1rm + 0.05) prs.push({ exerciseId: e.exerciseId, kind: 'Est. 1RM', value: round1(now.e1rm) });
    if (now.maxVol > before.maxVol) prs.push({ exerciseId: e.exerciseId, kind: 'Best set volume', value: now.maxVol });
  }
  return prs;
}

// ---------------------------------------------------------------- UI state
const ui = {
  tab: 'workout',
  stack: [],          // overlays: {type, ...}
  exSearch: '', exPart: 'All',
};
function push(o) { ui.stack.push(o); render(); }
function pop() { ui.stack.pop(); render(); }
function topOverlay() { return ui.stack[ui.stack.length - 1]; }
function ctxWorkout(ctx) {
  if (ctx === 'active') return state.active;
  const o = ui.stack[+ctx];
  return o && o.draft;
}
function persistCtx(ctx) { if (ctx === 'active') save(); }

// ---------------------------------------------------------------- icons
const I = {
  history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  workout: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  exercises: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" class="fill"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  weight: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
  sets: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};

// ---------------------------------------------------------------- render
function render() {
  const app = document.getElementById('app');
  // preserve scroll positions
  const scrolls = {};
  app.querySelectorAll('[data-scroll]').forEach(el => { scrolls[el.dataset.scroll] = el.scrollTop; });

  let html = `<main class="main"><div class="scroll" data-scroll="tab-${ui.tab}">${renderTab()}</div></main>`;
  if (state.active && !ui.stack.some(o => o.type === 'active')) html += renderMiniBar();
  html += renderTabBar();
  ui.stack.forEach((o, i) => { html += renderOverlay(o, i); o.shown = true; });
  app.innerHTML = html;

  app.querySelectorAll('textarea').forEach(autoGrow);
  app.querySelectorAll('[data-info]').forEach(fillExerciseInfo);
  maybeShowSetTip();
  app.querySelectorAll('[data-scroll]').forEach(el => { if (scrolls[el.dataset.scroll] != null) el.scrollTop = scrolls[el.dataset.scroll]; });
  tick();
}

function renderTabBar() {
  const tabs = [['history', 'History'], ['workout', 'Workout'], ['exercises', 'Exercises'], ['settings', 'Settings']];
  return `<nav class="tabbar">${tabs.map(([k, l]) =>
    `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${I[k]}<span>${l}</span></button>`).join('')}</nav>`;
}

function renderMiniBar() {
  const a = state.active;
  return `<button class="minibar" data-act="open-active">
    <span class="mb-name">${esc(a.name || 'Workout')}</span>
    <span class="mb-time" data-elapsed="${a.start}">${fmtDuration(Date.now() - a.start)}</span>
    <span class="mb-rest" data-rest-mini></span>
  </button>`;
}

function renderTab() {
  switch (ui.tab) {
    case 'history': return renderHistoryTab();
    case 'exercises': return renderExercisesTab();
    case 'settings': return renderSettingsTab();
    default: return renderWorkoutTab();
  }
}

// ---- Workout tab
function renderWorkoutTab() {
  const t = state.templates;
  return `
  <header class="big-title">Start Workout</header>
  <section class="pad">
    <div class="section-label">Quick start</div>
    <button class="btn primary block" data-act="start-empty">Start an Empty Workout</button>
  </section>
  <section class="pad">
    <div class="row-between">
      <h2 class="h2">Templates</h2>
      <button class="btn small soft" data-act="tpl-new">+ Template</button>
    </div>
    <div class="section-label">My Templates (${t.length})</div>
    ${t.length ? `<div class="tpl-grid">${t.map(renderTemplateCard).join('')}</div>`
      : `<div class="empty">No templates yet. Tap <b>+ Template</b> to create one — there's no limit.</div>`}
  </section>`;
}
function lastPerformed(templateId) {
  const w = state.history.find(h => h.templateId === templateId);
  return w ? w.start : null;
}
function renderTemplateCard(t) {
  const lp = lastPerformed(t.id);
  const lines = t.exercises.slice(0, 6).map(e => `<div class="tpl-line">${e.sets.length} × ${esc(exLabel(exById(e.exerciseId)))}</div>`).join('');
  const more = t.exercises.length > 6 ? `<div class="tpl-line muted">+${t.exercises.length - 6} more</div>` : '';
  return `<div class="card tpl-card" data-act="tpl-open" data-id="${t.id}">
    <div class="row-between"><div class="tpl-name">${esc(t.name || 'Untitled')}</div>
      <button class="icon-btn" data-act="tpl-menu" data-id="${t.id}" aria-label="Template options">${I.more}</button></div>
    <div class="muted small">${lp ? 'Last performed: ' + timeAgo(lp) : 'Never performed'}</div>
    <div class="tpl-lines">${lines || '<div class="tpl-line muted">No exercises</div>'}${more}</div>
  </div>`;
}

// ---- History tab
function renderHistoryTab() {
  const h = state.history;
  if (!h.length) return `<header class="big-title">History</header><div class="empty pad">No workouts yet. Finish a workout and it'll show up here.</div>`;
  let out = `<header class="big-title">History</header><section class="pad">${renderWeeklyChart()}</section><section class="pad">`;
  let month = '';
  for (const w of h) {
    const m = fmtDate(w.start, { month: 'long', year: 'numeric' });
    if (m !== month) { month = m; out += `<div class="section-label">${esc(m.toUpperCase())}</div>`; }
    out += renderHistoryCard(w);
  }
  return out + '</section>';
}
function renderHistoryCard(w) {
  const prs = (w.prs || []).length;
  const lines = w.exercises.map(e => {
    const ex = exById(e.exerciseId);
    const best = bestSetText(e.sets, ex);
    return `<div class="hist-line"><span>${e.sets.length} × ${esc(exLabel(ex))}</span><span class="muted">${best}</span></div>`;
  }).join('');
  return `<div class="card hist-card" data-act="wk-open" data-id="${w.id}">
    <div class="tpl-name">${esc(w.name || 'Workout')}</div>
    <div class="muted small">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmtTime(w.start)}</div>
    <div class="stats-row">
      <span>${I.clock}${fmtDurShort((w.end || w.start) - w.start)}</span>
      <span>${I.weight}${fmtNum(workoutVolume(w))} ${state.settings.unit}</span>
      ${prs ? `<span>${I.trophy}${prs} PR${prs > 1 ? 's' : ''}</span>` : ''}
    </div>
    <div class="hist-head"><span>Exercise</span><span>Best set</span></div>
    ${lines}
  </div>`;
}
function bestSetText(sets, ex) {
  let best = null, bestScore = -1;
  for (const s of sets) {
    const score = noWeight(ex) ? num(s.reps) : e1rm(s.weight, s.reps) || num(s.reps) / 1000;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best) return '';
  return noWeight(ex) ? `${fmtNum(num(best.reps))} reps` : `${fmtNum(num(best.weight))} ${state.settings.unit} × ${fmtNum(num(best.reps))}`;
}
function renderWeeklyChart() {
  const weeks = 8, now = startOfWeek(Date.now());
  const counts = Array.from({ length: weeks }, (_, i) => {
    const ws = now - (weeks - 1 - i) * 7 * DAY, we = ws + 7 * DAY;
    return { ws, n: state.history.filter(w => w.start >= ws && w.start < we).length };
  });
  const max = Math.max(3, ...counts.map(c => c.n));
  const W = 320, H = 110, bw = W / weeks;
  const bars = counts.map((c, i) => {
    const h = (c.n / max) * (H - 30);
    const x = i * bw + bw * 0.2, y = H - 18 - h;
    return `<rect x="${x}" y="${y}" width="${bw * 0.6}" height="${Math.max(h, 1)}" rx="3" class="bar"/>
      ${c.n ? `<text x="${x + bw * 0.3}" y="${y - 4}" class="bar-num">${c.n}</text>` : ''}
      <text x="${x + bw * 0.3}" y="${H - 4}" class="bar-lbl">${fmtDate(c.ws, { day: 'numeric', month: 'numeric' })}</text>`;
  }).join('');
  return `<div class="card"><div class="section-label" style="margin-top:0">Workouts per week</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg></div>`;
}

// ---- Exercises tab
function renderExercisesTab() {
  return `<header class="big-title row-between">Exercises <button class="btn small soft" data-act="ex-new">+ New</button></header>
  <section class="pad sticky-search">
    <input class="search" type="search" placeholder="Search exercises" data-search="ex" value="${esc(ui.exSearch)}" autocomplete="off">
    ${renderPartChips(ui.exPart, 'ex-part')}
  </section>
  <section class="pad" id="ex-list">${renderExerciseList(ui.exSearch, ui.exPart, 'ex-open')}</section>`;
}
function renderPartChips(current, act) {
  return `<div class="chips">${['All', ...BODY_PARTS].map(p =>
    `<button class="chip ${current === p ? 'on' : ''}" data-act="${act}" data-part="${esc(p)}">${esc(p)}</button>`).join('')}</div>`;
}
function filterExercises(q, part) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return state.exercises
    .filter(e => part === 'All' || e.bodyPart === part)
    .filter(e => { const s = exLabel(e).toLowerCase() + ' ' + e.bodyPart.toLowerCase(); return terms.every(t => s.includes(t)); })
    .sort((a, b) => exLabel(a).localeCompare(exLabel(b)));
}
function renderExerciseList(q, part, act, selected) {
  const list = filterExercises(q, part);
  if (!list.length) return `<div class="empty">No exercises found.</div>`;
  let letter = '', out = '';
  for (const e of list) {
    const L = e.name[0].toUpperCase();
    if (L !== letter) { letter = L; out += `<div class="letter">${esc(L)}</div>`; }
    const sel = selected && selected.includes(e.id);
    const count = historyFor(e.id).length;
    out += `<button class="ex-row ${sel ? 'sel' : ''}" data-act="${act}" data-id="${e.id}">
      ${exThumb(e)}<span class="ex-txt"><span class="ex-name">${esc(exLabel(e))}${e.custom ? ' <span class="tag">custom</span>' : ''}</span>
      <span class="muted small">${esc(e.bodyPart)}${count ? ` · ${count} workout${count > 1 ? 's' : ''}` : ''}</span></span>
      ${selected ? `<span class="sel-dot">${sel ? I.check : ''}</span>` : ''}
    </button>`;
  }
  return out;
}

// ---- Settings tab
function renderSettingsTab() {
  const s = state.settings;
  const totalVol = state.history.reduce((a, w) => a + workoutVolume(w), 0);
  return `<header class="big-title">Settings</header>
  <section class="pad">
    <div class="card stat-grid">
      <div><b>${state.history.length}</b><span>workouts</span></div>
      <div><b>${state.templates.length}</b><span>templates</span></div>
      <div><b>${fmtNum(totalVol / 1000)}k</b><span>${s.unit} lifted</span></div>
    </div>
    <div class="section-label">Preferences</div>
    <div class="list">
      <button class="list-row" data-act="set-unit"><span>Weight unit</span><span class="muted">${s.unit}</span></button>
      <button class="list-row" data-act="set-rest"><span>Default rest timer</span><span class="muted">${s.rest ? fmtDuration(s.rest * 1000) : 'Off'}</span></button>
      <button class="list-row" data-act="toggle-sound"><span>Rest timer sound</span><span class="muted">${s.sound ? 'On' : 'Off'}</span></button>
      <button class="list-row" data-act="set-sets"><span>Sets per new exercise</span><span class="muted">${s.sets}</span></button>
    </div>
    <div class="note">Changing the unit only changes the label; numbers you already logged are not converted.</div>
    <div class="section-label">Your data</div>
    <div class="list">
      <button class="list-row" data-act="export"><span>Back up data</span><span class="muted">›</span></button>
      <button class="list-row" data-act="import"><span>Restore from backup</span><span class="muted">›</span></button>
      <button class="list-row" data-act="export-csv"><span>Export history (CSV)</span><span class="muted">›</span></button>
      <button class="list-row danger" data-act="reset"><span>Erase all data</span><span></span></button>
    </div>
    <div class="note">Everything is stored only on this device. Back up regularly (e.g. save the file to iCloud Drive) so you don't lose your history if you delete the app.</div>
    <div class="note center">IronLog v${APP_VERSION}<br>Exercise illustrations &amp; instructions by
      <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">Everkinetic</a>, licensed
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a></div>
  </section>`;
}

// ---------------------------------------------------------------- overlays
function renderOverlay(o, i) {
  const anim = o.shown ? '' : ' enter';
  switch (o.type) {
    case 'active': return `<div class="overlay${anim}" style="z-index:${20 + i}">${renderActive(i)}</div>`;
    case 'tplEdit': return `<div class="overlay${anim}" style="z-index:${20 + i}">${renderTemplateEditor(o, i)}</div>`;
    case 'histEdit': return `<div class="overlay${anim}" style="z-index:${20 + i}">${renderHistoryEditor(o, i)}</div>`;
    case 'picker': return `<div class="overlay${anim}" style="z-index:${20 + i}">${renderPicker(o, i)}</div>`;
    case 'exDetail': return `<div class="overlay${anim}" style="z-index:${20 + i}">${renderExerciseDetail(o, i)}</div>`;
    case 'wkDetail': return `<div class="overlay${anim}" style="z-index:${20 + i}">${renderWorkoutDetail(o, i)}</div>`;
    case 'summary': return `<div class="overlay summary-ov${anim}" style="z-index:${20 + i}">${renderSummary(o, i)}</div>`;
    case 'tplPreview': return `<div class="modal-back${anim}" style="z-index:${20 + i}" data-act="close-self">${renderTemplatePreview(o, i)}</div>`;
    default: return '';
  }
}

function renderActive() {
  const a = state.active;
  return `<div class="ov-head">
      <button class="icon-btn" data-act="min-active" aria-label="Minimize">${I.down}</button>
      <span class="ov-timer" data-elapsed="${a.start}">${fmtDuration(Date.now() - a.start)}</span>
      <button class="btn small green" data-act="finish">Finish</button>
    </div>
    <div class="scroll" data-scroll="active">
      <div class="pad" data-ctx="active">
        <input class="title-input" data-f="name" value="${esc(a.name)}" placeholder="Workout name">
        <div class="muted small">${fmtDate(a.start, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <textarea class="notes" data-f="notes" placeholder="Workout notes" rows="1">${esc(a.notes || '')}</textarea>
        ${renderEditor(a, 'active')}
        <button class="btn soft block" data-act="add-ex">Add Exercises</button>
        <button class="btn danger-soft block" data-act="cancel-workout">Cancel Workout</button>
        <div class="bottom-space"></div>
      </div>
    </div>
    ${renderRestBar()}`;
}

function renderRestBar() {
  const r = state.active && state.active.rest;
  if (!r) return '';
  const left = Math.max(0, r.end - Date.now());
  return `<div class="restbar">
    <div class="rest-prog"><div class="rest-fill" data-rest-fill style="width:${(left / (r.total * 1000)) * 100}%"></div></div>
    <div class="rest-row">
      <button class="btn small soft" data-act="rest-adj" data-d="-15">−15</button>
      <div class="rest-time"><span class="muted small">Rest</span><b data-rest-text>${fmtDuration(left)}</b></div>
      <button class="btn small soft" data-act="rest-adj" data-d="15">+15</button>
      <button class="btn small primary" data-act="rest-skip">Skip</button>
    </div>
  </div>`;
}

function renderTemplateEditor(o, i) {
  const d = o.draft;
  return `<div class="ov-head">
      <button class="btn small ghost" data-act="close">Cancel</button>
      <span class="ov-title">${o.isNew ? 'New Template' : 'Edit Template'}</span>
      <button class="btn small primary" data-act="tpl-save">Save</button>
    </div>
    <div class="scroll" data-scroll="o${i}">
      <div class="pad" data-ctx="${i}">
        <input class="title-input" data-f="name" value="${esc(d.name)}" placeholder="Template name">
        <textarea class="notes" data-f="notes" placeholder="Notes" rows="1">${esc(d.notes || '')}</textarea>
        ${renderEditor(d, 'template')}
        <button class="btn soft block" data-act="add-ex">Add Exercises</button>
        <div class="bottom-space"></div>
      </div>
    </div>`;
}

function renderHistoryEditor(o, i) {
  const d = o.draft;
  return `<div class="ov-head">
      <button class="btn small ghost" data-act="close">Cancel</button>
      <span class="ov-title">Edit Workout</span>
      <button class="btn small primary" data-act="hist-save">Save</button>
    </div>
    <div class="scroll" data-scroll="o${i}">
      <div class="pad" data-ctx="${i}">
        <input class="title-input" data-f="name" value="${esc(d.name)}" placeholder="Workout name">
        <div class="muted small">${fmtDate(d.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <label class="field-inline">Duration (minutes)
          <input class="in wide" inputmode="numeric" data-f="duration" value="${Math.round((d.end - d.start) / 60000)}"></label>
        <textarea class="notes" data-f="notes" placeholder="Workout notes" rows="1">${esc(d.notes || '')}</textarea>
        ${renderEditor(d, 'history')}
        <button class="btn soft block" data-act="add-ex">Add Exercises</button>
        <div class="bottom-space"></div>
      </div>
    </div>`;
}

// Shared exercise/set editor. mode: 'active' | 'template' | 'history'
function renderEditor(w, mode) {
  if (!w.exercises.length) return `<div class="empty">No exercises yet.</div>`;
  const unit = state.settings.unit;
  return w.exercises.map(we => {
    const ex = exById(we.exerciseId);
    const prev = previousSets(we.exerciseId, mode === 'history' ? w.id : null);
    const showCheck = mode === 'active';
    const bw = noWeight(ex);
    const prs = mode === 'active' ? prFlags(w, we) : {};
    let n = 0;
    const rows = we.sets.map((s, si) => {
      const label = s.type === 'w' ? 'W' : s.type === 'd' ? 'D' : s.type === 'f' ? 'F' : String(++n);
      const p = prev[si];
      const prevTxt = p ? (bw ? `${fmtNum(num(p.reps))} reps` : `${fmtNum(num(p.weight))} × ${fmtNum(num(p.reps))}`) : '—';
      return `<div class="swipe" data-we="${we.id}" data-s="${s.id}">
      <button class="swipe-del" data-act="set-del" data-we="${we.id}" data-s="${s.id}" tabindex="-1">Delete</button>
      <div class="set-row ${s.done ? 'done' : ''} ${prs[s.id] ? 'pr' : ''} ${showCheck ? '' : 'nocheck'}" data-row="${s.id}">
        <button class="set-num t-${s.type}" data-act="set-menu" data-we="${we.id}" data-s="${s.id}">${prs[s.id] ? I.trophy : label}</button>
        <button class="prev" data-act="fill-prev" data-we="${we.id}" data-s="${s.id}" ${p ? '' : 'disabled'}>${prevTxt}</button>
        ${bw ? '<span class="in placeholder-cell"></span>' :
          `<input class="in" inputmode="decimal" enterkeyhint="next" data-f="set" data-k="weight" data-we="${we.id}" data-s="${s.id}" value="${esc(s.weight)}" placeholder="${p && !bw ? esc(fmtNum(num(p.weight))) : ''}">`}
        <input class="in" inputmode="numeric" enterkeyhint="done" data-f="set" data-k="reps" data-we="${we.id}" data-s="${s.id}" value="${esc(s.reps)}" placeholder="${p ? esc(fmtNum(num(p.reps))) : ''}">
        ${showCheck ? `<button class="chk" data-act="set-done" data-we="${we.id}" data-s="${s.id}" aria-label="Complete set">${I.check}</button>` : ''}
      </div></div>`;
    }).join('');
    return `<div class="ex-block">
      <div class="row-between">
        <button class="ex-title" data-act="ex-open" data-id="${ex.id}">${exThumb(ex, 'thumb sm')}<span>${esc(exLabel(ex))}</span></button>
        <button class="icon-btn" data-act="ex-menu" data-we="${we.id}" aria-label="Exercise options">${I.more}</button>
      </div>
      ${we.note != null ? `<textarea class="notes ex-note" data-f="exnote" data-we="${we.id}" placeholder="Exercise note" rows="1">${esc(we.note)}</textarea>` : ''}
      <div class="set-row head ${showCheck ? '' : 'nocheck'}"><span>Set</span><span>Previous</span><span>${bw ? '' : esc(weightHeader(ex))}</span><span>Reps</span>${showCheck ? `<span class="hchk">${I.check}</span>` : ''}</div>
      ${rows}
      <button class="btn addset block" data-act="add-set" data-we="${we.id}">+ Add Set</button>
    </div>`;
  }).join('');
}

function renderPicker(o, i) {
  const n = o.selected.length;
  return `<div class="ov-head">
      <button class="btn small ghost" data-act="close">Cancel</button>
      <span class="ov-title">${o.mode === 'replace' ? 'Replace Exercise' : 'Add Exercises'}</span>
      <button class="btn small primary" data-act="picker-done" ${n ? '' : 'disabled'}>${o.mode === 'replace' ? 'Replace' : `Add${n ? ' (' + n + ')' : ''}`}</button>
    </div>
    <div class="pad sticky-search">
      <div class="row-between gap"><input class="search" type="search" placeholder="Search" data-search="picker" value="${esc(o.q)}" autocomplete="off">
      <button class="btn small soft" data-act="ex-new" data-from-picker="1">New</button></div>
      ${renderPartChips(o.part, 'picker-part')}
    </div>
    <div class="scroll" data-scroll="o${i}"><div class="pad" id="picker-list">${renderExerciseList(o.q, o.part, 'picker-toggle', o.selected)}</div></div>`;
}

function renderExerciseDetail(o, i) {
  const ex = exById(o.id);
  const h = historyFor(ex.id);
  const all = setStats(h.flatMap(x => x.sets));
  const bw = noWeight(ex), u = state.settings.unit;
  const pts = h.slice().reverse().map(x => {
    const st = setStats(x.sets);
    return { t: x.workout.start, y: bw ? st.maxReps : round1(st.e1rm) };
  }).filter(p => p.y > 0);
  const stats = bw
    ? `<div><b>${fmtNum(all.maxReps)}</b><span>most reps</span></div><div><b>${h.length}</b><span>workouts</span></div><div><b>${h.reduce((a, x) => a + x.sets.length, 0)}</b><span>sets</span></div>`
    : `<div><b>${fmtNum(all.e1rm)}</b><span>est. 1RM</span></div><div><b>${fmtNum(all.maxW)}</b><span>heaviest (${u})</span></div><div><b>${fmtNum(all.maxVol)}</b><span>best set vol.</span></div>`;
  const list = h.map(x => `<div class="card hist-card" data-act="wk-open" data-id="${x.workout.id}">
      <div class="row-between"><b>${esc(x.workout.name)}</b><span class="muted small">${fmtDate(x.workout.start, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
      ${x.sets.map((s, k) => `<div class="hist-line"><span>${s.type === 'n' ? k + 1 : s.type.toUpperCase()}. ${bw ? '' : fmtNum(num(s.weight)) + ' ' + u + ' × '}${fmtNum(num(s.reps))}</span>
        <span class="muted">${!bw && e1rm(s.weight, s.reps) ? '1RM ' + fmtNum(e1rm(s.weight, s.reps)) : ''}</span></div>`).join('')}
    </div>`).join('');
  return `<div class="ov-head">
      <button class="icon-btn" data-act="close" aria-label="Back">${I.back}</button>
      <span class="ov-title">${esc(exLabel(ex))}</span>
      ${ex.custom ? `<button class="btn small ghost danger-txt" data-act="ex-del" data-id="${ex.id}">Delete</button>` : '<span class="spacer"></span>'}
    </div>
    <div class="scroll" data-scroll="o${i}"><div class="pad">
      ${exHero(ex)}
      <div class="muted small">${esc(ex.bodyPart)} · ${esc(ex.category)}</div>
      ${ex.media ? `<div data-info="${esc(ex.media)}"></div>` : ''}
      ${h.length ? `<div class="card stat-grid">${stats}</div>
        <div class="card"><div class="section-label" style="margin-top:0">${bw ? 'Most reps' : 'Estimated 1RM'} over time</div>${lineChart(pts)}</div>
        <div class="section-label">History</div>${list}`
      : `<div class="empty">You haven't logged this exercise yet.</div>`}
      <div class="bottom-space"></div>
    </div></div>`;
}

function lineChart(pts) {
  if (pts.length < 2) return `<div class="muted small" style="padding:20px 0">Log this exercise in at least 2 workouts to see a chart.</div>`;
  const W = 320, H = 140, P = 28;
  const ys = pts.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, tspan = t1 - t0 || 1;
  const X = t => P + ((t - t0) / tspan) * (W - P - 8), Y = y => 10 + (1 - (y - lo) / span) * (H - 34);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <text x="2" y="${Y(hi) + 4}" class="bar-lbl" style="text-anchor:start">${fmtNum(hi)}</text>
    <text x="2" y="${Y(lo) + 4}" class="bar-lbl" style="text-anchor:start">${fmtNum(lo)}</text>
    <path d="${d}" class="line"/>
    ${pts.map(p => `<circle cx="${X(p.t)}" cy="${Y(p.y)}" r="3" class="dot"/>`).join('')}
    <text x="${P}" y="${H - 4}" class="bar-lbl" style="text-anchor:start">${fmtDate(t0, { day: 'numeric', month: 'short' })}</text>
    <text x="${W - 8}" y="${H - 4}" class="bar-lbl" style="text-anchor:end">${fmtDate(t1, { day: 'numeric', month: 'short' })}</text>
  </svg>`;
}

function renderWorkoutDetail(o, i) {
  const w = state.history.find(x => x.id === o.id);
  if (!w) return `<div class="ov-head"><button class="icon-btn" data-act="close">${I.back}</button></div>`;
  const u = state.settings.unit;
  const prs = w.prs || [];
  const body = w.exercises.map(e => {
    const ex = exById(e.exerciseId), bw = noWeight(ex);
    let n = 0;
    return `<div class="card">
      <button class="ex-title" data-act="ex-open" data-id="${ex.id}">${esc(exLabel(ex))}</button>
      ${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}
      ${e.sets.map(s => `<div class="hist-line"><span><span class="set-badge t-${s.type}">${s.type === 'n' ? ++n : s.type.toUpperCase()}</span>
        ${bw ? '' : fmtNum(num(s.weight)) + ' ' + u + ' × '}${fmtNum(num(s.reps))}${bw ? ' reps' : ''}</span>
        <span class="muted">${!bw && e1rm(s.weight, s.reps) ? '1RM ' + fmtNum(e1rm(s.weight, s.reps)) : ''}</span></div>`).join('')}
    </div>`;
  }).join('');
  return `<div class="ov-head">
      <button class="icon-btn" data-act="close" aria-label="Back">${I.back}</button>
      <span class="ov-title">${esc(w.name)}</span>
      <button class="icon-btn" data-act="wk-menu" data-id="${w.id}" aria-label="Options">${I.more}</button>
    </div>
    <div class="scroll" data-scroll="o${i}"><div class="pad">
      <div class="muted small">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(w.start)}</div>
      <div class="stats-row">
        <span>${I.clock}${fmtDurShort(w.end - w.start)}</span><span>${I.weight}${fmtNum(workoutVolume(w))} ${u}</span><span>${I.sets}${workoutSetCount(w)} sets</span>
      </div>
      ${w.notes ? `<div class="card">${esc(w.notes)}</div>` : ''}
      ${prs.length ? `<div class="card pr-card"><div class="section-label" style="margin-top:0">${I.trophy}Personal records</div>
        ${prs.map(p => `<div class="hist-line"><span>${esc(exLabel(exById(p.exerciseId)))}</span><span>${esc(p.kind)}: <b>${fmtNum(p.value)}</b></span></div>`).join('')}</div>` : ''}
      ${body}
      <button class="btn primary block" data-act="wk-again" data-id="${w.id}">Perform Again</button>
      <div class="bottom-space"></div>
    </div></div>`;
}

function renderTemplatePreview(o) {
  const t = state.templates.find(x => x.id === o.id);
  if (!t) return '';
  return `<div class="modal" data-stop>
    <div class="row-between"><button class="btn small ghost" data-act="close">✕</button>
      <b class="ov-title">${esc(t.name)}</b>
      <button class="btn small ghost" data-act="tpl-edit" data-id="${t.id}">Edit</button></div>
    ${t.notes ? `<div class="muted small">${esc(t.notes)}</div>` : ''}
    <div class="muted small">${lastPerformed(t.id) ? 'Last performed: ' + timeAgo(lastPerformed(t.id)) : 'Never performed'}</div>
    <div class="modal-list">${t.exercises.map(e => {
      const ex = exById(e.exerciseId);
      return `<div class="hist-line"><span>${e.sets.length} × ${esc(exLabel(ex))}</span><span class="muted">${esc(ex.bodyPart)}</span></div>`;
    }).join('') || '<div class="muted">No exercises</div>'}</div>
    <button class="btn primary block" data-act="tpl-start" data-id="${t.id}">Start Workout</button>
  </div>`;
}

// ---------------------------------------------------------------- dialogs
function actionSheet(title, options) {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'sheet-back';
    el.innerHTML = `<div class="sheet">${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
      ${options.map((o, i) => `<button data-i="${i}" class="${o.danger ? 'danger-txt' : ''}">${esc(o.label)}</button>`).join('')}
      <button data-i="-1" class="sheet-cancel">Cancel</button></div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b && e.target !== el) return;
      e.stopPropagation();
      const i = b ? +b.dataset.i : -1;
      el.remove();
      res(i >= 0 ? options[i].value : null);
    });
    document.body.appendChild(el);
  });
}
function formDialog(title, fields, okLabel = 'Save') {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'sheet-back center';
    el.innerHTML = `<form class="modal form">
      <b class="ov-title">${esc(title)}</b>
      ${fields.map(f => `<label>${esc(f.label)}${f.type === 'select'
        ? `<select name="${f.key}">${f.options.map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input name="${f.key}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`}</label>`).join('')}
      <div class="row-between gap"><button type="button" class="btn soft block" data-cancel>Cancel</button><button class="btn primary block">${esc(okLabel)}</button></div>
    </form>`;
    const form = el.querySelector('form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const out = {}; fields.forEach(f => { out[f.key] = form.elements[f.key].value.trim(); });
      el.remove(); res(out);
    });
    el.querySelector('[data-cancel]').addEventListener('click', () => { el.remove(); res(null); });
    document.body.appendChild(el);
    setTimeout(() => { const first = form.querySelector('input'); if (first) first.focus(); }, 50);
  });
}
let toastTimer;
function toast(msg, action) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn'; b.textContent = action.label;
    b.addEventListener('click', ev => { ev.stopPropagation(); el.classList.remove('show'); action.fn(); }, { once: true });
    el.appendChild(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), action ? 4500 : 2600);
}

// ---------------------------------------------------------------- sound
let audioCtx;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio */ }
}
function beep() {
  if (!state.settings.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach(off => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.4, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.18);
      o.start(t + off); o.stop(t + off + 0.2);
    });
  } catch (e) { /* ignore */ }
}
document.addEventListener('touchend', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);

// ---------------------------------------------------------------- timers
function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = fmtDuration(now - +el.dataset.elapsed); });
  const a = state.active;
  if (a && a.rest) {
    const left = a.rest.end - now;
    if (left <= 0) {
      a.rest = null; save(); beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      toast('Rest is over — next set!');
      render();
      return;
    }
    document.querySelectorAll('[data-rest-text]').forEach(el => { el.textContent = fmtDuration(left); });
    document.querySelectorAll('[data-rest-fill]').forEach(el => { el.style.width = (left / (a.rest.total * 1000)) * 100 + '%'; });
    document.querySelectorAll('[data-rest-mini]').forEach(el => { el.textContent = 'Rest ' + fmtDuration(left); });
  }
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

function startRest() {
  const secs = state.settings.rest;
  if (!secs || !state.active) return;
  state.active.rest = { end: Date.now() + secs * 1000, total: secs };
}

// ---------------------------------------------------------------- workout lifecycle
function workoutFromTemplate(t) {
  return {
    id: uid(), name: t.name, notes: '', templateId: t.id, start: Date.now(), rest: null,
    exercises: t.exercises.map(e => ({ id: uid(), exerciseId: e.exerciseId, note: e.note, sets: e.sets.map(s => newSet(s.weight, s.reps, s.type)) })),
  };
}
async function beginWorkout(w) {
  if (state.active) {
    const choice = await actionSheet('You already have a workout in progress', [
      { label: 'Resume current workout', value: 'resume' },
      { label: 'Discard it and start new', value: 'discard', danger: true },
    ]);
    if (choice === 'resume') { ui.stack = [{ type: 'active' }]; render(); return; }
    if (choice !== 'discard') return;
  }
  state.active = w; save();
  ui.stack = [{ type: 'active' }];
  render();
}
function defaultWorkoutName() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning Workout' : h < 17 ? 'Afternoon Workout' : 'Evening Workout';
}

async function finishWorkout() {
  const a = state.active;
  const doneSets = a.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
  const totalSets = workoutSetCount(a);
  if (!doneSets) {
    const c = await actionSheet('No sets have been completed. Tap ✓ on each set you did.', [{ label: 'Discard workout', value: 'discard', danger: true }]);
    if (c === 'discard') { state.active = null; save(); ui.stack = []; render(); }
    return;
  }
  const c = await actionSheet(doneSets < totalSets ? `Finish workout? ${totalSets - doneSets} uncompleted set(s) will be removed.` : 'Finish workout?', [{ label: 'Finish', value: 'ok' }]);
  if (c !== 'ok') return;

  const record = {
    id: a.id, name: a.name || defaultWorkoutName(), notes: a.notes || '', templateId: a.templateId || null,
    start: a.start, end: Date.now(),
    exercises: a.exercises.map(e => ({ id: e.id, exerciseId: e.exerciseId, note: e.note || undefined, sets: e.sets.filter(s => s.done).map(s => ({ id: s.id, weight: s.weight, reps: s.reps, type: s.type })) }))
      .filter(e => e.sets.length),
  };
  record.prs = computePRs(record);
  state.history.unshift(record);
  state.history.sort((x, y) => y.start - x.start);
  state.active = null;
  save();

  // offered after the celebration screen is dismissed
  const t = record.templateId && state.templates.find(x => x.id === record.templateId);
  const tplUpdate = t && templateDiffers(t, a)
    ? { id: t.id, exercises: a.exercises.map(e => ({ id: uid(), exerciseId: e.exerciseId, note: e.note, sets: e.sets.map(s => newSet(s.weight, s.reps, s.type)) })) }
    : null;
  ui.stack = [{ type: 'summary', id: record.id, tplUpdate }]; ui.tab = 'history';
  render();
  startSummaryEffects(record);
}
function templateDiffers(t, w) {
  const sig = x => JSON.stringify(x.exercises.map(e => [e.exerciseId, e.sets.map(s => [String(s.weight), String(s.reps), s.type])]));
  return sig(t) !== sig(w);
}

// ---------------------------------------------------------------- export / import
async function shareOrDownload(text, name, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function dateStamp() { return new Date().toISOString().slice(0, 10); }
function exportCSV() {
  const rows = [['Date', 'Workout', 'Duration (min)', 'Exercise', 'Set', 'Type', `Weight (${state.settings.unit})`, 'Reps', 'Notes']];
  for (const w of state.history.slice().reverse()) {
    for (const e of w.exercises) {
      e.sets.forEach((s, i) => rows.push([new Date(w.start).toISOString(), w.name, Math.round((w.end - w.start) / 60000), exLabel(exById(e.exerciseId)), i + 1,
        { n: 'normal', w: 'warmup', d: 'drop', f: 'failure' }[s.type] || 'normal', s.weight, s.reps, w.notes || '']));
    }
  }
  const csv = rows.map(r => r.map(v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  shareOrDownload(csv, `ironlog-history-${dateStamp()}.csv`, 'text/csv');
}
document.getElementById('import-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.history) || !Array.isArray(d.templates) || !Array.isArray(d.exercises)) throw new Error('Not an IronLog backup');
    const c = await actionSheet(`Restore backup with ${d.history.length} workouts and ${d.templates.length} templates? This replaces everything currently in the app.`,
      [{ label: 'Replace my data', value: 'ok', danger: true }]);
    if (c !== 'ok') return;
    state = migrate(d); save(); ui.stack = []; render(); toast('Backup restored');
  } catch (err) { toast('Could not read that file: ' + err.message); }
});

// ---------------------------------------------------------------- PRs: live detection + celebration
function prFlags(w, we) {
  // which completed sets in this workout beat everything you'd done before (incl. earlier sets today)
  const out = {};
  const prior = historyFor(we.exerciseId, w.id);
  if (!prior.length) return out; // first time doing an exercise isn't a PR
  const ex = exById(we.exerciseId), bw = noWeight(ex), u = state.settings.unit;
  const best = setStats(prior.flatMap(p => p.sets));
  for (const e of w.exercises) {
    if (e.exerciseId !== we.exerciseId) continue;
    for (const s of e.sets) {
      if (!s.done || s.type === 'w') continue;
      const c = setStats([s]), k = [];
      if (bw) { if (c.maxReps > best.maxReps) k.push({ kind: 'Most reps', value: c.maxReps, unit: 'reps' }); }
      else {
        if (c.e1rm > best.e1rm + 0.05) k.push({ kind: 'Est. 1RM', value: round1(c.e1rm), unit: u });
        if (c.maxW > best.maxW) k.push({ kind: 'Heaviest weight', value: c.maxW, unit: u });
        if (c.maxVol > best.maxVol) k.push({ kind: 'Best set volume', value: c.maxVol, unit: u });
      }
      best.maxW = Math.max(best.maxW, c.maxW); best.e1rm = Math.max(best.e1rm, c.e1rm);
      best.maxVol = Math.max(best.maxVol, c.maxVol); best.maxReps = Math.max(best.maxReps, c.maxReps);
      if (k.length) out[s.id] = k;
    }
  }
  return out;
}

function celebratePR(hit) {
  const row = document.querySelector(`[data-row="${hit.setId}"]`);
  if (row) { row.classList.remove('pop'); void row.offsetWidth; row.classList.add('pop'); }
  const r = row ? row.getBoundingClientRect() : hit.rect;
  confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 80, spread: 1.3, power: 10 });
  chime([523.25, 659.25, 783.99, 1046.5]);
  haptic();
  const main = hit.kinds[0];
  prBanner(exLabel(hit.ex), `${main.kind}: ${fmtNum(main.value)} ${main.unit}`);
}

let bannerTimer;
function prBanner(title, sub) {
  let el = document.querySelector('.pr-banner');
  if (!el) { el = document.createElement('div'); el.className = 'pr-banner'; document.body.appendChild(el); }
  el.innerHTML = `<span class="pr-medal">${I.trophy}</span>
    <span class="pr-txt"><small>NEW PERSONAL RECORD</small><b>${esc(title)}</b><span>${esc(sub)}</span></span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function chime(notes, gap = 0.09) {
  if (!state.settings.sound) return;
  unlockAudio();
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const st = t + i * gap, len = i === notes.length - 1 ? 0.6 : 0.22;
      g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.35, st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, st + len);
      o.start(st); o.stop(st + len + 0.05);
    });
  } catch (e) { /* ignore */ }
}

// iOS 18+ Safari gives a light haptic tap when a "switch" checkbox is toggled; elsewhere use vibrate if present
function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(30); return; }
    let lab = document.getElementById('haptic-switch');
    if (!lab) {
      lab = document.createElement('label'); lab.id = 'haptic-switch';
      lab.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none';
      lab.innerHTML = '<input type="checkbox" switch>'; document.body.appendChild(lab);
    }
    lab.click();
  } catch (e) { /* ignore */ }
}

function confetti({ x = innerWidth / 2, y = innerHeight / 3, count = 120, spread = Math.PI, power = 12, duration = 2600 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const colors = ['#007aff', '#34c759', '#ff9500', '#ff2d55', '#ffcc00', '#af52de'];
  const parts = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * spread * 2, v = power * (0.45 + Math.random() * 0.75);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 5, h: 8 + Math.random() * 6, color: colors[(Math.random() * colors.length) | 0] };
  });
  const t0 = performance.now();
  (function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration * 0.6) / (duration * 0.4));
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

// ---------------------------------------------------------------- workout complete screen
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function renderSummary(o) {
  const w = state.history.find(x => x.id === o.id);
  if (!w) return '';
  const u = state.settings.unit, prs = w.prs || [];
  const n = state.history.filter(x => x.start <= w.start).length;
  const ws = startOfWeek(w.start);
  const thisWeek = state.history.filter(x => x.start >= ws && x.start < ws + 7 * DAY).length;
  const vol = workoutVolume(w);
  const prev = state.history.find(x => x.id !== w.id && x.start < w.start && ((w.templateId && x.templateId === w.templateId) || x.name === w.name));
  let delta = '';
  if (prev) {
    const pv = workoutVolume(prev);
    if (pv > 0) {
      const pct = Math.round((vol - pv) / pv * 100);
      if (pct > 0) delta = `<span class="up">▲ ${pct}% more volume than last time</span>`; // only celebrate improvements
    }
  }
  const byEx = [];
  for (const p of prs) {
    let g = byEx.find(x => x.exerciseId === p.exerciseId);
    if (!g) { g = { exerciseId: p.exerciseId, items: [] }; byEx.push(g); }
    g.items.push(p);
  }
  return `<div class="scroll" data-scroll="summary"><div class="pad summary">
    <div class="sum-medal ${prs.length ? 'gold' : ''}">${prs.length ? I.trophy : I.check}</div>
    <h1>${prs.length ? 'New records!' : 'Workout complete!'}</h1>
    <p class="muted">Your <b>${ordinal(n)}</b> workout · ${thisWeek} this week</p>
    <div class="card stat-grid sum-stats">
      <div><b>${fmtDurShort(w.end - w.start)}</b><span>duration</span></div>
      <div><b data-countup="${Math.round(vol)}">0</b><span>${u} lifted</span></div>
      <div><b>${workoutSetCount(w)}</b><span>sets</span></div>
    </div>
    ${delta ? `<div class="sum-delta">${delta}</div>` : ''}
    ${prs.length ? `<div class="sum-pr-count"><b data-countup="${prs.length}">0</b><span>personal record${prs.length > 1 ? 's' : ''}</span></div>
      <div class="sum-prs">${byEx.map((g, i) => {
        const ex = exById(g.exerciseId);
        return `<div class="sum-pr" style="animation-delay:${0.6 + i * 0.12}s">${exThumb(ex)}
          <div class="ex-txt"><b>${esc(exLabel(ex))}</b>${g.items.map(p => `<span class="small">${esc(p.kind)} <b class="gold-txt">${fmtNum(p.value)}${p.kind === 'Most reps' ? ' reps' : ' ' + u}</b></span>`).join('')}</div>
          <span class="pr-chip">${I.trophy}${g.items.length}</span></div>`;
      }).join('')}</div>`
      : `<p class="muted center sum-nopr">No PRs this time. Consistency is what builds them, so keep showing up!</p>`}
    <button class="btn primary block" data-act="summary-done">Done</button>
    <button class="btn ghost block" data-act="summary-view">View workout details</button>
    <div class="bottom-space"></div>
  </div></div>`;
}
function startSummaryEffects(record) {
  const prs = (record.prs || []).length;
  setTimeout(() => {
    confetti({ x: innerWidth / 2, y: innerHeight * 0.2, count: prs ? 180 : 80, spread: Math.PI * 0.9, power: prs ? 15 : 11, duration: prs ? 3400 : 2400 });
    chime(prs ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 783.99, 1046.5], prs ? 0.11 : 0.1);
    haptic();
  }, 250);
  document.querySelectorAll('[data-countup]').forEach(el => {
    const target = +el.dataset.countup, t0 = performance.now() + 200, dur = 1100;
    (function step(now) {
      const k = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtNum(Math.round(target * e));
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  });
}

// ---------------------------------------------------------------- exercise muscles + instructions (fetched once, cached)
const MUSCLE_NAMES = {
  'biceps brachii': 'Biceps', 'triceps brachii': 'Triceps', 'deltoid': 'Shoulders', 'deltoideus (clavicula)': 'Front delts',
  'erector spinae': 'Lower back', 'gastrocnemius': 'Calves', 'soleus': 'Calves (soleus)', 'glutaeus maximus': 'Glutes',
  'ischiocrural muscles': 'Hamstrings', 'latissimus dorsi': 'Lats', 'pectoralis major': 'Chest', 'trapezius': 'Traps',
  'abdominals': 'Abs', 'forearm': 'Forearms',
};
const muscleName = m => MUSCLE_NAMES[String(m).toLowerCase()] || m;
function fillExerciseInfo(el) {
  const d = (window.EXERCISE_INFO || {})[el.dataset.info];
  if (!d) return;
  const chips = [...new Set((d.primaryMuscles || []).map(muscleName))].map(m => `<span class="chip on-soft">${esc(m)}</span>`)
    .concat([...new Set((d.secondaryMuscles || []).map(muscleName))].map(m => `<span class="chip">${esc(m)}</span>`)).join('');
  el.innerHTML = `${chips ? `<div class="section-label">Muscles worked</div><div class="chips wrap">${chips}</div>` : ''}
    ${(d.instructions || []).length ? `<details class="card howto"><summary>How to do it</summary><ol>${d.instructions.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}`;
}

// ---------------------------------------------------------------- deleting sets (swipe or menu) with undo
function deleteSet(ctx, weId, setId) {
  const w = ctxWorkout(ctx), we = w && findWE(w, weId);
  if (!we) return;
  const i = we.sets.findIndex(x => x.id === setId);
  if (i < 0) return;
  const [removed] = we.sets.splice(i, 1);
  persistCtx(ctx); render();
  toast('Set deleted', { label: 'Undo', fn: () => {
    const w2 = ctxWorkout(ctx), we2 = w2 && findWE(w2, weId);
    if (!we2) return;
    we2.sets.splice(Math.min(i, we2.sets.length), 0, removed);
    persistCtx(ctx); render();
  } });
}

// Swipe a set row left: short swipe reveals "Delete", long swipe deletes straight away.
const SWIPE_OPEN = 88;
let swipe = null;
function closeSwipes(except) {
  document.querySelectorAll('.swipe.open').forEach(w => {
    if (w === except) return;
    w.classList.remove('open', 'arming');
    const r = w.querySelector('.set-row'); if (r) r.style.transform = '';
    setTimeout(() => { if (!w.classList.contains('open')) w.classList.remove('reveal'); }, 260);
  });
}
document.addEventListener('pointerdown', e => {
  const row = e.target.closest('.swipe > .set-row');
  const wrap = row && row.parentNode;
  if (!e.target.closest('.swipe-del')) closeSwipes(wrap);
  if (!row || (e.pointerType === 'mouse' && e.button !== 0)) return;
  swipe = { row, wrap, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false, base: wrap.classList.contains('open') ? -SWIPE_OPEN : 0 };
});
document.addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // vertical scroll
    if (Math.abs(dx) < 10) return;
    swipe.active = true;
    swipe.wrap.classList.add('reveal');
    swipe.row.style.transition = 'none';
    if (document.activeElement && swipe.row.contains(document.activeElement)) document.activeElement.blur();
  }
  const width = swipe.wrap.offsetWidth;
  let off = Math.min(0, swipe.base + dx);
  if (off < -width) off = -width;
  swipe.dx = off;
  swipe.row.style.transform = `translateX(${off}px)`;
  swipe.wrap.classList.toggle('arming', off < -width * 0.55);
});
function endSwipe(e) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe; swipe = null;
  if (!s.active) return;
  s.wrap.dataset.swipedAt = Date.now();
  s.row.style.transition = '';
  const width = s.wrap.offsetWidth;
  if (s.dx < -width * 0.55) {
    s.row.style.transform = `translateX(${-width}px)`;
    s.wrap.classList.add('removing');
    setTimeout(() => deleteSet(getCtx(s.wrap), s.wrap.dataset.we, s.wrap.dataset.s), 200);
  } else if (s.dx < -SWIPE_OPEN / 2) {
    s.row.style.transform = `translateX(${-SWIPE_OPEN}px)`;
    s.wrap.classList.add('open'); s.wrap.classList.remove('arming');
  } else {
    s.row.style.transform = '';
    s.wrap.classList.remove('open', 'arming');
    setTimeout(() => { if (!s.wrap.classList.contains('open')) s.wrap.classList.remove('reveal'); }, 260);
  }
}
document.addEventListener('pointerup', endSwipe);
document.addEventListener('pointercancel', endSwipe);
// a swipe shouldn't also count as a tap on the number/checkmark under your finger
document.addEventListener('click', e => {
  const wrap = e.target.closest('.swipe');
  if (!wrap || e.target.closest('.swipe-del')) return;
  if (Date.now() - (+wrap.dataset.swipedAt || 0) < 400) { e.stopPropagation(); e.preventDefault(); }
}, true);

function maybeShowSetTip() {
  try {
    if (localStorage.getItem('ironlog.tip.sets') || !document.querySelector('.swipe')) return;
    localStorage.setItem('ironlog.tip.sets', '1');
  } catch (e) { return; }
  setTimeout(() => toast('Tip: swipe a set left to delete it. Tap the set number for more options.'), 900);
}

// ---------------------------------------------------------------- actions
function getCtx(el) { const c = el.closest('[data-ctx]'); return c ? c.dataset.ctx : null; }
function findWE(w, id) { return w.exercises.find(e => e.id === id); }

const ACTIONS = {
  'tab': el => { ui.tab = el.dataset.tab; render(); },
  'close': () => pop(),
  'close-self': (el, e) => { if (e.target === el) pop(); },

  // workout start
  'start-empty': () => beginWorkout({ id: uid(), name: defaultWorkoutName(), notes: '', templateId: null, start: Date.now(), rest: null, exercises: [] }),
  'open-active': () => { if (state.active) push({ type: 'active' }); },
  'min-active': () => { ui.stack = ui.stack.filter(o => o.type !== 'active'); render(); },
  'finish': () => finishWorkout(),
  'cancel-workout': async () => {
    const c = await actionSheet('Cancel this workout? Nothing will be saved.', [{ label: 'Cancel workout', value: 'ok', danger: true }]);
    if (c === 'ok') { state.active = null; save(); ui.stack = []; render(); }
  },

  // templates
  'tpl-new': () => push({ type: 'tplEdit', isNew: true, draft: { id: uid(), name: '', notes: '', created: Date.now(), exercises: [] } }),
  'tpl-open': (el, e) => { if (e.target.closest('[data-act="tpl-menu"]')) return; push({ type: 'tplPreview', id: el.dataset.id }); },
  'tpl-edit': el => {
    const t = state.templates.find(x => x.id === el.dataset.id);
    if (topOverlay() && topOverlay().type === 'tplPreview') ui.stack.pop();
    push({ type: 'tplEdit', isNew: false, draft: clone(t) });
  },
  'tpl-start': el => { const t = state.templates.find(x => x.id === el.dataset.id); ui.stack = []; beginWorkout(workoutFromTemplate(t)); },
  'tpl-save': () => {
    const o = topOverlay(), d = o.draft;
    if (!d.name.trim()) d.name = 'New Template';
    d.exercises.forEach(e => e.sets.forEach(s => { s.done = false; }));
    const idx = state.templates.findIndex(x => x.id === d.id);
    if (idx >= 0) state.templates[idx] = d; else state.templates.push(d);
    save(); pop(); toast('Template saved');
  },
  'tpl-menu': async (el, e) => {
    e.stopPropagation();
    const id = el.dataset.id, t = state.templates.find(x => x.id === id), i = state.templates.indexOf(t);
    const c = await actionSheet(t.name, [
      { label: 'Start workout', value: 'start' }, { label: 'Edit', value: 'edit' }, { label: 'Duplicate', value: 'dup' }, { label: 'Rename', value: 'rename' },
      ...(i > 0 ? [{ label: 'Move up', value: 'up' }] : []), ...(i < state.templates.length - 1 ? [{ label: 'Move down', value: 'down' }] : []),
      { label: 'Delete', value: 'del', danger: true }]);
    if (c === 'start') beginWorkout(workoutFromTemplate(t));
    if (c === 'edit') push({ type: 'tplEdit', isNew: false, draft: clone(t) });
    if (c === 'dup') { const d = clone(t); d.id = uid(); d.name = t.name + ' (copy)'; d.created = Date.now(); state.templates.splice(i + 1, 0, d); save(); render(); }
    if (c === 'rename') { const r = await formDialog('Rename template', [{ key: 'name', label: 'Name', value: t.name }]); if (r && r.name) { t.name = r.name; save(); render(); } }
    if (c === 'up' || c === 'down') { const j = c === 'up' ? i - 1 : i + 1; [state.templates[i], state.templates[j]] = [state.templates[j], state.templates[i]]; save(); render(); }
    if (c === 'del') { const ok = await actionSheet(`Delete "${t.name}"? Past workouts are kept.`, [{ label: 'Delete template', value: 'ok', danger: true }]); if (ok) { state.templates.splice(i, 1); save(); render(); } }
  },

  // editor
  'add-ex': el => push({ type: 'picker', mode: 'add', ctx: getCtx(el), selected: [], q: '', part: 'All' }),
  'picker-toggle': el => {
    const o = topOverlay(), id = el.dataset.id;
    if (o.mode === 'replace') o.selected = [id];
    else o.selected = o.selected.includes(id) ? o.selected.filter(x => x !== id) : [...o.selected, id];
    const btn = document.querySelector('[data-act="picker-done"]');
    el.classList.toggle('sel', o.selected.includes(id));
    if (o.mode === 'replace') document.querySelectorAll('#picker-list .ex-row.sel').forEach(r => { if (r !== el) r.classList.remove('sel'); });
    document.querySelectorAll('#picker-list .ex-row').forEach(r => { const s = r.querySelector('.sel-dot'); if (s) s.innerHTML = o.selected.includes(r.dataset.id) ? I.check : ''; });
    if (btn) { btn.disabled = !o.selected.length; btn.textContent = o.mode === 'replace' ? 'Replace' : `Add${o.selected.length ? ' (' + o.selected.length + ')' : ''}`; }
  },
  'picker-part': el => { topOverlay().part = el.dataset.part; render(); },
  'picker-done': () => {
    const o = ui.stack.pop(), w = ctxWorkout(o.ctx);
    if (!w) return render();
    if (o.mode === 'replace') {
      const we = findWE(w, o.weId); if (we) we.exerciseId = o.selected[0];
    } else {
      for (const id of o.selected) {
        // set count comes from Settings; set types (warm-up etc.) are copied from last time
        const prev = previousSets(id);
        const n = state.settings.sets || 3;
        w.exercises.push(newWorkoutExercise(id, Array.from({ length: n }, (_, k) => newSet('', '', prev[k] ? prev[k].type : 'n'))));
      }
    }
    persistCtx(o.ctx); render();
  },
  'add-set': el => {
    const ctx = getCtx(el), w = ctxWorkout(ctx), we = findWE(w, el.dataset.we);
    const last = we.sets[we.sets.length - 1];
    we.sets.push(newSet(last ? last.weight : '', last ? last.reps : '', 'n'));
    persistCtx(ctx); render();
  },
  'set-menu': async el => {
    const ctx = getCtx(el), w = ctxWorkout(ctx), we = findWE(w, el.dataset.we), s = we.sets.find(x => x.id === el.dataset.s);
    const idx = we.sets.indexOf(s);
    const types = [['n', 'Normal set'], ['w', 'Warm-up set (W)'], ['d', 'Drop set (D)'], ['f', 'Failure set (F)']];
    const c = await actionSheet(`Set ${idx + 1} · ${exLabel(exById(we.exerciseId))}`, [
      ...types.map(([v, l]) => ({ label: (s.type === v ? '✓  ' : '') + l, value: v })),
      { label: 'Duplicate set', value: 'dup' },
      { label: 'Delete set', value: 'del', danger: true }]);
    if (!c) return;
    if (c === 'del') return deleteSet(ctx, we.id, s.id);
    if (c === 'dup') we.sets.splice(idx + 1, 0, newSet(s.weight, s.reps, s.type));
    else s.type = c;
    persistCtx(ctx); render();
  },
  'set-del': el => deleteSet(getCtx(el), el.dataset.we, el.dataset.s),
  'fill-prev': el => {
    const ctx = getCtx(el), w = ctxWorkout(ctx), we = findWE(w, el.dataset.we);
    const si = we.sets.findIndex(x => x.id === el.dataset.s), s = we.sets[si];
    const p = previousSets(we.exerciseId, w.id)[si];
    if (!p) return;
    s.weight = String(p.weight ?? ''); s.reps = String(p.reps ?? '');
    persistCtx(ctx); render();
  },
  'set-done': el => {
    let prHit = null;
    const ctx = getCtx(el), w = ctxWorkout(ctx), we = findWE(w, el.dataset.we);
    const si = we.sets.findIndex(x => x.id === el.dataset.s), s = we.sets[si];
    if (!s.done) {
      const p = previousSets(we.exerciseId, w.id)[si];
      if (s.weight === '' && p && !noWeight(exById(we.exerciseId))) s.weight = String(p.weight);
      if (s.reps === '' && p) s.reps = String(p.reps);
      if (s.reps === '' || num(s.reps) <= 0) { toast('Enter the reps first'); return; }
      s.done = true;
      if (ctx === 'active') {
        startRest();
        const kinds = prFlags(w, we)[s.id];
        if (kinds) prHit = { ex: exById(we.exerciseId), kinds, setId: s.id, rect: el.getBoundingClientRect() };
      }
    } else s.done = false;
    persistCtx(ctx); render();
    if (prHit) celebratePR(prHit);
  },
  'ex-menu': async el => {
    const ctx = getCtx(el), w = ctxWorkout(ctx), we = findWE(w, el.dataset.we), i = w.exercises.indexOf(we);
    const c = await actionSheet(exLabel(exById(we.exerciseId)), [
      { label: we.note != null ? 'Remove note' : 'Add note', value: 'note' },
      { label: 'Replace exercise', value: 'replace' },
      ...(i > 0 ? [{ label: 'Move up', value: 'up' }] : []),
      ...(i < w.exercises.length - 1 ? [{ label: 'Move down', value: 'down' }] : []),
      { label: 'Remove exercise', value: 'remove', danger: true }]);
    if (!c) return;
    if (c === 'note') we.note = we.note != null ? undefined : '';
    if (c === 'replace') { push({ type: 'picker', mode: 'replace', ctx, weId: we.id, selected: [], q: '', part: 'All' }); return; }
    if (c === 'up' || c === 'down') { const j = c === 'up' ? i - 1 : i + 1; [w.exercises[i], w.exercises[j]] = [w.exercises[j], w.exercises[i]]; }
    if (c === 'remove') w.exercises.splice(i, 1);
    persistCtx(ctx); render();
  },

  // rest timer
  'rest-adj': el => {
    const r = state.active && state.active.rest; if (!r) return;
    const d = +el.dataset.d * 1000;
    r.end = Math.max(Date.now() + 1000, r.end + d);
    r.total = Math.max(r.total, Math.ceil((r.end - Date.now()) / 1000));
    save(); tick();
  },
  'rest-skip': () => { if (state.active) { state.active.rest = null; save(); render(); } },

  // finish screen
  'summary-done': async () => {
    const o = ui.stack.find(x => x.type === 'summary');
    if (o && o.tplUpdate) {
      const t = state.templates.find(x => x.id === o.tplUpdate.id);
      if (t) {
        const u = await actionSheet(`Update template "${t.name}" with this workout's exercises, sets and weights?`, [
          { label: 'Update template', value: 'yes' }, { label: 'Keep original template', value: 'no' }]);
        if (u === 'yes') { t.exercises = o.tplUpdate.exercises; save(); toast('Template updated'); }
      }
    }
    ui.stack = []; render();
  },
  'summary-view': () => { const o = ui.stack.find(x => x.type === 'summary'); push({ type: 'wkDetail', id: o.id }); },

  // history
  'wk-open': el => push({ type: 'wkDetail', id: el.dataset.id }),
  'wk-again': el => {
    const w = state.history.find(x => x.id === el.dataset.id);
    const t = { id: w.templateId, name: w.name, exercises: w.exercises };
    const nw = workoutFromTemplate(t); nw.templateId = state.templates.some(x => x.id === w.templateId) ? w.templateId : null;
    ui.stack = []; beginWorkout(nw);
  },
  'wk-menu': async el => {
    const w = state.history.find(x => x.id === el.dataset.id);
    const c = await actionSheet(w.name, [
      { label: 'Edit workout', value: 'edit' }, { label: 'Save as template', value: 'tpl' }, { label: 'Delete workout', value: 'del', danger: true }]);
    if (c === 'edit') push({ type: 'histEdit', draft: clone(w) });
    if (c === 'tpl') {
      const r = await formDialog('Save as template', [{ key: 'name', label: 'Template name', value: w.name }]);
      if (r) {
        state.templates.push({ id: uid(), name: r.name || w.name, notes: '', created: Date.now(),
          exercises: w.exercises.map(e => ({ id: uid(), exerciseId: e.exerciseId, sets: e.sets.map(s => newSet(s.weight, s.reps, s.type)) })) });
        save(); toast('Template created');
      }
    }
    if (c === 'del') {
      const ok = await actionSheet('Delete this workout permanently?', [{ label: 'Delete', value: 'ok', danger: true }]);
      if (ok) { state.history = state.history.filter(x => x !== w); save(); ui.stack = ui.stack.filter(o => !(o.type === 'wkDetail' && o.id === w.id)); render(); }
    }
  },
  'hist-save': () => {
    const d = topOverlay().draft;
    d.exercises = d.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.reps !== '' || s.weight !== '') })).filter(e => e.sets.length);
    d.exercises.forEach(e => e.sets.forEach(s => { delete s.done; }));
    const i = state.history.findIndex(x => x.id === d.id);
    if (i >= 0) state.history[i] = d;
    save(); pop(); toast('Workout updated');
  },

  // exercises
  'ex-part': el => { ui.exPart = el.dataset.part; render(); },
  'ex-open': el => push({ type: 'exDetail', id: el.dataset.id }),
  'ex-new': async el => {
    const r = await formDialog('New exercise', [
      { key: 'name', label: 'Name', placeholder: 'e.g. Landmine Press' },
      { key: 'category', label: 'Equipment', type: 'select', options: CATEGORIES, value: 'Barbell' },
      { key: 'bodyPart', label: 'Body part', type: 'select', options: BODY_PARTS, value: 'Chest' }], 'Create');
    if (!r || !r.name) return;
    const e = { id: 'c-' + uid(), name: r.name, category: r.category, bodyPart: r.bodyPart, custom: true };
    state.exercises.push(e); save();
    const o = topOverlay();
    if (el.dataset.fromPicker && o && o.type === 'picker') { o.q = ''; o.selected = o.mode === 'replace' ? [e.id] : [...o.selected, e.id]; }
    render(); toast('Exercise created');
  },
  'ex-del': async el => {
    const id = el.dataset.id, used = historyFor(id).length;
    const ok = await actionSheet(used ? `This exercise is in ${used} logged workout(s). Delete anyway? Those entries will show as "Unknown exercise".` : 'Delete this exercise?',
      [{ label: 'Delete exercise', value: 'ok', danger: true }]);
    if (!ok) return;
    state.exercises = state.exercises.filter(e => e.id !== id);
    state.templates.forEach(t => { t.exercises = t.exercises.filter(e => e.exerciseId !== id); });
    save(); pop();
  },

  // settings
  'set-unit': async () => { const c = await actionSheet('Weight unit', [{ label: 'Kilograms (kg)', value: 'kg' }, { label: 'Pounds (lb)', value: 'lb' }]); if (c) { state.settings.unit = c; save(); render(); } },
  'set-rest': async () => {
    const opts = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map(v => ({ label: v ? fmtDuration(v * 1000) : 'Off', value: String(v) }));
    const c = await actionSheet('Default rest timer', opts);
    if (c != null) { state.settings.rest = +c; save(); render(); }
  },
  'set-sets': async () => {
    const opts = [1, 2, 3, 4, 5, 6].map(v => ({ label: `${v} set${v > 1 ? 's' : ''}`, value: String(v) }));
    const c = await actionSheet('Sets added with each new exercise', opts);
    if (c != null) { state.settings.sets = +c; save(); render(); }
  },
  'toggle-sound': () => { state.settings.sound = !state.settings.sound; save(); render(); if (state.settings.sound) { unlockAudio(); beep(); } },
  'export': () => shareOrDownload(JSON.stringify(state), `ironlog-backup-${dateStamp()}.json`, 'application/json'),
  'export-csv': () => exportCSV(),
  'import': () => document.getElementById('import-file').click(),
  'reset': async () => {
    const c = await actionSheet('Erase ALL workouts, templates and custom exercises? This cannot be undone.', [{ label: 'Erase everything', value: 'ok', danger: true }]);
    if (c === 'ok') { state = freshState(); save(); ui.stack = []; render(); toast('All data erased'); }
  },
};

document.addEventListener('click', e => {
  if (e.target.closest('.sheet-back')) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  // clicks inside a modal card shouldn't trigger the backdrop's close
  if (el.dataset.act === 'close-self' && e.target.closest('[data-stop]')) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.search === 'ex') {
    ui.exSearch = t.value;
    document.getElementById('ex-list').innerHTML = renderExerciseList(ui.exSearch, ui.exPart, 'ex-open');
    return;
  }
  if (t.dataset.search === 'picker') {
    const o = topOverlay(); o.q = t.value;
    document.getElementById('picker-list').innerHTML = renderExerciseList(o.q, o.part, 'picker-toggle', o.selected);
    return;
  }
  if (!t.dataset.f) return;
  const ctx = getCtx(t), w = ctxWorkout(ctx);
  if (!w) return;
  const f = t.dataset.f;
  if (f === 'name') w.name = t.value;
  else if (f === 'notes') w.notes = t.value;
  else if (f === 'duration') w.end = w.start + Math.max(0, num(t.value)) * 60000;
  else if (f === 'exnote') { const we = findWE(w, t.dataset.we); if (we) we.note = t.value; }
  else if (f === 'set') {
    const we = findWE(w, t.dataset.we), s = we && we.sets.find(x => x.id === t.dataset.s);
    if (s) s[t.dataset.k] = t.value.replace(/[^0-9.,]/g, '');
  }
  if (t.tagName === 'TEXTAREA') autoGrow(t);
  persistCtx(ctx);
});
function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

// select the whole number when tapping an input, like native apps
document.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('in')) setTimeout(() => { try { e.target.select(); } catch (_) {} }, 0); });

// ---------------------------------------------------------------- boot
if (state.active) ui.stack = [{ type: 'active' }]; // resume an unfinished workout after the app was closed
render();

// opening screen: let the logo animation play, then fade into the app
(function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 500);
  }, reduce ? 300 : 1300);
})();

// Offline caching only on the real (https) install, so local edits show up on a plain refresh.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed', err)));
}
