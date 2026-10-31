'use strict';

/* ════════════════════════════════════════════════════════════════════
   cloud sync — Supabase auth + one JSON row per user
   ────────────────────────────────────────────────────────────────────
   localStorage stays the working copy (fast, offline). Every sync pulls
   the cloud row, merges it with the local state, and writes back only if
   something actually changed. Merging is per countdown: the newer
   `updatedAt` wins, and ids in `deleted` stay deleted everywhere.
   ════════════════════════════════════════════════════════════════════ */
(() => {
  const App = window.CountdownApp;
  const cfg = window.COUNTDOWN_CONFIG || {};
  const TABLE = 'countdown_state';
  const META_KEY = 'countdown.sync.meta';      // { userId, lastSync }

  const $ = s => document.querySelector(s);
  const btn = $('#btnCloud');
  const notice = $('#syncNotice');
  const sheet = $('#account');

  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

  let user = null;
  let status = sb ? 'signed-out' : 'off';     // off | signed-out | syncing | synced | offline | error
  let lastError = '';
  let busy = false, queued = false, pushTimer = null;
  let recovering = false;

  /* ── meta ───────────────────────────────────────────────────────── */
  const readMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } };
  const writeMeta = m => { try { localStorage.setItem(META_KEY, JSON.stringify(Object.assign(readMeta(), m))); } catch {} };

  /* ── merge ──────────────────────────────────────────────────────── */
  const content = c => { const { id, updatedAt, ...rest } = c; return JSON.stringify(rest); };
  const body = s => JSON.stringify({ c: s.countdowns, d: [...(s.deleted || [])].sort() });

  function merge(local, remote, { dedupe }) {
    const deleted = new Set([...(local.deleted || []), ...(remote.deleted || [])]);
    const byId = new Map();
    for (const c of remote.countdowns || []) byId.set(c.id, c);
    for (const c of local.countdowns || []) {
      const cur = byId.get(c.id);
      if (!cur) {
        // first time this device meets the account: don't duplicate identical countdowns
        if (dedupe && [...byId.values()].some(x => content(x) === content(c))) continue;
        byId.set(c.id, c);
      } else if ((c.updatedAt || 0) > (cur.updatedAt || 0)) {
        byId.set(c.id, c);
      }
    }
    let countdowns = [...byId.values()].filter(c => !deleted.has(c.id));
    if (!countdowns.length) countdowns = local.countdowns.length ? local.countdowns : remote.countdowns;
    return {
      countdowns,
      deleted: [...deleted],
      activeId: local.activeId,
      savedAt: Math.max(local.savedAt || 0, remote.savedAt || 0),
    };
  }

  /* ── the sync itself ────────────────────────────────────────────── */
  async function fetchRemote() {
    const { data, error } = await sb.from(TABLE).select('data').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    const d = data && data.data;
    return d && Array.isArray(d.countdowns) && d.countdowns.length ? d : null;
  }

  async function sync() {
    if (!sb || !user || recovering) return;
    if (busy) { queued = true; return; }
    busy = true;
    clearTimeout(pushTimer);
    setStatus('syncing');
    try {
      const local = App.snapshot();
      const remote = await fetchRemote();
      const meta = readMeta();
      let merged;
      if (!remote) merged = local;                            // brand-new account: upload
      else if (!local.savedAt) merged = { ...remote, activeId: local.activeId };   // untouched device: download
      else merged = merge(local, remote, { dedupe: meta.userId !== user.id });

      if (body(merged) !== body(local)) App.apply(merged);
      if (!remote || body(merged) !== body(remote)) {
        const payload = { countdowns: merged.countdowns, deleted: merged.deleted, savedAt: Date.now() };
        const { error } = await sb.from(TABLE).upsert(
          { user_id: user.id, data: payload, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );
        if (error) throw error;
      }
      writeMeta({ userId: user.id, lastSync: Date.now() });
      lastError = '';
      setStatus('synced');
    } catch (err) {
      console.warn('[sync]', err);
      lastError = (err && err.message) || String(err);
      setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      busy = false;
      if (queued) { queued = false; sync(); }
    }
  }

  /* ── status UI ──────────────────────────────────────────────────── */
  const ago = t => {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(t).toLocaleString();
  };
  const LABEL = {
    off: 'Cloud sync not set up — saved on this device only',
    'signed-out': 'Not signed in — saved on this device only',
    syncing: 'Syncing…',
    synced: 'Synced',
    offline: 'Offline — changes are saved here and will sync when you’re back',
    error: 'Sync failed',
  };

  function setStatus(s) {
    status = s;
    btn.dataset.state = s;
    btn.title = LABEL[s] || 'Account & sync';
    notice.hidden = !(s === 'signed-out' || s === 'off');
    if (!sheet.hidden) paintSheet();
  }

  function paintSheet() {
    const show = id => { for (const x of ['#acOff', '#acAuth', '#acRecover', '#acIn']) $(x).hidden = x !== id; };
    if (!sb) show('#acOff');
    else if (recovering) show('#acRecover');
    else if (!user) show('#acAuth');
    else {
      show('#acIn');
      $('#acWho').textContent = user.email || 'Signed in';
      let line = LABEL[status] || '';
      if (status === 'synced') line = `Synced ${ago(readMeta().lastSync)}`;
      if (status === 'error' && lastError) line += ` — ${lastError}`;
      $('#acStatus').textContent = line;
    }
  }

  function msg(text, kind) {
    const m = $('#acMsg');
    m.hidden = !text;
    m.textContent = text || '';
    m.dataset.kind = kind || '';
  }

  function open() { msg(''); paintSheet(); sheet.hidden = false; }
  function close() { sheet.hidden = true; }

  /* ── auth handlers ──────────────────────────────────────────────── */
  const creds = () => ({ email: $('#acEmail').value.trim(), password: $('#acPassword').value });
  const redirect = () => location.origin + location.pathname;

  async function withBusy(button, fn) {
    button.disabled = true;
    try { await fn(); } catch (err) { msg((err && err.message) || String(err), 'err'); }
    finally { button.disabled = false; }
  }

  $('#acAuth').addEventListener('submit', e => {
    e.preventDefault();
    withBusy($('#btnSignIn'), async () => {
      msg('');
      const { error } = await sb.auth.signInWithPassword(creds());
      if (error) throw error;
      close();
    });
  });

  $('#btnSignUp').addEventListener('click', () => withBusy($('#btnSignUp'), async () => {
    const c = creds();
    if (!c.email || c.password.length < 6) throw new Error('Enter an email and a password of at least 6 characters.');
    const { data, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: redirect() } });
    if (error) throw error;
    if (data.session) close();
    else msg('Account created. Check your email for the confirmation link, then sign in here.', 'ok');
  }));

  $('#btnForgot').addEventListener('click', () => withBusy($('#btnForgot'), async () => {
    const email = $('#acEmail').value.trim();
    if (!email) throw new Error('Type your email above first.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
    if (error) throw error;
    msg('Password reset email sent. Open the link on this device.', 'ok');
  }));

  $('#acRecover').addEventListener('submit', e => {
    e.preventDefault();
    withBusy($('#acRecover button'), async () => {
      const { error } = await sb.auth.updateUser({ password: $('#acNewPassword').value });
      if (error) throw error;
      recovering = false;
      msg('Password updated.', 'ok');
      paintSheet();
      sync();
    });
  });

  $('#btnSyncNow').addEventListener('click', () => sync());
  $('#btnSignOut').addEventListener('click', () => withBusy($('#btnSignOut'), async () => {
    await sb.auth.signOut();
    writeMeta({ userId: null });     // local copy stays; next sign-in merges without duplicates
    close();
  }));

  btn.addEventListener('click', open);
  $('#btnNoticeSignIn').addEventListener('click', open);
  $('#btnAccountClose').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  /* ── wiring ─────────────────────────────────────────────────────── */
  window.CloudSync = {
    open,
    changed() {
      if (!user) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(sync, 700);
    },
  };

  setStatus(status);
  if (!sb) {
    if (configured) { lastError = 'Supabase library failed to load'; }
    return;
  }

  sb.auth.onAuthStateChange((event, session) => {
    const prev = user && user.id;
    user = session ? session.user : null;
    if (event === 'PASSWORD_RECOVERY') { recovering = true; open(); }
    if (!user) { setStatus('signed-out'); return; }
    if (user.id !== prev) setTimeout(sync, 0);        // never await supabase calls inside this callback
    else setStatus(status === 'signed-out' ? 'synced' : status);
  });

  // pull changes made on other devices
  const pull = () => { if (user && !document.hidden) sync(); };
  document.addEventListener('visibilitychange', pull);
  window.addEventListener('focus', pull);
  window.addEventListener('online', pull);
  window.addEventListener('offline', () => user && setStatus('offline'));
  setInterval(pull, 60e3);
  setInterval(() => { if (!sheet.hidden) paintSheet(); }, 15e3);
})();
