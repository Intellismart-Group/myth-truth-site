/*
 * Visit counter for the owner's Site Stats page (proctorpilot.com, the
 * owner's own server; spec changelog 1.18). One small message per page opened: the page,
 * the site that sent you, whether this browser has been here before and
 * whether it's its first page today. The server adds phone or computer and
 * the approximate city from the request, then keeps daily totals only: no
 * internet address, no player ID. Described on privacy.html.
 *
 * Leave me out: the Site Stats page links here with #leave-me-out=CODE. That
 * browser then sends no visits, and its guest ID goes on the game's
 * left-out list (site_stats_leave_me_out, migration
 * 20261127120000_site_stats_leave_me_out.sql), so the player counts skip it
 * too. Only the owner has the code.
 *
 * The link only reaches the browser it opens in, and a home-screen icon keeps
 * its own storage, so a returning guest's visit is counted only after the
 * left-out list says that guest isn't the owner's (site_stats_is_left_out,
 * migration 20261127200000_site_stats_is_left_out.sql, asked once a day;
 * spec changelog 1.19). After a yes, nothing more is sent.
 *
 * Each page's head notes its first address and whether this browser already
 * had a guest (window.__siteVisit) before the game code changes either
 * (tools/web/build-site.mjs adds both).
 */
(function () {
  'use strict';
  if (window.__siteVisitSkip) return; // 404.html sending an unknown address to the home page, which counts instead
  var SITE = 'mythtruth';
  var ENDPOINT = 'https://proctorpilot.com/api/visit.php';
  var LEAVE_OUT_RPC = 'https://rcrhmyqyroejnajwuyxe.supabase.co/rest/v1/rpc/site_stats_leave_me_out';
  var CHECK_RPC = 'https://rcrhmyqyroejnajwuyxe.supabase.co/rest/v1/rpc/site_stats_is_left_out';
  var API_KEY = 'sb_publishable_hfDvGlOJphjAJl1L8RQVjA_0bl6aabW';

  // This browser's guest ID, once the game has made one (after the 18+ check).
  function playerId() {
    var id = null;
    try { id = JSON.parse(localStorage.getItem('sb-rcrhmyqyroejnajwuyxe-auth-token')).user.id; } catch (e) {}
    return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? id : null;
  }
  // A friend challenge link: .../play/challenge/CODE.
  function sharedLink(url) { return url.pathname.indexOf('/play/challenge/') >= 0; }

  var OUT_KEY = 'site-stats-leave-out';   // the code, on the owner's own browsers only
  var DONE_KEY = 'site-stats-left-out';   // player IDs already on the left-out list
  var SEEN_KEY = 'site-stats-visit';      // local dates of this browser's first and last visit
  var LISTED_KEY = 'site-stats-listed';   // "1" once the left-out list said this guest is the owner's
  var CHECKED_KEY = 'site-stats-checked'; // local date the left-out list last said no

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getJson(k) { try { return JSON.parse(get(k)); } catch (e) { return null; } }
  function localDate() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function notice(text) {
    function show() {
      var el = document.createElement('div');
      el.setAttribute('role', 'status');
      el.textContent = text;
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#1F1D1A;color:#fff;font:600 15px/1.4 system-ui,sans-serif;padding:12px 18px;border-radius:10px;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.25);max-width:calc(100% - 32px);text-align:center';
      document.body.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 7000);
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  var busy = false;
  function leaveOut(code) {
    var id = playerId();
    var done = getJson(DONE_KEY);
    if (!Array.isArray(done)) done = [];
    if (!id || busy || done.indexOf(id) >= 0) return;
    busy = true;
    fetch(LEAVE_OUT_RPC, {
      method: 'POST',
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code, p_player: id })
    }).then(function (r) {
      if (r.ok) { done.push(id); set(DONE_KEY, JSON.stringify(done.slice(-20))); }
    }, function () {}).then(function () { busy = false; });
  }

  var entry = window.__siteVisit || { url: location.href, ref: document.referrer, seen: false };

  // 1. The owner's leave-me-out link.
  var m = /(?:^#|&)leave-me-out=([A-Za-z0-9_-]{16,80})/.exec(location.hash);
  if (m) {
    set(OUT_KEY, m[1]);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    notice('Done: this browser is left out of your Site Stats.');
  }
  var code = get(OUT_KEY);
  if (code) {
    leaveOut(code);
    setTimeout(function () { leaveOut(code); }, 20000);
    return; // nothing is counted from the owner's browsers
  }
  if (get(LISTED_KEY)) return; // the owner's guest, left out on the list (e.g. a home-screen icon)

  // 2. Count this page.
  var url = null;
  try { url = new URL(entry.url); } catch (e) {}
  var seen = getJson(SEEN_KEY);
  var today = localDate();
  var body = JSON.stringify({
    site: SITE,
    path: url ? url.pathname : location.pathname,
    ref: entry.ref || '',
    utm: url ? (url.searchParams.get('utm_source') || '') : '',
    shared: url ? sharedLink(url) : false,
    first_today: !seen || seen.last !== today,
    new: !seen && !entry.seen
  });
  set(SEEN_KEY, JSON.stringify({ first: (seen && seen.first) || today, last: today }));
  function send() {
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; // a string goes as text/plain: no preflight
    } catch (e) {}
    try {
      fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body: body })
        .catch(function () {});
    } catch (e) {}
  }

  // A brand-new browser can't be on the left-out list; a returning guest is checked once a day (spec 1.19).
  var id = entry.seen ? playerId() : null;
  if (!id || get(CHECKED_KEY) === today) { send(); return; }
  var decided = false;
  function decide(count) { if (!decided) { decided = true; if (count) send(); } }
  setTimeout(function () { decide(true); }, 4000); // a slow or missing answer never loses a visit
  try {
    fetch(CHECK_RPC, {
      method: 'POST',
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_player: id })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (listed) {
      if (listed === true) set(LISTED_KEY, '1');
      else if (listed === false) set(CHECKED_KEY, today);
      decide(listed !== true);
    }, function () { decide(true); });
  } catch (e) { decide(true); }
})();
