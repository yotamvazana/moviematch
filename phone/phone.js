/* Movie Match - phone page. */
(function () {
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var mem = {};
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || mem[k]; localStorage.setItem(k, v); } catch (e) { if (v === undefined) return mem[k]; mem[k] = v; } }

  var hostId = (location.hash || '').replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '');
  var pid = store('mm_pid') || ('u' + Math.random().toString(36).slice(2, 10)); store('mm_pid', pid);
  var name = store('mm_name') || '';
  var conn = null, state = 'join', deck = [], idx = 0, color = '#52d6ff', slot = 0, matches = [], retryTimer = null, busy = false;

  /* ---------- background ---------- */
  var flip = false;
  function setBg(url) {
    if (!url) return;
    var on = flip ? $('bgA') : $('bgB'), off = flip ? $('bgB') : $('bgA');
    on.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")'; on.className = 'bgimg on'; off.className = 'bgimg'; flip = !flip;
  }

  /* ---------- message card ---------- */
  function message(title, text, opts) {
    opts = opts || {};
    var m = $('msg'); m.className = 'msg glass on';
    $('msgTitle').innerHTML = (opts.avatar ? '<div class="av">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>' : '') + esc(title);
    $('msgText').textContent = text || '';
    $('msgBtn').className = opts.retry ? 'btn on' : 'btn';
    $('stack').style.visibility = 'hidden';
  }
  function hideMessage() { $('msg').className = 'msg glass'; $('stack').style.visibility = 'visible'; }

  /* ---------- connection ---------- */
  function connect() {
    clearTimeout(retryTimer);
    if (!hostId) { message('No TV code', 'Open this page by scanning the QR code on the TV.'); return; }
    message('Joining…', 'Connecting to the TV.', {});
    window.Link.join(hostId, {
      onopen: function (c) {
        conn = c;
        c.onmessage = onMessage;
        c.onclose = function () { conn = null; if (state !== 'join') { message('Reconnecting…', 'Lost the TV. Trying again.'); } scheduleRetry(); };
        c.send({ t: 'hello', pid: pid, name: name });
      },
      onerror: function () {
        conn = null;
        message('Can’t reach the TV', 'Make sure the TV is on the Movie Match screen and that you have internet.', { retry: true });
        scheduleRetry(6000);
      }
    });
  }
  function scheduleRetry(ms) { clearTimeout(retryTimer); retryTimer = setTimeout(function () { if (!conn) connect(); }, ms || 2500); }
  $('msgBtn').onclick = connect;

  function onMessage(m) {
    if (!m || !m.t) return;
    if (m.t === 'welcome') {
      slot = m.slot; color = m.color; document.documentElement.style.setProperty('--c', color);
      $('meDot').style.background = color; $('meName').textContent = m.name || name; name = m.name || name;
      matches = []; (m.matches || []).forEach(function () {});
      if (m.mode === 'play' && m.deck) { deck = m.deck; idx = Math.max(idx, m.idx || 0); enterPlay(); }
      else { state = 'lobby'; deck = []; idx = 0; message('You’re in', 'Waiting for the TV to start the round.', { avatar: true }); }
    } else if (m.t === 'start') { deck = m.deck; idx = 0; matches = []; renderMatches(); enterPlay(); }
    else if (m.t === 'lobby') { state = 'lobby'; deck = []; idx = 0; message('Round over', 'Waiting for the TV to start a new one.', { avatar: true }); }
    else if (m.t === 'match') { addMatch(m.movie); }
    else if (m.t === 'full') { message('This round is full', 'The TV already has four players.'); }
  }

  /* ---------- play ---------- */
  var cards = [];
  function enterPlay() {
    state = 'play'; hideMessage(); $('stack').innerHTML = ''; cards = [];
    refill(); layout(); updateCount();
  }
  function makeCard(i) {
    var m = deck[i], c = el('div', 'pc');
    var img = el('img'); img.src = m.poster; img.alt = ''; img.draggable = false; c.appendChild(img);
    c.appendChild(el('div', 'ov', '<b style="font-size:20px;margin-bottom:8px">' + esc(m.title) + '</b>' + esc(m.overview || 'No description.')));
    c.appendChild(el('div', 'meta', '<div class="ttl">' + esc(m.title) + '</div><div class="sub">' + esc([m.year, m.rating ? m.rating.toFixed(1) + ' rating' : ''].filter(Boolean).join('  ·  ')) + '</div>'));
    c.appendChild(el('div', 'stamp l', 'LIKE')); c.appendChild(el('div', 'stamp n', 'NOPE'));
    c._i = i;
    return c;
  }
  function refill() {
    while (cards.length < 3 && (cards.length ? cards[cards.length - 1]._i + 1 : idx) < deck.length) {
      var i = cards.length ? cards[cards.length - 1]._i + 1 : idx;
      var c = makeCard(i); cards.push(c); $('stack').insertBefore(c, $('stack').firstChild);
    }
    if (!cards.length && deck.length) { message('That’s the whole deck', 'Matches will show up on the TV. Ask for a new round when you’re ready.', { avatar: true }); state = 'done'; }
    if (cards[0]) setBg(deck[cards[0]._i].poster);
  }
  function depthT(d) { return d === 0 ? 'translate3d(0,0,0)' : 'translate3d(0,' + (d * 14) + 'px,0) scale(' + (1 - d * 0.05) + ')'; }
  function layout() { cards.forEach(function (c, d) { if (!c._drag) { c.style.transform = depthT(d); c.style.opacity = d === 2 ? '.7' : '1'; } }); attach(); }
  function updateCount() { $('count').textContent = deck.length ? Math.min(idx + 1, deck.length) + ' / ' + deck.length : ''; }

  function decide(like) {
    if (state !== 'play' || !cards.length || busy) return;
    var c = cards[0]; busy = true;
    var i = c._i;
    fly(c, like ? 1 : -1, 0);
    if (conn) conn.send({ t: 'swipe', i: i, like: like });
    if (like && navigator.vibrate) { try { navigator.vibrate(14); } catch (e) {} }
    idx = i + 1;
    cards.shift();
    refill(); layout(); updateCount();
    setTimeout(function () { busy = false; }, 120);
  }
  function fly(c, dir, dy) {
    c._drag = true; c.className = 'pc fly';
    c.style.transform = 'translate3d(' + (dir * window.innerWidth * 1.1) + 'px,' + (dy - 40) + 'px,0) rotate(' + (dir * 22) + 'deg)'; c.style.opacity = '0';
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 500);
  }
  $('like').onclick = function () { var c = cards[0]; if (c) { stampOn(c, 1); } decide(true); };
  $('nope').onclick = function () { var c = cards[0]; if (c) { stampOn(c, -1); } decide(false); };
  function stampOn(c, d) { var s = c.querySelector(d > 0 ? '.stamp.l' : '.stamp.n'); if (s) s.style.opacity = '1'; }

  /* ---------- gestures ---------- */
  var drag = null;
  function attach() {
    var c = cards[0]; if (!c || c._bound) return; c._bound = true;
    c.addEventListener('pointerdown', function (e) {
      if (state !== 'play' || busy || c !== cards[0]) return;
      drag = { c: c, x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, dy: 0, moved: false };
      c._drag = true; c.className = 'pc drag';
      try { c.setPointerCapture(e.pointerId); } catch (x) {}
    });
    c.addEventListener('pointermove', function (e) {
      if (!drag || drag.c !== c) return;
      drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      if (Math.abs(drag.dx) + Math.abs(drag.dy) > 8) drag.moved = true;
      c.style.transform = 'translate3d(' + drag.dx + 'px,' + drag.dy * 0.6 + 'px,0) rotate(' + (drag.dx / 16) + 'deg)';
      var p = Math.min(1, Math.abs(drag.dx) / 110);
      c.querySelector('.stamp.l').style.opacity = drag.dx > 0 ? p : 0;
      c.querySelector('.stamp.n').style.opacity = drag.dx < 0 ? p : 0;
      var nxt = cards[1]; if (nxt) { nxt.style.transform = 'translate3d(0,' + (14 - 14 * p) + 'px,0) scale(' + (0.95 + 0.05 * p) + ')'; }
    });
    function end() {
      if (!drag || drag.c !== c) return;
      var d = drag; drag = null;
      var v = d.dx / Math.max(1, Date.now() - d.t);
      if (!d.moved) { c._drag = false; c.className = 'pc' + (c.className.indexOf('info') > -1 ? '' : ' info'); c.style.transform = depthT(0); resetStamps(c); return; }
      if (Math.abs(d.dx) > 110 || Math.abs(v) > 0.7 && Math.abs(d.dx) > 40) {
        var dir = d.dx > 0 ? 1 : -1; busy = true; var i = c._i;
        fly(c, dir, d.dy * 0.6);
        if (conn) conn.send({ t: 'swipe', i: i, like: dir > 0 });
        if (dir > 0 && navigator.vibrate) { try { navigator.vibrate(14); } catch (e) {} }
        idx = i + 1; cards.shift(); refill(); layout(); updateCount();
        setTimeout(function () { busy = false; }, 120);
      } else {
        c._drag = false; c.className = 'pc'; c.style.transform = depthT(0); resetStamps(c); layout();
      }
    }
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  }
  function resetStamps(c) { c.querySelector('.stamp.l').style.opacity = 0; c.querySelector('.stamp.n').style.opacity = 0; }

  /* ---------- matches ---------- */
  function addMatch(movie) {
    for (var i = 0; i < matches.length; i++) if (matches[i].id === movie.id) return;
    matches.push(movie); renderMatches();
    $('toastImg').src = movie.poster; $('toastTitle').textContent = movie.title;
    $('toast').className = 'toast glass on';
    var b = $('matchBtn'); b.className = 'pill glass bump'; setTimeout(function () { b.className = 'pill glass'; }, 700);
    if (navigator.vibrate) { try { navigator.vibrate([30, 40, 60]); } catch (e) {} }
    clearTimeout(addMatch.t); addMatch.t = setTimeout(function () { $('toast').className = 'toast glass'; }, 4200);
  }
  function renderMatches() {
    $('matchN').textContent = matches.length;
    var box = $('sheetList'); box.innerHTML = '';
    if (!matches.length) box.appendChild(el('div', 'empty', 'No matches yet. Keep swiping.'));
    matches.slice().reverse().forEach(function (m) {
      var r = el('div', 'm-row'); var img = el('img'); img.src = m.poster; img.alt = ''; r.appendChild(img);
      r.appendChild(el('div', null, '<b>' + esc(m.title) + '</b><span>' + esc(m.year || '') + '</span>')); box.appendChild(r);
    });
  }
  $('matchBtn').onclick = function () { $('sheet').className = 'sheet on'; };
  $('sheetClose').onclick = function () { $('sheet').className = 'sheet'; };
  $('sheet').onclick = function (e) { if (e.target === $('sheet')) $('sheet').className = 'sheet'; };

  /* ---------- join form ---------- */
  $('nameIn').value = name;
  function doJoin(e) {
    if (e) e.preventDefault();
    var n = $('nameIn').value.replace(/^\s+|\s+$/g, '').slice(0, 14);
    name = n || 'Player'; store('mm_name', name);
    $('join').className = 'join'; $('meName').textContent = name; connect();
  }
  $('joinForm').addEventListener('submit', doJoin);
  if (name) { doJoin(); } else { setTimeout(function () { try { $('nameIn').focus(); } catch (e) {} }, 400); }
  renderMatches();
})();
