/* The New Vespuzizi Times — feuilletage (StPageFlip), son de page, carte animée, visionneuse.
   Données du numéro : <script type="application/json" id="nvt-data"> (pages, carte, son). */
(function () {
  'use strict';
  var PW = 360, PH = 700, RATIO = PW / PH, BAR = 40;
  var NVT = {};
  try { NVT = JSON.parse(document.getElementById('nvt-data').textContent); } catch (e) { NVT = { pages: [] }; }
  // deux cartes animées : le Film des 24 h (`map`, page `mapPage`) et le Film de la course
  // (`race`, page `racePage`, meneur couronné) ; index (0) de page, -1 sans carte
  var MAP_PAGE = NVT.map && NVT.mapPage >= 0 ? NVT.mapPage : -1;
  var RACE_PAGE = NVT.race && NVT.racePage >= 0 ? NVT.racePage : -1;
  var SON = NVT.son || '';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* fichier local : ignoré */ } }
  };
  var dbg = window.__nvt = { sounds: 0, flips: 0, state: 'read', map: { playing: false, progress: 0 },
    race: { playing: false, progress: 0, leader: '' } };

  /* ------------------------------------------------------------------ son */
  // Vrai enregistrement d'une page tournée (domaine public, voir le commentaire d'en-tête),
  // décodé une fois par Web Audio ; repli sur un élément <audio>. Tout échec : silence.
  var audio = null, sample = null, decoding = false, soundOn = store.get('nvt-son') !== 'off';
  var fallbackEl = null;
  function unlock() { try { unlock0(); } catch (e) { audio = null; } }
  function unlock0() {
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { audio = new AC(); } catch (e) { audio = null; return; }
    }
    if (audio.state === 'suspended') { try { var pr = audio.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* refusé */ } }
    if (!sample && !decoding && SON && window.fetch) {
      decoding = true;
      var ok = function (buf) { sample = buf; dbg.sampleReady = true; };
      var ko = function () { decoding = false; dbg.sampleError = true; };
      fetch(SON).then(function (r) { if (!r.ok) throw new Error('son'); return r.arrayBuffer(); }).then(function (ab) {
        var p = audio.decodeAudioData(ab, ok, ko);
        if (p && p.catch) p.catch(ko);
      }).catch(ko);
    }
  }
  ['pointerup', 'click', 'touchend', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { capture: true, passive: true });
  });
  var lastTurn = 0;
  // pendant la musique de l'ES (en cours ou demandée), le bruit de page s'efface derrière elle :
  // son gain (Web Audio comme repli <audio>) est multiplié par ce facteur ; sinon inchangé
  var PAGE_UNDER_MUSIC = 0.3;
  function pageFactor() {
    var m = dbg.music;
    return m && (m.on || m.playing) ? PAGE_UNDER_MUSIC : 1;
  }
  function turnSound() { try { turnSound0(); } catch (e) { /* silence */ } }
  function turnSound0() {
    if (!soundOn) return;
    var now = Date.now();
    if (now - lastTurn < 450) return;
    lastTurn = now;
    var rate = 0.93 + Math.random() * 0.14; // petites variations naturelles
    var k = pageFactor();
    if (audio && sample && audio.state === 'running') {
      var src = audio.createBufferSource(), g = audio.createGain();
      src.buffer = sample; src.playbackRate.value = rate;
      g.gain.value = dbg.lastPageGain = (0.75 + Math.random() * 0.15) * k;
      src.connect(g); g.connect(audio.destination); src.start();
      dbg.sounds++;
      return;
    }
    if (!fallbackEl && window.Audio && SON) fallbackEl = new Audio(SON);
    if (fallbackEl) {
      fallbackEl.currentTime = 0; fallbackEl.volume = dbg.lastPageGain = 0.8 * k;
      fallbackEl.playbackRate = rate;
      var pp = fallbackEl.play(); if (pp && pp.catch) pp.catch(function () {});
      dbg.sounds++;
    }
  }
  var rustle = turnSound, snap = function () {};
  var sndBtn = document.getElementById('snd');
  function paintSnd() {
    sndBtn.classList.toggle('off', !soundOn);
    sndBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    sndBtn.title = soundOn ? 'Couper le son' : 'Remettre le son';
  }
  sndBtn.addEventListener('click', function () {
    soundOn = !soundOn; store.set('nvt-son', soundOn ? 'on' : 'off'); paintSnd(); unlock();
    if (soundOn) { lastTurn = 0; turnSound(); }
  });
  paintSnd();
  dbg.isSoundOn = function () { return soundOn; };

  /* ------------------------------------------------------------- musique (ES) */
  // Édition spéciale seulement (`music` dans les données) : un HTMLAudioElement en boucle
  // (finie, la musique reprend au début, voulu), coupé seulement par le bouton ; filet sur
  // `ended` si le navigateur ne boucle pas (Safari iOS), relances comptées. Pendant toute la
  // musique, le son de page est atténué (PAGE_UNDER_MUSIC, section son).
  // Jamais lancé avant un geste (lecture automatique refusée sans geste, iOS Safari compris :
  // play() n'est appelé que depuis un gestionnaire de toucher, de clic ou de touche, comme le
  // déverrouillage du son de page). Bouton #mus distinct du bouton ♪ du son de page ;
  // préférence « nvt-musique » (on / off) dans localStorage (store : try/catch).
  var MUSIC = NVT.music || '';
  var musBtn = document.getElementById('mus');
  var mus = dbg.music = { on: false, playing: false, plays: 0, loops: 0 };
  if (MUSIC && musBtn) {
    var musEl = null, musGest = false;
    var musPaint = function () {
      musBtn.classList.toggle('off', !mus.on);
      musBtn.setAttribute('aria-pressed', mus.on ? 'true' : 'false');
      musBtn.textContent = mus.on ? 'couper' : '♪ musique';
      musBtn.title = mus.on ? 'Couper la musique' : 'Mettre la musique';
    };
    var musPlay = function () {
      try {
        if (!musEl) {
          musEl = new Audio(MUSIC);
          musEl.loop = true; musEl.preload = 'auto'; musEl.volume = 0.6;
          mus.loop = musEl.loop; dbg.musEl = musEl; // crochet de test
          musEl.addEventListener('playing', function () { mus.playing = true; });
          musEl.addEventListener('pause', function () { mus.playing = false; });
          musEl.addEventListener('error', function () { mus.playing = false; mus.error = true; });
          // filet : `ended` ne part pas quand `loop` est honoré ; s'il part quand même (Safari
          // iOS), la musique toujours voulue repart du début ; refus : arrêt propre
          var musHalt = function () { mus.on = false; mus.playing = false; musPaint(); };
          musEl.addEventListener('ended', function () {
            if (!mus.on) return;
            mus.loops++;
            try {
              musEl.currentTime = 0;
              var rp = musEl.play();
              if (rp && rp.catch) rp.catch(musHalt);
            } catch (e) { musHalt(); }
          });
        }
        mus.on = true; mus.plays++;
        var pr = musEl.play();
        // refus (geste non reconnu par le navigateur, pointerup sous iOS par exemple) : le geste
        // suivant réessaie, trois fois au plus
        if (pr && pr.catch) pr.catch(function () {
          mus.playing = false; mus.blocked = true; mus.on = false; musPaint();
          if (mus.plays < 3) musGest = false;
        });
      } catch (e) { mus.playing = false; }
      musPaint();
    };
    var musStop = function () {
      mus.on = false;
      try { if (musEl) musEl.pause(); } catch (e) { /* silence */ }
      mus.playing = false;
      musPaint();
    };
    var musGesture = function (e) { // premier geste ailleurs que sur le bouton : la musique part
      if (musGest) return;
      musGest = true;
      if (e && e.target && musBtn.contains(e.target)) return; // le bouton décide lui-même
      if (store.get('nvt-musique') !== 'off') musPlay();
    };
    ['pointerup', 'click', 'touchend', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, musGesture, { capture: true, passive: true });
    });
    musBtn.addEventListener('click', function () {
      musGest = true;
      if (mus.on) { musStop(); store.set('nvt-musique', 'off'); } else { musPlay(); store.set('nvt-musique', 'on'); }
    });
    musPaint();
  }

  /* ------------------------------------------------------------------ carte */
  function makeMap(DATA, st) { // st : état exposé (__nvt.map ou __nvt.race)
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = null, boats = [], W = 0, H = 0, proj = null, clock = null;
    var RACE = !!(DATA && DATA.leads), crown = null, leaderEl = null, cursor = null, shownLeader = null;
    // Film de la course : caméra dynamique. `svg` porte le monde (terres, quadrillage, tracés à
    // trait constant) et ne change que de viewBox ; `ov` (calque écran, même taille) porte points,
    // noms, couronne, échelle, rose et légendes, placés en coordonnées écran à chaque image.
    var CAM = RACE && !!DATA.lods, ov = null, cams = [], cam = null, NS = 240, S0 = 1, startW = null;
    var invW = null, camTL = null, camBR = null, gratG = null, glG = null, frontO = null;
    var grats = {}, gratOn = null, gls = [], lodEls = [], scaleEl = null, scaleTx = null, scaleKey = '', placeEls = [];
    var prog = 0, playing = false, raf = 0, lastTs = 0, DUR = RACE ? 14000 : 8000;
    var WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    function el(name, attrs, parent) {
      var e = document.createElementNS(svgNS, name);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    }
    var rootEl = null, built = false, fixedBoxes = [];
    function build(root) { rootEl = root; built = false; svg = null; ensure(); }
    function ensure() { // la page cachée (display:none) n'a pas de taille : construction à la première vue
      if (built || !rootEl) return built;
      var s0 = rootEl.querySelector('svg.map');
      if (!s0 || !s0.parentNode.clientWidth) return false;
      construct(rootEl); built = true; return true;
    }
    function construct(root) {
      fixedBoxes = []; frontO = null;
      svg = root.querySelector('svg.map');
      clock = root.querySelector('#clock, .clock');
      leaderEl = root.querySelector('.leader'); cursor = root.querySelector('.rcursor'); shownLeader = null;
      if (!svg || !DATA) return;
      var box = svg.parentNode, k = parseFloat(getComputedStyle(document.documentElement).fontSize) / 10;
      W = box.clientWidth / k; H = box.clientHeight / k;
      if (!W || !H) { W = 326; H = 470; }
      svg.setAttribute('viewBox', '0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      ov = svg;
      if (CAM) {
        ov = box.querySelector('svg.mapov') || el('svg', { 'class': 'mapov', 'aria-hidden': 'true' }, box);
        ov.setAttribute('viewBox', '0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1));
        while (ov.firstChild) ov.removeChild(ov.firstChild);
        svg.setAttribute('class', 'map cam');
      }
      // projection équirectangulaire locale, cadrée sur les trajectoires
      var b = DATA.bbox, latm = (b[0] + b[1]) / 2 * Math.PI / 180, c = Math.cos(latm);
      var gx0 = b[2] * c, gx1 = b[3] * c, gy0 = -b[1], gy1 = -b[0];
      var m = 16, s = Math.min((W - 2 * m) / (gx1 - gx0), (H - 2 * m - 16) / (gy1 - gy0));
      var ox = (W - s * (gx1 - gx0)) / 2 - s * gx0, oy = (H - s * (gy1 - gy0)) / 2 - s * gy0 - 6;
      proj = function (lat, lon) { return [ox + s * lon * c, oy - s * lat]; };
      var inv = function (x, y) { return [(oy - y) / s, (x - ox) / (s * c)]; };
      var tl = inv(0, 0), br = inv(W, H);
      S0 = s; invW = inv; camTL = tl; camBR = br;
      if (CAM) { camLayers(); } else {
      // graticule
      var g = el('g', {}, svg), step = DATA.grat;
      for (var la = Math.ceil(br[0] / step) * step; la <= tl[0]; la += step) {
        var y = proj(la, 0)[1]; el('line', { x1: 0, x2: W, y1: y, y2: y, 'class': 'grat' }, g);
        var t = el('text', { x: 4, y: y - 3, 'class': 'gl' }, g); t.textContent = Math.abs(la) + (la < 0 ? '° S' : '° N');
      }
      for (var lo = Math.ceil(tl[1] / step) * step; lo <= br[1]; lo += step) {
        var x = proj(0, lo)[0]; el('line', { x1: x, x2: x, y1: 0, y2: H, 'class': 'grat' }, g);
        var t2 = el('text', { x: x + 3, y: H - 5, 'class': 'gl' }, g); t2.textContent = Math.abs(lo) + (lo > 0 ? '° E' : '° O');
      }
      // terres (masque, par bandes de latitude)
      var d = '', hs = DATA.landStep;
      DATA.land.forEach(function (r) {
        var p0 = proj(r[0] + hs / 2, r[1] - hs / 2), p1 = proj(r[0] - hs / 2, r[2] + hs / 2);
        d += 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + 'H' + p1[0].toFixed(1) + 'V' + p1[1].toFixed(1) + 'H' + p0[0].toFixed(1) + 'Z';
      });
      if (d) el('path', { d: d, 'class': 'land' }, svg);
      DATA.places.forEach(function (pl) {
        var p = proj(pl.lat, pl.lon), t = el('text', { x: p[0], y: p[1], 'class': 'place', 'text-anchor': 'middle' }, svg);
        t.textContent = pl.name;
        var hw = pl.name.length * 3.3; fixedBoxes.push([p[0] - hw, p[1] - 11, p[0] + hw, p[1] + 3]);
      });
      // rose des vents et échelle
      var rx = W - 30, ry = 34, rose = el('g', { transform: 'translate(' + rx + ',' + ry + ')', opacity: '.75' }, svg);
      el('path', { d: 'M0 -20 L5 0 L0 20 L-5 0Z', fill: '#2B1D10' }, rose);
      el('path', { d: 'M-20 0 L0 4 L20 0 L0 -4Z', fill: '#7E5F3A' }, rose);
      el('circle', { r: 13, fill: 'none', stroke: '#2B1D10', 'stroke-width': .7 }, rose);
      var nt = el('text', { y: -23, 'text-anchor': 'middle', 'class': 'gl' }, rose); nt.textContent = 'N';
      var nm = DATA.scaleNm, px = s * c * (nm / 60) / c; // 1° de latitude = 60 milles
      px = s * (nm / 60);
      var sc = el('g', { transform: 'translate(' + 12 + ',' + 22 + ')' }, svg);
      el('path', { d: 'M0 0H' + px.toFixed(1) + 'M0 -3V3M' + px.toFixed(1) + ' -3V3', stroke: '#2B1D10', 'stroke-width': 1.2 }, sc);
      var st = el('text', { x: px / 2, y: -5, 'text-anchor': 'middle', 'class': 'gl' }, sc); st.textContent = nm + ' milles';
      }
      // bateaux : Amerigo dessiné en dernier (au-dessus) ; Film de la course : tous au même style
      var order = DATA.boats.slice();
      if (!RACE) order.sort(function (a, b) { return (a.me ? 1 : 0) - (b.me ? 1 : 0); });
      var gt = el('g', {}, svg), gd = el('g', {}, ov), gl = el('g', {}, ov);
      boats = order.map(function (bt) {
        var big = bt.me && !RACE;
        var pts = bt.pts.map(function (q) { var p = proj(q[1], q[2]); return [q[0], p[0], p[1]]; });
        var trail = el('polyline', { 'class': 'trail' + (big ? ' me' : ''), stroke: bt.c, points: '' }, gt);
        var dot = el('circle', { r: big ? 4.6 : 3, fill: bt.c, stroke: '#f3e6c4', 'stroke-width': big ? 1.6 : 1 }, gd);
        var ring = big ? el('circle', { r: 8, fill: 'none', stroke: bt.c, 'stroke-width': 1.2, opacity: .6 }, gd) : null;
        var lbl = el('text', { 'class': 'lbl' + (big ? ' me' : ''), fill: bt.c }, gl);
        lbl.textContent = bt.n;
        return { b: bt, big: big, pts: pts, trail: trail, dot: dot, ring: ring, lbl: lbl, w: 0, off: 0 };
      });
      if (CAM) { var sp = proj(DATA.start[0], DATA.start[1]); startW = [sp[0], sp[1]]; camPath(); }
      if (RACE) { // couronne dorée du meneur : halo et couronne au-dessus de son point
        crown = el('g', { 'class': 'crown', visibility: 'hidden' }, ov);
        el('circle', { r: 9.5, fill: 'none', stroke: '#C9A227', 'stroke-width': 2.4, opacity: .9 }, crown);
        el('path', { d: 'M-6 -11 L-6 -18 L-3 -14 L0 -19 L3 -14 L6 -18 L6 -11 Z', fill: '#D4A62A', stroke: '#6B4A10', 'stroke-width': .7 }, crown);
      }
      draw(prog);
    }
    /* ---- Film de la course : caméra dynamique ---- */
    function clamp(v, a, b) { return a > b ? (a + b) / 2 : v < a ? a : v > b ? b : v; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function camLayers() {
      grats = {}; gratOn = null; gls = []; lodEls = []; placeEls = []; scaleKey = '';
      gratG = el('g', {}, svg);
      // terres en niveaux de détail (`lods`) : par niveau et par partie, un groupe (fondu d'un bloc)
      // avec l'aplat et le vrai trait de côte (bords terre / mer seulement, jamais les coutures)
      DATA.lods.forEach(function (L) {
        var parts = { s: L.s, ring: null, core: null, op: {} }, M = lodGrid(L);
        ['ring', 'core'].forEach(function (part) {
          if (!L[part].length) return;
          var g = el('g', {}, svg);
          el('path', { d: lodPath(L, L[part]), 'class': 'landf' }, g);
          el('path', { d: coastPath(L, L[part], M), 'class': 'coast' }, g);
          parts[part] = g;
        });
        lodEls.push(parts);
      });
      DATA.places.forEach(function (pl) {
        var t = el('text', { 'class': 'place', 'text-anchor': 'middle' }, ov);
        t.textContent = pl.name; placeEls.push({ w: proj(pl.lat, pl.lon), t: t, hw: pl.name.length * 3.3 });
      });
      glG = el('g', {}, ov);
      var rose = el('g', { transform: 'translate(' + (W - 30) + ',34)', opacity: '.75' }, ov);
      el('path', { d: 'M0 -20 L5 0 L0 20 L-5 0Z', fill: '#2B1D10' }, rose);
      el('path', { d: 'M-20 0 L0 4 L20 0 L0 -4Z', fill: '#7E5F3A' }, rose);
      el('circle', { r: 13, fill: 'none', stroke: '#2B1D10', 'stroke-width': .7 }, rose);
      var nt = el('text', { y: -23, 'text-anchor': 'middle', 'class': 'gl' }, rose); nt.textContent = 'N';
      var sg = el('g', { transform: 'translate(12,22)' }, ov);
      scaleEl = el('path', { stroke: '#2B1D10', 'stroke-width': 1.2 }, sg);
      scaleTx = el('text', { y: -5, 'text-anchor': 'middle', 'class': 'gl' }, sg);
    }
    function lodPath(L, rows) { // cellules [lat ± s/2, lon début − s/2, lon fin + s/2], léger recouvrement vertical
      var hs = L.s / 2, e = L.s * 0.02, dec = L.s * S0 < 1 ? 3 : 2, d = '';
      rows.forEach(function (r) {
        var la = L.la + r[0] * L.s, y0 = proj(la + hs + e, 0)[1].toFixed(dec), y1 = proj(la - hs - e, 0)[1].toFixed(dec);
        for (var q = 1; q < r.length; q += 2) {
          var x0 = proj(0, L.lo + r[q] * L.s - hs)[0].toFixed(dec), x1 = proj(0, L.lo + r[q + 1] * L.s + hs)[0].toFixed(dec);
          d += 'M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'Z';
        }
      });
      return d;
    }
    function lodGrid(L) { // masque complet du niveau (ring et core) : voisinage des cellules
      var ni = Math.round((L.z[1] - L.z[0]) / L.s), nj = Math.round((L.z[3] - L.z[2]) / L.s), g = new Uint8Array(ni * nj);
      ['ring', 'core'].forEach(function (p) {
        L[p].forEach(function (r) { for (var q = 1; q < r.length; q += 2) for (var j = r[q]; j <= r[q + 1]; j++) g[r[0] * nj + j] = 1; });
      });
      return { ni: ni, nj: nj, g: g };
    }
    function coastPath(L, rows, M) { // bords entre une cellule de terre et une cellule de mer du même niveau
      var hs = L.s / 2, dec = L.s * S0 < 1 ? 3 : 2, d = '';
      function X(j, side) { return proj(0, L.lo + j * L.s + side * hs)[0].toFixed(dec); }
      function Y(i, side) { return proj(L.la + i * L.s + side * hs, 0)[1].toFixed(dec); } // side 1 : bord nord
      function land(i, j) { return i < 0 || j < 0 || i >= M.ni || j >= M.nj ? 1 : M.g[i * M.nj + j]; } // hors grille : couture, pas de côte
      rows.forEach(function (r) {
        var i = r[0];
        for (var q = 1; q < r.length; q += 2) {
          var a = r[q], b = r[q + 1];
          if (!land(i, a - 1)) d += 'M' + X(a, -1) + ' ' + Y(i, 1) + 'V' + Y(i, -1);
          if (!land(i, b + 1)) d += 'M' + X(b, 1) + ' ' + Y(i, 1) + 'V' + Y(i, -1);
          for (var dir = -1; dir <= 1; dir += 2) {
            var j = a;
            while (j <= b) {
              if (land(i + dir, j)) { j++; continue; }
              var j0 = j;
              while (j <= b && !land(i + dir, j)) j++;
              d += 'M' + X(j0, -1) + ' ' + Y(i, dir) + 'H' + X(j - 1, 1);
            }
          }
        }
      });
      return d;
    }
    // Trajet de la caméra, calculé une fois : NS + 1 cadres [x, y, w, h] (unités du monde, rapport
    // W / H). Boîte requise à l'instant i : départ et toutes les positions déjà parcourues (donc
    // jamais plus petite), plus une marge F de chaque côté. Cadre : lissage exponentiel vers la
    // boîte requise un peu plus tard (K cadres d'avance), largeur jamais en baisse, puis glissé
    // juste assez pour contenir la boîte requise ; fondu final vers la vue complète (0 0 W H).
    function camPath() {
      var A = W / H, F = 0.15, K = 18, AL = 0.07, minW = S0 * 1.3 * A; // au plus serré : 1,3° de latitude
      var x0 = startW[0], x1 = x0, y0 = startW[1], y1 = y0, idx = boats.map(function () { return 0; }), B = [], i;
      function add(x, y) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      for (i = 0; i <= NS; i++) {
        var t = DATA.span * i / NS;
        boats.forEach(function (o, n) {
          while (idx[n] < o.pts.length && o.pts[idx[n]][0] <= t) { add(o.pts[idx[n]][1], o.pts[idx[n]][2]); idx[n]++; }
          var h = at(o, t); if (h) add(h.x, h.y);
        });
        B.push([x0, y0, x1, y1]);
      }
      function need(b) { return Math.max(minW, Math.max(b[2] - b[0], (b[3] - b[1]) * A) / (1 - 2 * F)); }
      var e = null, prevW = 0;
      cams = [];
      for (i = 0; i <= NS; i++) {
        var b = B[i], tb = B[Math.min(NS, i + K)];
        if (!e) e = { w: need(b), x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
        else { e.w += AL * (need(tb) - e.w); e.x += AL * ((tb[0] + tb[2]) / 2 - e.x); e.y += AL * ((tb[1] + tb[3]) / 2 - e.y); }
        var w = Math.min(W, Math.max(e.w, need(b), prevW)), h = w / A;
        var cx = clamp(e.x, b[2] + F * w - w / 2, b[0] - F * w + w / 2), cy = clamp(e.y, b[3] + F * h - h / 2, b[1] - F * h + h / 2);
        cx = clamp(cx, w / 2, W - w / 2); cy = clamp(cy, h / 2, H - h / 2);
        e.w = w; e.x = cx; e.y = cy; prevW = w;
        var u = clamp01((i / NS - 0.88) / 0.12); u = u * u * (3 - 2 * u);
        cams.push([(1 - u) * (cx - w / 2), (1 - u) * (cy - h / 2), w + u * (W - w), h + u * (H - h)]);
      }
    }
    function scr(x, y) { if (!CAM) return [x, y]; var z = W / cam[2]; return [(x - cam[0]) * z, (y - cam[1]) * z]; }
    function setOp(g, v, key, L) { // fondu d'un groupe de terres, écrit seulement s'il change
      if (!g) return;
      var s = v >= 0.995 ? '1' : v <= 0.005 ? '0' : v.toFixed(2);
      if (L.op[key] === s) return;
      L.op[key] = s;
      g.setAttribute('opacity', s); g.setAttribute('visibility', s === '0' ? 'hidden' : 'visible');
    }
    function fmtDeg(v, pos, neg) { var a = Math.round(Math.abs(v) * 10) / 10; return String(a).replace('.', ',') + '° ' + (v < 0 ? neg : pos); }
    function gl(k, x, y, txt) {
      while (gls.length <= k) gls.push({ t: el('text', { 'class': 'gl' }, glG), s: null });
      var g = gls[k];
      g.t.setAttribute('x', x.toFixed(1)); g.t.setAttribute('y', y.toFixed(1));
      if (g.s !== txt) { g.t.textContent = txt; g.s = txt; }
      g.t.setAttribute('visibility', 'visible');
    }
    function applyCam(pr) { // une seule écriture de viewBox par image ; le reste en coordonnées écran
      var f = pr * NS, i = Math.min(NS - 1, Math.floor(f)), u = f - i, a = cams[i], b = cams[i + 1];
      cam = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2]), a[3] + u * (b[3] - a[3])];
      svg.setAttribute('viewBox', cam[0].toFixed(3) + ' ' + cam[1].toFixed(3) + ' ' + cam[2].toFixed(3) + ' ' + cam[3].toFixed(3));
      var z = W / cam[2], pxDeg = S0 * z;
      st.cam = cam.slice(); st.zoom = z;
      // terres : un niveau remplace le précédent quand les cellules de celui-ci passent de 4 à 5,5 px
      // (fondu court : les deux couches ne se superposent qu'un instant)
      var fade = lodEls.map(function (L, k) { return k ? clamp01((lodEls[k - 1].s * pxDeg - 4) / 1.5) : 1; }), acc = 1;
      lodEls.forEach(function (L, k) {
        acc *= fade[k];
        setOp(L.ring, acc, 'ring', L);
        setOp(L.core, acc * (1 - (k + 1 < fade.length ? fade[k + 1] : 0)), 'core', L);
      });
      // quadrillage au pas adapté (≥ 50 px entre deux lignes), légendes sur les bords
      var steps = [0.25, 0.5, 1, 2, 5, 10, 20], step = steps[steps.length - 1];
      for (var j = 0; j < steps.length; j++) if (steps[j] * pxDeg >= 50) { step = steps[j]; break; }
      if (gratOn !== step) {
        if (gratOn !== null) grats[gratOn].setAttribute('visibility', 'hidden');
        if (!grats[step]) {
          var g = grats[step] = el('g', {}, gratG), n;
          for (n = Math.ceil(camBR[0] / step); n * step <= camTL[0]; n++) { var y = proj(n * step, 0)[1]; el('line', { x1: 0, x2: W, y1: y, y2: y, 'class': 'grat' }, g); }
          for (n = Math.ceil(camTL[1] / step); n * step <= camBR[1]; n++) { var x = proj(0, n * step)[0]; el('line', { x1: x, x2: x, y1: 0, y2: H, 'class': 'grat' }, g); }
        }
        grats[step].setAttribute('visibility', 'visible'); gratOn = step;
      }
      var tl = invW(cam[0], cam[1]), br = invW(cam[0] + cam[2], cam[1] + cam[3]), k = 0, m;
      for (m = Math.ceil(br[0] / step); m * step <= tl[0]; m++) {
        var sy = scr(0, proj(m * step, 0)[1])[1];
        if (sy > 36 && sy < H - 18) gl(k++, 4, sy - 3, fmtDeg(m * step, 'N', 'S'));
      }
      for (m = Math.ceil(tl[1] / step); m * step <= br[1]; m++) {
        var sx = scr(proj(0, m * step)[0], 0)[0];
        if (sx > 2 && sx < W - 44) gl(k++, sx + 3, H - 5, fmtDeg(m * step, 'E', 'O'));
      }
      for (; k < gls.length; k++) gls[k].t.setAttribute('visibility', 'hidden');
      // échelle : la longueur ronde qui fait au moins 50 px
      var nms = [5, 10, 20, 50, 100, 200, 500, 1000], nm = nms[nms.length - 1];
      for (j = 0; j < nms.length; j++) if (pxDeg * nms[j] / 60 >= 50) { nm = nms[j]; break; }
      var px = pxDeg * nm / 60, key = nm + ':' + px.toFixed(1);
      if (key !== scaleKey) {
        scaleKey = key;
        scaleEl.setAttribute('d', 'M0 0H' + px.toFixed(1) + 'M0 -3V3M' + px.toFixed(1) + ' -3V3');
        scaleTx.setAttribute('x', (px / 2).toFixed(1)); scaleTx.textContent = nm + ' milles';
      }
      fixedBoxes = [];
      placeEls.forEach(function (p) {
        var q = scr(p.w[0], p.w[1]), inside = q[0] > -40 && q[0] < W + 40 && q[1] > -10 && q[1] < H + 10;
        p.t.setAttribute('x', q[0].toFixed(1)); p.t.setAttribute('y', q[1].toFixed(1));
        p.t.setAttribute('visibility', inside ? 'visible' : 'hidden');
        if (inside) fixedBoxes.push([q[0] - p.hw, q[1] - 11, q[0] + p.hw, q[1] + 3]);
      });
    }
    function at(o, t) { // position interpolée au temps t (s depuis t0) ; null avant le premier point
      var p = o.pts; if (!p.length || t < p[0][0]) return null;
      var lo = 0, hi = p.length - 1;
      if (t >= p[hi][0]) return { i: hi, x: p[hi][1], y: p[hi][2] };
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (p[mid][0] <= t) lo = mid; else hi = mid; }
      var f = (t - p[lo][0]) / (p[hi][0] - p[lo][0]);
      return { i: lo, x: p[lo][1] + f * (p[hi][1] - p[lo][1]), y: p[lo][2] + f * (p[hi][2] - p[lo][2]) };
    }
    var OFFS = [[7, 4], [-7, 4, 1], [7, -8], [7, 16], [-7, -8, 1], [-7, 16, 1], [7, -20], [7, 28], [-7, -20, 1], [-7, 28, 1]];
    function draw(pr) {
      if (!svg) return;
      var t = pr * DATA.span;
      if (CAM) applyCam(pr);
      var placed = fixedBoxes.slice(), dec = CAM ? 3 : 1, world = []; // caméra : tracé au millième, collé à son point même au zoom serré
      boats.forEach(function (o) {
        var h = at(o, t);
        if (!h) { o.trail.setAttribute('points', ''); o.dot.setAttribute('visibility', 'hidden'); o.lbl.setAttribute('visibility', 'hidden'); if (o.ring) o.ring.setAttribute('visibility', 'hidden'); o.h = null; return; }
        var s = '';
        for (var i = 0; i <= h.i; i++) s += o.pts[i][1].toFixed(dec) + ',' + o.pts[i][2].toFixed(dec) + ' ';
        s += h.x.toFixed(dec) + ',' + h.y.toFixed(dec);
        o.trail.setAttribute('points', s);
        if (CAM) { world.push([h.x, h.y]); var q = scr(h.x, h.y); h.x = q[0]; h.y = q[1]; } // point, nom, couronne : à l'écran
        o.dot.setAttribute('cx', h.x); o.dot.setAttribute('cy', h.y); o.dot.setAttribute('visibility', 'visible');
        if (o.ring) { o.ring.setAttribute('cx', h.x); o.ring.setAttribute('cy', h.y); o.ring.setAttribute('visibility', 'visible'); }
        o.h = h;
      });
      if (CAM) { st.world = world; st.start = startW; }
      var ld = RACE ? leaderAt(t) : null;
      if (ld && ld.o && ld.o.h) {
        var lo = ld.o;
        if (lo !== frontO) { lo.dot.parentNode.appendChild(lo.dot); lo.lbl.parentNode.appendChild(lo.lbl); frontO = lo; } // meneur au premier plan
        placed.push([lo.h.x - 7, lo.h.y - 20, lo.h.x + 7, lo.h.y - 10]); // place de la couronne : aucune étiquette dessous
      }
      // étiquettes : Amerigo d'abord (24 h seulement), puis du haut vers le bas ; on garde la place précédente si elle reste libre
      boats.forEach(function (o) {
        if (o.h && !o.w) { try { o.w = o.lbl.getComputedTextLength(); } catch (e) { o.w = 0; } if (!o.w) o.w = o.b.n.length * (o.big ? 8 : 6.8); }
      });
      var list = boats.filter(function (o) { return o.h; }).sort(function (a, b) { return (b.big ? 1 : 0) - (a.big ? 1 : 0) || a.h.y - b.h.y; });
      list.forEach(function (o) {
        var hgt = o.big ? 15 : 13, tried = [o.off].concat(OFFS.map(function (_, i) { return i; }));
        var best = null;
        for (var j = 0; j < tried.length; j++) {
          var of = OFFS[tried[j]], x = of[2] ? o.h.x + of[0] - o.w : o.h.x + of[0], y = o.h.y + of[1];
          var r = [x - 1, y - hgt + 3, x + o.w + 1, y + 3];
          if (r[0] < 2 || r[2] > W - 2 || r[1] < 2 || r[3] > H - 2) continue;
          var hit = placed.some(function (q) { return !(r[2] < q[0] || r[0] > q[2] || r[3] < q[1] || r[1] > q[3]); });
          if (!hit) { best = { i: tried[j], x: x, y: y, r: r }; break; }
          if (!best) best = { i: tried[j], x: x, y: y, r: r, hit: true };
        }
        if (!best) best = { i: 0, x: o.h.x + 7, y: o.h.y + 4, r: [0, 0, 0, 0] };
        o.off = best.i; placed.push(best.r);
        o.lbl.setAttribute('x', best.x.toFixed(1)); o.lbl.setAttribute('y', best.y.toFixed(1));
        o.lbl.setAttribute('visibility', 'visible');
      });
      if (RACE) leader(t, ld);
      if (clock) {
        var ts = DATA.t0 + t + DATA.tz, dt = new Date(ts * 1000);
        var hh = dt.getUTCHours(), mm = dt.getUTCMinutes();
        clock.innerHTML = (hh >= 7 && hh < 18 ? '☀︎ ' : '☾ ') + WD[dt.getUTCDay()] + (RACE ? ' ' + dt.getUTCDate() : '')
          + ' <b>' + hh + ' h ' + (mm < 10 ? '0' : '') + mm + '</b>';
      }
      st.progress = pr;
    }
    function leaderAt(t) { // meneur retenu au temps t (`leads`, lissés au build)
      var L = DATA.leads, k = -1;
      for (var i = 0; i < L.length && L[i][0] <= t; i++) k = L[i][1];
      var bt = k >= 0 ? DATA.boats[k] : null, o = null;
      for (var j = 0; j < boats.length; j++) if (boats[j].b === bt) o = boats[j];
      return { bt: bt, o: o };
    }
    function leader(t, ld) { // couronne, nom, curseur
      var bt = ld.bt, o = ld.o;
      if (o && o.h) {
        crown.setAttribute('transform', 'translate(' + o.h.x.toFixed(1) + ',' + o.h.y.toFixed(1) + ')');
        crown.setAttribute('visibility', 'visible');
      } else crown.setAttribute('visibility', 'hidden');
      var name = bt ? bt.n : '';
      if (leaderEl && name !== shownLeader) {
        leaderEl.textContent = '';
        if (name) {
          leaderEl.appendChild(document.createTextNode('Locataire de la 1re place : '));
          var nb = document.createElement('b'); nb.style.color = bt.c; nb.textContent = name; leaderEl.appendChild(nb);
        }
        shownLeader = name;
      }
      st.leader = name;
      if (cursor) cursor.style.left = (Math.min(1, t / (DATA.span || 1)) * 100).toFixed(2) + '%';
    }
    function frame(ts) {
      if (!playing) return;
      if (!lastTs) lastTs = ts;
      prog = Math.min(1, prog + (ts - lastTs) / DUR); lastTs = ts;
      draw(prog);
      if (prog >= 1) { playing = false; st.playing = false; return; }
      raf = requestAnimationFrame(frame);
    }
    return {
      build: build, ensure: ensure, st: st,
      owns: function (node) { return !!rootEl && rootEl.contains(node); },
      play: function () { ensure(); if (!svg || playing) return; if (prog >= 1) prog = 0; playing = true; st.playing = true; lastTs = 0; raf = requestAnimationFrame(frame); },
      pause: function () { playing = false; st.playing = false; cancelAnimationFrame(raf); },
      replay: function () { ensure(); this.pause(); prog = 0; draw(0); this.play(); },
      end: function () { ensure(); this.pause(); prog = 1; draw(1); },
      seek: function (p) { ensure(); this.pause(); prog = Math.max(0, Math.min(1, p)); draw(prog); }, // essais, captures
      finished: function () { return prog >= 1; }
    };
  }
  // une seule animation à la fois : celle de la page visible (`refresh`)
  var maps = [];
  if (MAP_PAGE >= 0) maps.push({ page: MAP_PAGE, m: makeMap(NVT.map, dbg.map) });
  if (RACE_PAGE >= 0) maps.push({ page: RACE_PAGE, m: makeMap(NVT.race, dbg.race) });
  function mapAt(page) { for (var i = 0; i < maps.length; i++) if (maps[i].page === page) return maps[i].m; return null; }
  function pauseMaps() { maps.forEach(function (x) { x.m.pause(); }); }
  // captures d'archive : carte au dernier instant
  dbg.mapEnd = function () { var m = mapAt(MAP_PAGE); if (m) m.end(); };
  dbg.raceEnd = function () { var m = mapAt(RACE_PAGE); if (m) m.end(); };
  dbg.raceSeek = function (p) { var m = mapAt(RACE_PAGE); if (m) m.seek(p); };

  /* ------------------------------------------------------------------ visionneuse */
  // Image en grand, zoom (pincer, double toucher, molette) et déplacement ; le livre est gelé
  // tant qu'elle est ouverte (méthodes de StPageFlip neutralisées, évènements stoppés).
  var lb = (function () {
    var el = document.getElementById('lb'), img = document.getElementById('lbimg');
    var closeB = document.getElementById('lbclose'), hint = document.getElementById('lbhint');
    var s = 1, tx = 0, ty = 0, ptrs = {}, gest = null, moved = false, lastTap = null, tapTimer = 0, isOpen = false;
    var MAXS = 5;
    function box() { return { L: img.offsetLeft, T: img.offsetTop, w: img.offsetWidth, h: img.offsetHeight, vw: el.clientWidth, vh: el.clientHeight }; }
    function clamp() {
      var b = box();
      if (s <= 1.001) { s = 1; tx = 0; ty = 0; return; }
      var W = b.w * s, H = b.h * s;
      tx = W <= b.vw ? (b.w - W) / 2 : Math.min(-b.L, Math.max(b.vw - b.L - W, tx));
      ty = H <= b.vh ? (b.h - H) / 2 : Math.min(-b.T, Math.max(b.vh - b.T - H, ty));
    }
    function apply() { clamp(); img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'; dbg.lbScale = s; }
    function zoomAt(ns, cx, cy, from) { // from : {s, tx, ty, cx, cy} (point d'ancrage initial)
      var b = box(), f = from || { s: s, tx: tx, ty: ty, cx: cx, cy: cy };
      ns = Math.max(1, Math.min(MAXS, ns));
      tx = cx - b.L - (f.cx - b.L - f.tx) * ns / f.s;
      ty = cy - b.T - (f.cy - b.T - f.ty) * ns / f.s;
      s = ns; apply();
    }
    function stop(e) { e.stopPropagation(); }
    function open(src, alt) {
      if (isOpen) return;
      isOpen = true; dbg.lbOpen = true;
      img.src = src; img.alt = alt || '';
      s = 1; tx = 0; ty = 0; img.style.transform = '';
      el.hidden = false; hint.style.opacity = '1';
      setTimeout(function () { hint.style.opacity = '0'; }, 2200);
      pauseMaps();
      try { closeB.focus({ preventScroll: true }); } catch (e) { /* */ }
    }
    function close() {
      if (!isOpen) return;
      isOpen = false; dbg.lbOpen = false; el.hidden = true; ptrs = {}; gest = null;
      clearTimeout(tapTimer); refresh();
    }
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach(function (ev) {
      el.addEventListener(ev, stop, false);
    });
    el.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    el.addEventListener('gesturestart', function (e) { e.preventDefault(); }); // Safari iOS : pas de zoom de page
    img.addEventListener('dragstart', function (e) { e.preventDefault(); });
    closeB.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    function pts() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
    el.addEventListener('pointerdown', function (e) {
      if (e.target === closeB) return;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ }
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY };
      var p = pts();
      if (p.length === 1) { moved = false; gest = { k: 'pan', x: e.clientX, y: e.clientY, tx: tx, ty: ty, t: Date.now() }; }
      if (p.length === 2) {
        moved = true;
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
        gest = { k: 'pinch', d: d || 1, s: s, tx: tx, ty: ty, cx: mx, cy: my };
      }
    });
    el.addEventListener('pointermove', function (e) {
      var q = ptrs[e.pointerId]; if (!q || !gest) return;
      q.x = e.clientX; q.y = e.clientY;
      var p = pts();
      if (gest.k === 'pinch' && p.length >= 2) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
        zoomAt(gest.s * d / gest.d, mx, my, gest);
      } else if (gest.k === 'pan') {
        if (Math.hypot(e.clientX - gest.x, e.clientY - gest.y) > 8) moved = true;
        if (s > 1) { tx = gest.tx + e.clientX - gest.x; ty = gest.ty + e.clientY - gest.y; apply(); }
      }
    });
    function up(e) {
      var q = ptrs[e.pointerId]; delete ptrs[e.pointerId];
      if (!q) return;
      var p = pts();
      if (p.length === 1) { gest = { k: 'pan', x: p[0].x, y: p[0].y, tx: tx, ty: ty, t: Date.now() }; return; } // fin de pincement
      if (p.length) return;
      var wasPinch = gest && gest.k === 'pinch';
      gest = null;
      if (moved || wasPinch || e.type === 'pointercancel') return;
      var now = Date.now(), onImg = e.target === img;
      if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        clearTimeout(tapTimer); lastTap = null; // double toucher : zoom ×2,5 ou retour
        if (s > 1) { s = 1; apply(); } else zoomAt(2.5, e.clientX, e.clientY);
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      clearTimeout(tapTimer);
      if (!onImg && s <= 1) tapTimer = setTimeout(close, 330); // toucher hors image, non zoomée
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) {
      e.preventDefault(); e.stopPropagation();
      zoomAt(s * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
    }, { passive: false });
    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      if (e.key === 'Escape') close();
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);
    window.addEventListener('resize', function () { if (isOpen) apply(); });
    return { open: open, close: close, isOpen: function () { return isOpen; } };
  })();
  dbg.lb = lb;

  /* ------------------------------------------------------------------ livre */
  var stage = document.getElementById('stage'), bookHost = document.getElementById('bookhost');
  var PAGES = NVT.pages || [], pf = null, cur = 0, landscape = false;
  var pgLabel = document.getElementById('pg'), prevB = document.getElementById('prev'), nextB = document.getElementById('next');

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight - BAR - 6;
    var pPort = Math.min(vw - 8, vh * RATIO), pLand = Math.min((vw - 24) / 2, vh * RATIO);
    landscape = vw >= 700 && pLand >= 0.75 * pPort;
    var pw = Math.floor(landscape ? pLand : pPort);
    return { pw: pw, ph: Math.floor(pw / RATIO) };
  }
  function overflowing(root) { // pages affichées dont le contenu déborde (index dans le livre)
    var out = [], pages = root.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      var inner = pages[i].querySelector('.inner');
      if (inner && inner.clientHeight > 0 && inner.scrollHeight > inner.clientHeight + 1) out.push(i);
    }
    return out;
  }
  function wide(inner) { // contenu plus large que la page (mot ou adresse insécable, tableau), hors éléments inclinés
    var box = inner.getBoundingClientRect(), all = inner.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var x = all[i];
      if (x.closest('.seal, .fig, .une-fig') || x.ownerSVGElement) continue; // dessin de la carte : rogné par le SVG
      var r = x.getBoundingClientRect();
      if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) return true;
      if (x.clientWidth && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).display !== 'inline'
          && !x.querySelector('.seal, .fig, .une-fig')) return true;
    }
    return false;
  }
  dbg.overflow = function () { // pages qui débordent, en hauteur ou en largeur (essais)
    var b = document.getElementById('book');
    if (!b) return [];
    var out = overflowing(b), pages = b.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      var inner = pages[i].querySelector('.inner');
      if (inner && inner.clientWidth > 0 && out.indexOf(i) < 0 && wide(inner)) out.push(i);
    }
    return out;
  };
  // filet de sécurité : si une page déborde sur cet appareil (césure, arrondis), le texte de TOUT
  // le numéro est réduit d'un même facteur (10 % au plus) : une seule taille de texte par numéro
  function fit(book, L) {
    var pages = book.querySelectorAll('.page');
    var fz0 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fz')) || 1, fz = fz0;
    for (var i = 0; i < pages.length; i++) {
      pages[i].style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:' + L.pw + 'px;height:' + L.ph + 'px';
    }
    while (overflowing(book).length && fz > fz0 * 0.9 + 1e-6) { fz -= 0.01; book.style.setProperty('--fz', fz.toFixed(3)); }
    dbg.fitOver = overflowing(book);
    for (var j = 0; j < pages.length; j++) pages[j].style.cssText = '';
    dbg.fz = fz; dbg.fz0 = fz0;
  }
  function visiblePages() {
    if (!pf) return [];
    var i = pf.getCurrentPageIndex();
    if (!landscape) return [i];
    if (i === 0) return [0];
    var a = i % 2 === 1 ? i : i - 1; return [a, a + 1];
  }
  function refresh() {
    var vis = visiblePages(), n = PAGES.length;
    pgLabel.textContent = (vis.length > 1 && vis[1] < n ? (vis[0] + 1) + '-' + (vis[1] + 1) : (vis[0] + 1)) + ' / ' + n;
    prevB.disabled = vis[0] <= 0; nextB.disabled = vis[vis.length - 1] >= n - 1;
    var reading = dbg.state === 'read';
    if (reading && maps.some(function (x) { return vis.indexOf(x.page) >= 0 && !x.m.ensure(); })) {
      if ((refresh.tries = (refresh.tries || 0) + 1) < 20) setTimeout(refresh, 120); // page pas encore affichée
      return;
    }
    refresh.tries = 0;
    var active = null; // une seule carte animée : la première visible
    maps.forEach(function (x) { if (!active && reading && vis.indexOf(x.page) >= 0) active = x; });
    maps.forEach(function (x) {
      var m = x.m, st = m.st;
      if (x === active) {
        if (reduced) { if (!st.seen) m.end(); } else if (!m.finished() || !st.wasVisible) m.play();
        st.seen = true; st.wasVisible = true;
      } else {
        m.pause();
        if (vis.indexOf(x.page) < 0) st.wasVisible = false;
      }
    });
  }
  function softPortrait() { // en portrait, la Une se tourne comme du papier (pas en couverture rigide)
    if (!pf || landscape) return;
    pf.getPageCollection && pf.getPageCollection();
    for (var i = 0; i < PAGES.length; i++) { try { pf.getPage(i).setDensity('soft'); } catch (e) { /* */ } }
  }
  function init(start) {
    if (pf) { try { pf.destroy(); } catch (e) { /* */ } }
    var L = layout();
    document.documentElement.style.fontSize = (L.pw / 36) + 'px';
    bookHost.innerHTML = '<div id="book"></div>';
    bookHost.style.width = (landscape ? 2 * L.pw : L.pw) + 'px'; // autoSize : le livre prend 100 % de son parent
    var book = document.getElementById('book');
    book.style.width = (landscape ? 2 * L.pw : L.pw) + 'px';
    book.style.height = L.ph + 'px';
    book.innerHTML = PAGES.map(function (p, i) {
      return '<div class="page" data-density="' + (i === 0 || i === PAGES.length - 1 ? 'hard' : 'soft') + '"><div class="sheet">' + p + '</div></div>';
    }).join('');
    fit(book, L);
    var pages = book.querySelectorAll('.page');
    pf = new St.PageFlip(book, {
      width: L.pw, height: L.ph, size: 'fixed', autoSize: true, usePortrait: true, showCover: true,
      drawShadow: !reduced, maxShadowOpacity: reduced ? 0 : 0.55, flippingTime: reduced ? 280 : 850,
      mobileScrollSupport: false, swipeDistance: 30, clickEventForward: true, useMouseEvents: true,
      showPageCorners: true, disableFlipByClick: true, startPage: start || 0, startZIndex: 1
    });
    pf.loadFromHTML(pages);
    // flipNext/flipPrev passent par le filtre « clic hors coin » de disableFlipByClick, dont le
    // point de départ tombe hors coin en portrait : filtre levé le temps de l'appel
    ['flipNext', 'flipPrev'].forEach(function (name) {
      var orig = pf[name].bind(pf);
      pf[name] = function (corner) {
        var st = pf.getSettings(), d = st.disableFlipByClick;
        st.disableFlipByClick = false;
        try { orig(corner); } finally { st.disableFlipByClick = d; }
      };
    });
    // visionneuse ouverte : le livre ne réagit plus à rien
    ['startUserTouch', 'userMove', 'userStop', 'flipNext', 'flipPrev'].forEach(function (name) {
      var orig = pf[name].bind(pf);
      pf[name] = function (a, b) { if (lb.isOpen()) return; return orig(a, b); };
    });
    softPortrait();
    // en portrait, la bibliothèque n'achève la tourne que si le doigt dépasse le bord gauche de
    // la page : un glissé franc (> 25 % de la largeur) suffit ici
    var fc = pf.getFlipController();
    if (fc && fc.stopMove && fc.animateFlippingTo) {
      var origStop = fc.stopMove.bind(fc);
      fc.stopMove = function () {
        try {
          if (!landscape && fc.calc && drag && Math.abs(drag.dx) > 0.25 * L.pw) {
            var pos = fc.calc.getPosition(), rect = fc.getBoundsRect();
            var y = fc.calc.getCorner() === 'bottom' ? rect.height : 0;
            fc.animateFlippingTo(pos, { x: -rect.pageWidth, y: y }, true);
            dbg.forcedTurns = (dbg.forcedTurns || 0) + 1;
            return;
          }
        } catch (e) { /* repli : comportement d'origine */ }
        origStop();
      };
    }
    maps.forEach(function (x) { x.m.build(book.querySelectorAll('.page')[x.page]); });
    pf.on('flip', function (e) { cur = e.data; dbg.flips++; snap(); refresh(); });
    pf.on('changeState', function (e) {
      dbg.state = e.data;
      if (e.data === 'user_fold' || e.data === 'flipping') { rustle(); pauseMaps(); }
      if (e.data === 'read') refresh();
    });
    pf.on('changeOrientation', function () { softPortrait(); });
    refresh();
    dbg.pf = pf; dbg.landscape = landscape;
  }
  prevB.addEventListener('click', function () { unlock(); if (pf) pf.flipPrev('bottom'); });
  nextB.addEventListener('click', function () { unlock(); if (pf) pf.flipNext('bottom'); });
  document.addEventListener('keydown', function (e) {
    if (!pf) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { pf.flipNext('bottom'); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { pf.flipPrev('bottom'); e.preventDefault(); }
  });
  // repli : un glissé franc que la bibliothèque n'a pris ni pour un balayage (> 250 ms) ni pour
  // un pli tourne quand même la page
  var sw = null, drag = null;
  document.addEventListener('touchmove', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (sw && t) drag = { dx: t.clientX - sw.x };
  }, { capture: true, passive: true });
  function state0() { return dbg.state === 'read'; }
  document.addEventListener('touchstart', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    drag = null;
    sw = t && e.target.closest && e.target.closest('#book') ? { x: t.clientX, y: t.clientY, flips: dbg.flips, t: Date.now(), btn: !!e.target.closest('button'), img: e.target.closest('img.zoom'), link: e.target.closest('a.encart[href]') } : null;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', function (e) {
    var t = e.changedTouches && e.changedTouches[0], s = sw; sw = null;
    if (!s || !t || !pf) return;
    var dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (s.btn) return;
    if (s.link && Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - s.t < 500) { // renvoi « À relire » (lot D)
      if (state0()) window.location.assign(s.link.href);
      return;
    }
    if (s.img && Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - s.t < 500) { // toucher d'une image
      if (state0()) { lb.open(s.img.src, s.img.alt); dbg.imgTaps = (dbg.imgTaps || 0) + 1; }
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - s.t < 500) { // toucher d'un coin
      var r = document.getElementById('book').getBoundingClientRect();
      var px = (t.clientX - r.left) / r.width, py = (t.clientY - r.top) / r.height, cw = landscape ? 0.11 : 0.22;
      if (py < 0.16 || py > 0.84) {
        if (px > 1 - cw && state0()) { pf.flipNext(py < 0.5 ? 'top' : 'bottom'); dbg.cornerTaps = (dbg.cornerTaps || 0) + 1; }
        else if (px < cw && state0()) { pf.flipPrev(py < 0.5 ? 'top' : 'bottom'); dbg.cornerTaps = (dbg.cornerTaps || 0) + 1; }
      }
      return;
    }
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    setTimeout(function () {
      if (dbg.flips !== s.flips || dbg.state !== 'read') return; // déjà pris en charge
      if (dx < 0) pf.flipNext('bottom'); else pf.flipPrev('bottom');
      dbg.fallbackSwipes = (dbg.fallbackSwipes || 0) + 1;
    }, 60);
  }, { capture: true, passive: true });
  // souris : un clic sur une image l'ouvre ; l'appui n'entame pas de tourne
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest && e.target.closest('#book img.zoom')) e.stopPropagation();
    if (e.target.closest && e.target.closest('#book a.encart[href]')) e.stopPropagation(); // lien : pas de tourne
  }, true);
  document.addEventListener('click', function (e) {
    var im = e.target.closest && e.target.closest('#book img.zoom');
    // coin plié au survol (`fold_corner`) : l'appui sur l'image n'a pas entamé de tourne (mousedown stoppé)
    if (im && !lb.isOpen() && (state0() || dbg.state === 'fold_corner')) { lb.open(im.src, im.alt); dbg.imgClicks = (dbg.imgClicks || 0) + 1; }
  });
  // clavier : Entrée ou espace sur une image focalisable (vignettes de l'interview) l'ouvre, sans tourne
  document.addEventListener('keydown', function (e) {
    if (lb.isOpen() || (e.key !== 'Enter' && e.key !== ' ')) return;
    var im = document.activeElement;
    if (!im || !im.matches || !im.matches('#book img.zoom[tabindex]')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (state0()) lb.open(im.src, im.alt);
  }, true);
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('replay')) {
      unlock();
      maps.forEach(function (x) { if (x.m.owns(t)) { pauseMaps(); x.m.replay(); } });
    }
  });
  var lastW = 0, lastH = 0, timer = 0;
  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var w = window.innerWidth, h = window.innerHeight;
      if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 60) return; // barre d'adresse mobile : ignorée
      lastW = w; lastH = h; init(pf ? pf.getCurrentPageIndex() : 0);
    }, 180);
  }
  function start() {
    lastW = window.innerWidth; lastH = window.innerHeight;
    init(0);
    window.addEventListener('resize', onResize);
    stage.classList.add('ready');
  }
  // polices du journal chargées AVANT la mise en place (sinon `fit` mesurerait le texte dans la
  // police de repli) ; 4 s au plus, puis on part quand même
  var FACES = ["400 1em 'NVT Serif'", "italic 400 1em 'NVT Serif'", "700 1em 'NVT Serif'",
    "italic 700 1em 'NVT Serif'", "400 1em 'NVT Gothique'"];
  var started = false;
  function go() { if (!started) { started = true; start(); } }
  if (document.fonts && document.fonts.load) {
    Promise.all(FACES.map(function (f) { return document.fonts.load(f, 'Éé'); })).then(go, go);
    setTimeout(go, 4000);
  } else go();
})();
