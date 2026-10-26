/* Movie Match - live link between the TV (host) and phones (guests).
   Real mode: WebRTC through PeerJS (library is loaded from a CDN at runtime, free public signalling).
   Mock mode (?mock in the URL): BroadcastChannel between tabs of one browser - used for previews.
   ES5 on purpose so it runs on the TV's older browser.

   Connection object:  c.id  c.send(obj)  c.close()  c.onmessage(obj)  c.onclose()
*/
(function (w) {
  var PEER_SRC = [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
  ];
  var isMock = /[?&#]mock/.test(location.search + location.hash);

  function loadScript(list, test, done) {
    var i = 0;
    (function next() {
      if (test()) { done(true); return; }
      if (i >= list.length) { done(false); return; }
      var s = document.createElement('script');
      s.src = list[i++];
      s.onload = function () { done(!!test()); };
      s.onerror = next;
      document.head.appendChild(s);
    })();
  }
  function loadPeer(cb) { loadScript(PEER_SRC, function () { return !!w.Peer; }, cb); }

  function wrapPeer(conn) {
    var c = { id: conn.peer, onmessage: null, onclose: null };
    c.send = function (o) { try { conn.send(o); } catch (e) {} };
    c.close = function () { try { conn.close(); } catch (e) {} };
    conn.on('data', function (d) { if (c.onmessage) c.onmessage(d); });
    conn.on('close', function () { if (c.onclose) c.onclose(); });
    conn.on('error', function () { if (c.onclose) c.onclose(); });
    return c;
  }

  /* ---------- host (the TV) ---------- */
  function hostPeer(id, h) {
    loadPeer(function (ok) {
      if (!ok) { h.onerror('Could not load the connection library. Check the TV internet.'); return; }
      var p = new w.Peer(id, { debug: 0 });
      p.on('open', function () { h.onopen(id); });
      p.on('error', function (e) { h.onerror(e && e.type ? e.type : 'error'); });
      p.on('disconnected', function () { try { p.reconnect(); } catch (e) {} });
      p.on('connection', function (conn) {
        conn.on('open', function () { h.onconn(wrapPeer(conn)); });
      });
    });
  }

  function hostMock(id, h) {
    var ch = new BroadcastChannel('mm-' + id), conns = {};
    ch.onmessage = function (ev) {
      var m = ev.data;
      if (m.to !== 'host') return;
      if (m.kind === 'join') {
        var c = { id: m.from, onmessage: null, onclose: null };
        c.send = function (o) { ch.postMessage({ to: m.from, from: 'host', kind: 'data', data: JSON.parse(JSON.stringify(o)) }); };
        c.close = function () {};
        conns[m.from] = c;
        c.send({ t: '_open' });
        h.onconn(c);
      } else if (m.kind === 'data' && conns[m.from] && conns[m.from].onmessage) {
        conns[m.from].onmessage(m.data);
      } else if (m.kind === 'bye' && conns[m.from] && conns[m.from].onclose) {
        conns[m.from].onclose(); delete conns[m.from];
      }
    };
    setTimeout(function () { h.onopen(id); }, 50);
  }

  /* ---------- guest (a phone) ---------- */
  function joinPeer(hostId, h) {
    loadPeer(function (ok) {
      if (!ok) { h.onerror('Could not load the connection library. Check your internet.'); return; }
      var p = new w.Peer({ debug: 0 }), done = false;
      p.on('error', function (e) { if (!done) { done = true; h.onerror(e && e.type ? e.type : 'error'); } });
      p.on('open', function () {
        var conn = p.connect(hostId, { reliable: true });
        var timer = setTimeout(function () { if (!done) { done = true; h.onerror('timeout'); try { p.destroy(); } catch (e) {} } }, 15000);
        conn.on('open', function () { clearTimeout(timer); done = true; h.onopen(wrapPeer(conn)); });
        conn.on('error', function () { if (!done) { done = true; h.onerror('conn'); } });
      });
    });
  }

  function joinMock(hostId, h) {
    var me = 'p' + Math.random().toString(36).slice(2, 8), ch = new BroadcastChannel('mm-' + hostId);
    var c = { id: me, onmessage: null, onclose: null };
    c.send = function (o) { ch.postMessage({ to: 'host', from: me, kind: 'data', data: JSON.parse(JSON.stringify(o)) }); };
    c.close = function () { ch.postMessage({ to: 'host', from: me, kind: 'bye' }); };
    var opened = false;
    ch.onmessage = function (ev) {
      var m = ev.data;
      if (m.to !== me) return;
      if (m.data && m.data.t === '_open') { if (!opened) { opened = true; h.onopen(c); } return; }
      if (c.onmessage) c.onmessage(m.data);
    };
    ch.postMessage({ to: 'host', from: me, kind: 'join' });
    setTimeout(function () { if (!opened) h.onerror('timeout'); }, 4000);
  }

  w.Link = {
    mock: isMock,
    host: function (id, h) { (isMock ? hostMock : hostPeer)(id, h); },
    join: function (hostId, h) { (isMock ? joinMock : joinPeer)(hostId, h); },
    loadScript: loadScript
  };
})(window);
