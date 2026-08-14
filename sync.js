/* FitTrack — cloud sync layer.
 *
 * Exposes `window.FTSync`. The app stays local-first: every write lands in
 * localStorage immediately and the UI never blocks on the network. Cloud
 * pushes are debounced, and remote changes arrive over Supabase realtime.
 *
 * Two environments — 'live' and 'dev' — share one Supabase project but write
 * to separate rows (the `env` column), so poking at dev can never corrupt
 * live data.
 */
(function () {
  'use strict';

  var KEYS = ['ft_profile', 'ft_days', 'ft_library', 'ft_weight_logs', 'ft_sleep_logs'];
  var PUSH_DEBOUNCE_MS = 900;

  // ── ENVIRONMENT ────────────────────────────────────────────────────────────
  // Precedence: ?env= query param (Electron passes this) > /dev/ in the path.
  function detectEnv() {
    try {
      var q = new URLSearchParams(location.search).get('env');
      if (q === 'dev' || q === 'live') return q;
    } catch (e) {}
    return /(^|\/)dev\/?$|\/dev\//.test(location.pathname) ? 'dev' : 'live';
  }

  var ENV = detectEnv();

  /* Where to navigate to reach the other environment.
   *
   * On a web deploy the two builds live at different paths (/ and /dev/). In
   * Electron's bundled mode there is only one file:// document, so the switch
   * is a query parameter on the same page instead. */
  function urlForEnv(env) {
    if (location.protocol === 'file:') {
      return location.pathname + (env === 'dev' ? '?env=dev' : '?env=live');
    }
    // Drop any filename first, then the /dev/ segment, so this works whether
    // the URL is ".../FitTrack/dev/" or ".../FitTrack/dev/index.html".
    var dir = location.pathname.replace(/[^/]*$/, '');
    var root = dir.replace(/dev\/$/, '');
    return env === 'dev' ? root + 'dev/' : root;
  }

  // Each environment keeps its own localStorage namespace, so the dev build's
  // offline cache never overwrites what the live build has cached.
  function nsKey(key) { return ENV === 'dev' ? 'dev__' + key : key; }

  // ── MERGE STRATEGY ─────────────────────────────────────────────────────────
  // Whole-blob last-write-wins loses data when two devices are edited between
  // syncs. These merges are structural instead, so concurrent edits on
  // different days (or different foods) both survive. Only a genuine conflict
  // — the same day edited on both devices — falls back to newest-wins.

  function mergeById(local, remote) {
    var out = [], seen = Object.create(null);
    (remote || []).concat(local || []).forEach(function (item) {
      if (!item) return;
      var id = String(item.id != null ? item.id : JSON.stringify(item));
      if (seen[id]) return;
      seen[id] = true;
      out.push(item);
    });
    return out;
  }

  function mergeDays(local, remote, localNewer) {
    var out = {}, d;
    for (d in (remote || {})) out[d] = remote[d];
    for (d in (local || {})) {
      // A date present on only one side is always kept. A date present on both
      // is a real conflict — take whichever side was written more recently.
      if (!(d in out) || localNewer) out[d] = local[d];
    }
    return out;
  }

  function merge(key, local, remote, localNewer) {
    if (local == null) return remote;
    if (remote == null) return local;
    if (key === 'ft_days') return mergeDays(local, remote, localNewer);
    if (key === 'ft_library' || key === 'ft_weight_logs' || key === 'ft_sleep_logs') {
      return mergeById(local, remote);
    }
    return localNewer ? local : remote; // ft_profile — a small scalar blob
  }

  // ── STATE ──────────────────────────────────────────────────────────────────
  var client = null;
  var session = null;
  var channel = null;
  var ready = false;
  var configured = false;
  var hydrated = false;                 // has the initial pull reconciled with the server yet?
  var lastSeen = Object.create(null);   // key -> JSON of the value we believe the server holds
  var pending = Object.create(null);    // key -> value awaiting a debounced push
  var timers = Object.create(null);
  var status = 'offline';               // offline | signed-out | syncing | synced | error
  var statusDetail = '';
  var listeners = [];
  var remoteHandlers = [];

  function setStatus(s, detail) {
    status = s;
    statusDetail = detail || '';
    listeners.forEach(function (fn) { try { fn(api.state()); } catch (e) {} });
  }

  // ── LOCAL STORAGE (namespaced by env) ──────────────────────────────────────
  function localLoad(key, fallback) {
    try {
      var v = localStorage.getItem(nsKey(key));
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }

  function localSave(key, value) {
    try { localStorage.setItem(nsKey(key), JSON.stringify(value)); } catch (e) {}
  }

  function localStamp(key, ts) {
    try { localStorage.setItem(nsKey(key) + '__ts', String(ts || Date.now())); } catch (e) {}
  }

  function localStampOf(key) {
    try { return Number(localStorage.getItem(nsKey(key) + '__ts')) || 0; } catch (e) { return 0; }
  }

  // On first run in dev, seed from whatever live has cached locally so the dev
  // build opens with realistic data instead of an empty onboarding screen.
  function seedDevFromLive() {
    if (ENV !== 'dev') return;
    try {
      if (localStorage.getItem('dev__seeded')) return;
      KEYS.forEach(function (k) {
        var v = localStorage.getItem(k);
        if (v != null) localStorage.setItem('dev__' + k, v);
      });
      localStorage.setItem('dev__seeded', '1');
    } catch (e) {}
  }

  // ── INIT ───────────────────────────────────────────────────────────────────
  function init() {
    seedDevFromLive();

    var cfg = window.FT_CONFIG || {};
    configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

    if (!configured || !window.supabase) {
      ready = true;
      setStatus('offline', configured ? 'Sync library failed to load' : 'Cloud sync not configured');
      return;
    }

    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ft_auth_' + ENV },
    });

    client.auth.getSession().then(function (res) {
      applySession(res && res.data ? res.data.session : null);
      ready = true;
    }).catch(function () {
      ready = true;
      setStatus('error', 'Could not reach the sync server');
    });

    client.auth.onAuthStateChange(function (_evt, s) { applySession(s); });
  }

  function applySession(s) {
    var changed = (s && s.user ? s.user.id : null) !== (session && session.user ? session.user.id : null);
    session = s || null;
    if (!session) {
      teardownRealtime();
      hydrated = false;
      setStatus('signed-out');
      return;
    }
    if (changed) {
      setStatus('syncing');
      pullAll().then(setupRealtime);
    } else {
      listeners.forEach(function (fn) { try { fn(api.state()); } catch (e) {} });
    }
  }

  // ── PULL ───────────────────────────────────────────────────────────────────
  // Reconciles the server against local on sign-in, then hands merged values to
  // the app and writes anything local-only back up.
  function pullAll() {
    if (!client || !session) return Promise.resolve();
    setStatus('syncing');

    return client
      .from('fittrack_state')
      .select('key,value,updated_at')
      .eq('user_id', session.user.id)
      .eq('env', ENV)
      .then(function (res) {
        if (res.error) { pullFailed(res.error.message); return; }

        var remoteByKey = Object.create(null);
        (res.data || []).forEach(function (r) { remoteByKey[r.key] = r; });

        var toPush = [];

        KEYS.forEach(function (key) {
          var row = remoteByKey[key];
          // Anything the app queued while we were still hydrating is newer than
          // what localLoad would return, so prefer it.
          var local = (key in pending) ? pending[key] : localLoad(key, null);
          var remote = row ? row.value : null;
          var remoteTs = row ? new Date(row.updated_at).getTime() : 0;
          var localNewer = localStampOf(key) > remoteTs;

          var merged = merge(key, local, remote, localNewer);
          if (merged == null) return;

          var mergedJson = JSON.stringify(merged);
          localSave(key, merged);
          lastSeen[key] = JSON.stringify(remote);
          delete pending[key];

          emitRemote(key, merged);

          // Local contributed something the server does not have yet.
          if (mergedJson !== JSON.stringify(remote)) toPush.push([key, merged]);
        });

        // Only now is it safe to write: every key has been reconciled against
        // the server, so no push can clobber another device's work.
        hydrated = true;
        toPush.forEach(function (p) { queuePush(p[0], p[1], true); });

        if (status === 'syncing' && !toPush.length) setStatus('synced');
      })
      .catch(function (e) { pullFailed(String(e && e.message || e)); });
  }

  /* A failed pull leaves us not knowing the server's state, so pushing would
   * risk clobbering another device. Stay unhydrated — writes keep landing in
   * localStorage — and retry with a backoff so a flaky connection recovers on
   * its own rather than silently staying local forever. */
  var pullRetry = null;
  var pullBackoff = 4000;

  function pullFailed(message) {
    hydrated = false;
    setStatus('error', message);
    if (pullRetry) clearTimeout(pullRetry);
    pullRetry = setTimeout(function () {
      pullBackoff = Math.min(pullBackoff * 2, 60000);
      pullAll().then(function () { if (hydrated) pullBackoff = 4000; });
    }, pullBackoff);
  }

  // ── PUSH ───────────────────────────────────────────────────────────────────
  function queuePush(key, value, immediate) {
    if (!client || !session) return;
    if (JSON.stringify(value) === lastSeen[key]) return; // nothing actually changed

    pending[key] = value;
    if (timers[key]) clearTimeout(timers[key]);

    // Until the first pull has reconciled local against the server, a push
    // would be built from local-only data and could overwrite whatever another
    // device wrote while this one was closed. Hold it; pullAll flushes.
    if (!hydrated) return;

    if (immediate) { flush(key); return; }
    timers[key] = setTimeout(function () { flush(key); }, PUSH_DEBOUNCE_MS);
  }

  function flush(key) {
    if (!client || !session || !(key in pending)) return;
    var value = pending[key];
    delete pending[key];
    timers[key] = null;

    var json = JSON.stringify(value);
    setStatus('syncing');

    client
      .from('fittrack_state')
      .upsert({
        user_id: session.user.id,
        env: ENV,
        key: key,
        value: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,env,key' })
      .then(function (res) {
        if (res.error) { setStatus('error', res.error.message); return; }
        lastSeen[key] = json;
        if (!Object.keys(pending).length) setStatus('synced');
      })
      .catch(function (e) { setStatus('error', String(e && e.message || e)); });
  }

  function flushAll() { Object.keys(pending).forEach(flush); }

  // ── REALTIME ───────────────────────────────────────────────────────────────
  function setupRealtime() {
    if (!client || !session) return;
    teardownRealtime();

    channel = client
      .channel('fittrack_state_' + ENV)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'fittrack_state',
        filter: 'user_id=eq.' + session.user.id,
      }, function (payload) {
        var row = payload.new;
        if (!row || row.env !== ENV || KEYS.indexOf(row.key) === -1) return;

        var json = JSON.stringify(row.value);
        if (json === lastSeen[row.key]) return; // our own write echoing back

        lastSeen[row.key] = json;
        localSave(row.key, row.value);
        localStamp(row.key, new Date(row.updated_at).getTime());
        emitRemote(row.key, row.value);
        setStatus('synced');
      })
      .subscribe(function (state) {
        // A socket that drops stays dropped unless we ask again. Reconnecting
        // matters more than usual here because the poll below is deliberately
        // slow, so realtime is what makes another device feel instant.
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          if (realtimeRetry) clearTimeout(realtimeRetry);
          realtimeRetry = setTimeout(setupRealtime, 5000);
        }
      });
  }
  var realtimeRetry = null;

  // ── STAYING FRESH ──────────────────────────────────────────────────────────
  /* Realtime is the fast path, not the only path.
   *
   * A window left open for hours would otherwise never learn about anything
   * until it was reloaded — which is why a phone, reopened fresh each time,
   * appeared to sync while a desktop window sitting open all day did not. It is
   * also the difference between working and not working at all when the table
   * is missing from the realtime publication, or a laptop wakes to a dead
   * socket. So pull again whenever this window is about to be looked at, and on
   * a slow timer underneath that as a floor. */
  var POLL_MS = 60000;
  var lastPull = 0;

  function refresh(force) {
    if (!client || !session) return;
    var now = Date.now();
    if (!force && now - lastPull < 5000) return; // focus events arrive in bursts
    lastPull = now;
    pullAll();
  }

  function teardownRealtime() {
    if (channel && client) { try { client.removeChannel(channel); } catch (e) {} }
    channel = null;
  }

  // A pull can finish before React has mounted and registered its handler.
  // Buffer the latest value per key and replay it on registration so a fast
  // network never races the app into showing stale local data.
  var lastEmitted = Object.create(null);

  function emitRemote(key, value) {
    lastEmitted[key] = value;
    remoteHandlers.forEach(function (fn) { try { fn(key, value); } catch (e) {} });
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────────
  var api = {
    KEYS: KEYS,
    env: ENV,
    isDev: ENV === 'dev',
    urlForEnv: urlForEnv,

    init: init,

    /* Flush pending writes, then navigate to the other environment. */
    switchEnv: function (env) {
      flushAll();
      var url = urlForEnv(env);
      setTimeout(function () { location.href = url; }, 120);
    },

    load: function (key, fallback) { return localLoad(key, fallback); },

    /* The app's single write path: cache locally, stamp it, queue a push. */
    save: function (key, value) {
      localSave(key, value);
      localStamp(key, Date.now());
      queuePush(key, value);
    },

    /* Called when a remote change should be pushed into React state. */
    onRemote: function (fn) {
      remoteHandlers.push(fn);
      Object.keys(lastEmitted).forEach(function (k) { try { fn(k, lastEmitted[k]); } catch (e) {} });
      return function () { remoteHandlers = remoteHandlers.filter(function (f) { return f !== fn; }); };
    },

    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },

    state: function () {
      return {
        env: ENV,
        configured: configured,
        ready: ready,
        status: status,
        detail: statusDetail,
        email: session && session.user ? session.user.email : null,
        signedIn: !!session,
      };
    },

    signIn: function (email, password) {
      if (!client) return Promise.reject(new Error('Cloud sync is not configured'));
      return client.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },

    signUp: function (email, password) {
      if (!client) return Promise.reject(new Error('Cloud sync is not configured'));
      return client.auth.signUp({ email: email, password: password }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },

    signOut: function () {
      if (!client) return Promise.resolve();
      return client.auth.signOut();
    },

    /* Replace dev's cloud rows with a snapshot of live, for testing against
     * real data. Never runs in the other direction. */
    copyLiveToDev: function () {
      if (!client || !session) return Promise.reject(new Error('Sign in first'));
      if (ENV !== 'dev') return Promise.reject(new Error('Only available in the dev environment'));

      return client
        .from('fittrack_state')
        .select('key,value')
        .eq('user_id', session.user.id)
        .eq('env', 'live')
        .then(function (res) {
          if (res.error) throw res.error;
          var rows = (res.data || []).map(function (r) {
            return {
              user_id: session.user.id, env: 'dev', key: r.key,
              value: r.value, updated_at: new Date().toISOString(),
            };
          });
          if (!rows.length) throw new Error('No live data found to copy');
          return client.from('fittrack_state').upsert(rows, { onConflict: 'user_id,env,key' });
        })
        .then(function (res) {
          if (res && res.error) throw res.error;
          // Drop our cached view of the server so the pull re-reads everything
          // and pushes the copied rows into the running UI.
          // Drop the local dev cache entirely so this is a true replace rather
          // than a union — otherwise stale dev-only days would survive the copy.
          KEYS.forEach(function (k) {
            delete lastSeen[k];
            localStamp(k, 0);
            try { localStorage.removeItem(nsKey(k)); } catch (e) {}
          });
          return pullAll();
        });
    },

    flush: flushAll,
  };

  window.FTSync = api;

  // Don't lose the last few seconds of edits when the window closes.
  window.addEventListener('beforeunload', flushAll);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushAll();
    else refresh();
  });

  /* Focus, not just visibility: a desktop window sitting behind another one is
   * still `visible`, so visibilitychange never fires when you click back into
   * it. Focus is the signal that someone is about to read the screen. */
  window.addEventListener('focus', function () { refresh(); });

  // Coming back online is the other moment we are likely to be stale.
  window.addEventListener('online', function () { refresh(true); setupRealtime(); });

  setInterval(function () {
    if (document.visibilityState !== 'hidden') refresh();
  }, POLL_MS);
})();
