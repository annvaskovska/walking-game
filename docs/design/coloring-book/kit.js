// Style-free helpers over window.CITY (load city.js first). Prototype only.
// Kit.at(m)          -> {x, y, angle} on the demo route at meter m (angle in radians, 0 = east, y down)
// Kit.total          -> route length in meters (~4249)
// Kit.trail(m)       -> flat [x,y,...] of the route walked so far
// Kit.stats(m, ms?)  -> {m, dist:'1.24 km'|'560 m', value, unit, steps:'1,652', time:'12:34', words:'12 min', ms}
// Kit.lit(m)         -> {streets:[...lines lit], houses:[...], names:[street names lit, in order], places:[...seen]}
// Kit.player({mps, rate, onTick(m, dt), onStreet(s), onPlace(p), onEnd()}) -> {play(), pause(), seek(m), get m, playing}
//   mps: walking speed (default 1.4 m/s), rate: playback multiplier (default 25: the loop takes ~2 min).
(function () {
  var C = window.CITY, R = C.route.pts, mpu = C.metersPerUnit, cum = [0];
  for (var i = 2; i < R.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(R[i] - R[i - 2], R[i + 1] - R[i - 1]) * mpu);
  var total = cum[cum.length - 1];
  function seg(m) {
    m = Math.max(0, Math.min(total, m));
    var k = 1;
    while (k < cum.length - 1 && cum[k] < m) k++;
    return { k: k, f: (m - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1) };
  }
  function at(m) {
    var s = seg(m), a = 2 * (s.k - 1), b = 2 * s.k;
    var dx = R[b] - R[a], dy = R[b + 1] - R[a + 1];
    return { x: R[a] + dx * s.f, y: R[a + 1] + dy * s.f, angle: Math.atan2(dy, dx) };
  }
  function trail(m) {
    var s = seg(m), out = R.slice(0, 2 * s.k), p = at(m);
    out.push(p.x, p.y);
    return out;
  }
  function stats(m, ms) {
    ms = ms == null ? (m / 1.4) * 1000 : ms;
    var sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var value = m < 1000 ? String(Math.round(m)) : (m / 1000).toFixed(2), unit = m < 1000 ? 'm' : 'km';
    var mins = Math.max(1, Math.round(sec / 60));
    return {
      m: m, ms: ms, value: value, unit: unit, dist: value + ' ' + unit,
      steps: Math.round(m / 0.75).toLocaleString('en-US'),
      time: h ? h + ':' + pad(mi) + ':' + pad(s2) : mi + ':' + pad(s2),
      words: mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min',
    };
  }
  function lit(m) {
    var f = function (x) { return x.litAt !== undefined && x.litAt <= m; };
    return {
      streets: C.streets.filter(f).concat(C.paths.filter(f)),
      houses: C.buildings.filter(f),
      names: C.route.streets.filter(function (s) { return s.m <= m; }).map(function (s) { return s.name; }),
      places: C.route.places.filter(function (p) { return p.m <= m; }),
    };
  }
  function player(o) {
    o = o || {};
    var mps = o.mps || 1.4, rate = o.rate || 25, m = 0, playing = false, last = 0, si = 0, pi = 0;
    function fire() {
      var S = C.route.streets, P = C.route.places;
      while (si < S.length && S[si].m <= m) { var s = S[si++]; if (o.onStreet) o.onStreet(s); }
      while (pi < P.length && P[pi].m <= m) { var p = P[pi++]; if (o.onPlace) o.onPlace(p); }
    }
    function frame(t) {
      if (!playing) return;
      // A frame's timestamp can precede the play() that scheduled it: never step backwards.
      var dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
      last = t;
      m = Math.min(total, m + mps * rate * dt);
      fire();
      o.onTick && o.onTick(m, dt);
      if (m >= total) { playing = false; o.onEnd && o.onEnd(); return; }
      requestAnimationFrame(frame);
    }
    var api = {
      play: function () { if (playing) return; playing = true; last = performance.now(); requestAnimationFrame(frame); },
      pause: function () { playing = false; },
      seek: function (to) {
        m = Math.max(0, Math.min(total, to));
        var S = C.route.streets, P = C.route.places;
        si = 0; pi = 0;
        while (si < S.length && S[si].m <= m) si++;
        while (pi < P.length && P[pi].m <= m) pi++;
        o.onTick && o.onTick(m, 0);
      },
      setRate: function (r) { rate = r; },
    };
    Object.defineProperty(api, 'm', { get: function () { return m; } });
    Object.defineProperty(api, 'playing', { get: function () { return playing; } });
    return api;
  }
  window.Kit = { at: at, total: total, trail: trail, stats: stats, lit: lit, player: player, autoStarts: 0, errors: [] };
  // For QA: every uncaught error on the page, from before its own script runs.
  addEventListener('error', function (e) { Kit.errors.push(e.message + ' @' + e.lineno); });

  // Every prototype opens straight into its walk: with no hash, press the page's own Start once it
  // shows. #start still opens the start screen; #walk and #summary are unchanged. The press waits
  // for the page to settle: some pages finish booting a few frames after load and would undo it.
  if (!location.hash) addEventListener('load', function () {
    var looks = 0;
    setTimeout(function press() {
      if ((location.hash && location.hash !== '#start') || looks++ > 40 || Kit.autoStarts >= 3) return;
      var b = Array.prototype.filter.call(document.querySelectorAll('button'), function (el) {
        var r = el.getBoundingClientRect();
        return /demo walk/i.test(el.getAttribute('aria-label') || el.textContent) && r.width > 0 && r.height > 0 &&
          !el.disabled && !el.closest('[hidden],[inert],[aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden';
      }).sort(function (p, q) {
        var a = p.getBoundingClientRect(), c = q.getBoundingClientRect();
        return c.width * c.height - a.width * a.height;
      })[0];
      if (b) { Kit.autoStarts++; b.click(); }
      setTimeout(press, b ? 3000 : 300);
    }, 900);
  });
})();
