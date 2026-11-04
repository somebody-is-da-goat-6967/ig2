(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    kids.forEach(k => n.append(k));
    return n;
  };
  const rand = n => Math.floor(Math.random() * n);
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const thumb = m => (m.type === 'video' ? (m.poster || null) : m.src);

  const S = {
    all: [], view: [], shown: 0, batch: 72,
    cur: -1, randomMode: false, history: [], timer: null, playing: false,
    z: { s: 1, x: 0, y: 0 }, hero: null,
  };

  // ---------- load ----------
  async function load() {
    let db = { posts: [] };
    try {
      const r = await fetch('data/posts.json', { cache: 'no-cache' });
      if (r.ok) db = await r.json();
    } catch (_) { /* empty state */ }

    const user = db.username || 'archive';
    document.title = `@${user} archive`;
    $('#title').textContent = `@${user}`;
    const p = db.profile || {};
    const bits = [];
    if (p.full_name) bits.push(p.full_name);
    bits.push(`${db.posts.length} posts archived`);
    if (db.updated) bits.push(`updated ${fmtDate(db.updated)}`);
    $('#sub').textContent = bits.join(' · ');
    $('#sub').title = p.biography || '';

    S.all = db.posts.flatMap(post =>
      post.media.map((m, i) => ({ ...m, post, idx: i, n: post.media.length, key: `${post.shortcode}_${i}` })));

    // restore UI prefs
    try {
      const sz = localStorage.getItem('size'); if (sz) $('#size').value = sz;
    } catch (_) {}
    document.documentElement.style.setProperty('--size', $('#size').value + 'px');

    applyFilters();
    const m = location.hash.match(/#v=([\w-]+)/);
    if (m) { const i = S.view.findIndex(x => x.key === m[1]); if (i >= 0) openLB(i); }
  }

  // ---------- filter / sort / grid ----------
  function applyFilters() {
    const q = $('#q').value.trim().toLowerCase();
    const type = $('#type').value;
    const sort = $('#sort').value;
    let v = S.all.filter(it =>
      (type === 'all' || it.type === type) &&
      (!q || (it.post.caption || '').toLowerCase().includes(q)));
    if (sort === 'new') v.sort((a, b) => b.post.date - a.post.date || a.idx - b.idx);
    else if (sort === 'old') v.sort((a, b) => a.post.date - b.post.date || a.idx - b.idx);
    else if (sort === 'likes') v.sort((a, b) => (b.post.likes || 0) - (a.post.likes || 0));
    else v = shuffle(v);
    S.view = v;
    S.shown = 0;
    $('#grid').replaceChildren();
    $('#count').textContent = `${v.length} item${v.length === 1 ? '' : 's'}`;
    $('#empty').hidden = S.all.length > 0;
    renderMore();
    pickHero();
  }

  function tile(it, i) {
    const t = thumb(it);
    const b = el('button', { className: 'tile', title: (it.post.caption || '').slice(0, 120) });
    if (t) b.append(el('img', { src: t, loading: 'lazy', decoding: 'async', alt: '' }));
    else b.append(el('video', { src: it.src + '#t=0.1', preload: 'metadata', muted: true, playsInline: true }));
    if (it.type === 'video') b.append(el('span', { className: 'badge' }, '▶ video'));
    else if (it.n > 1) b.append(el('span', { className: 'badge' }, `${it.idx + 1}/${it.n}`));
    b.addEventListener('click', () => openLB(i));
    return b;
  }

  function renderMore() {
    const grid = $('#grid');
    const end = Math.min(S.shown + S.batch, S.view.length);
    const frag = document.createDocumentFragment();
    for (let i = S.shown; i < end; i++) frag.append(tile(S.view[i], i));
    grid.append(frag);
    S.shown = end;
  }
  new IntersectionObserver(es => { if (es[0].isIntersecting && S.shown < S.view.length) renderMore(); },
    { rootMargin: '900px' }).observe($('#sentinel'));

  // ---------- hero (random pick on every load) ----------
  function pickHero() {
    if (!S.view.length) { $('#hero').hidden = true; return; }
    let it;
    do { it = S.view[rand(S.view.length)]; } while (S.view.length > 1 && S.hero === it);
    S.hero = it;
    const box = $('#hero-media');
    box.replaceChildren(it.type === 'video'
      ? el('video', { src: it.src, poster: it.poster || '', controls: true, muted: true, loop: true, playsInline: true })
      : el('img', { src: it.src, alt: '' }));
    $('#hero-caption').textContent = it.post.caption || '(no caption)';
    $('#hero-meta').textContent = `${fmtDate(it.post.date)} · ${it.post.likes ?? 0} likes`;
    $('#hero').hidden = false;
  }
  $('#hero-again').onclick = pickHero;
  $('#hero-open').onclick = () => S.hero && openLB(S.view.indexOf(S.hero));
  $('#hero-media').addEventListener('click', e => {
    if (e.target.tagName === 'IMG') openLB(S.view.indexOf(S.hero));
  });

  // ---------- lightbox ----------
  const LB = $('#lightbox'), stage = $('#lb-stage');
  let mediaEl = null;

  function openLB(i) {
    if (i < 0 || i >= S.view.length) return;
    LB.hidden = false;
    document.body.style.overflow = 'hidden';
    S.history = [];
    show(i, false);
  }

  function closeLB() {
    stopPlay();
    LB.hidden = true;
    document.body.style.overflow = '';
    stage.replaceChildren();
    mediaEl = null;
    if (document.fullscreenElement) document.exitFullscreen();
    history.replaceState(null, '', location.pathname + location.search);
  }

  function resetZoom() { S.z = { s: 1, x: 0, y: 0 }; applyZoom(); }
  function applyZoom() {
    if (!mediaEl || mediaEl.tagName !== 'IMG') return;
    const { s, x, y } = S.z;
    mediaEl.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    stage.classList.toggle('zoomed', s > 1);
    $('#lb-zoom-reset').textContent = Math.round(s * 100) + '%';
  }

  function show(i, pushHistory = true) {
    if (pushHistory && S.cur >= 0) S.history.push(S.cur);
    S.cur = i;
    const it = S.view[i];
    stage.replaceChildren();
    S.z = { s: 1, x: 0, y: 0 };
    if (it.type === 'video') {
      mediaEl = el('video', { src: it.src, poster: it.poster || '', controls: true, autoplay: true, playsInline: true });
      mediaEl.addEventListener('ended', () => { if (S.playing) next(); });
    } else {
      mediaEl = el('img', { src: it.src, alt: it.post.caption || '', draggable: false });
    }
    stage.append(mediaEl);
    $('#lb-zoom-reset').textContent = '100%';
    $('#lb-count').textContent =
      `${i + 1} / ${S.view.length}` + (it.n > 1 ? ` · part ${it.idx + 1} of ${it.n}` : '');
    $('#lb-caption').textContent = it.post.caption || '(no caption)';
    $('#lb-meta').textContent = `${fmtDate(it.post.date)} · ${it.post.likes ?? 0} likes`;
    $('#lb-origin').href = it.post.url;
    const dl = $('#lb-download'); dl.href = it.src; dl.download = it.src.split('/').pop();
    history.replaceState(null, '', '#v=' + it.key);
    buildStrip(i);
    preload(i);
    if (S.playing) schedule();
  }

  function buildStrip(i) {
    const strip = $('#lb-strip');
    strip.replaceChildren();
    const from = Math.max(0, i - 8), to = Math.min(S.view.length, i + 9);
    for (let k = from; k < to; k++) {
      const t = thumb(S.view[k]);
      const b = el('button', { className: k === i ? 'on' : '' });
      if (t) b.append(el('img', { src: t, loading: 'lazy', alt: '' }));
      b.onclick = () => show(k);
      strip.append(b);
    }
  }

  function preload(i) {
    [i + 1, i - 1].forEach(k => {
      const it = S.view[(k + S.view.length) % S.view.length];
      if (it && it.type === 'image') new Image().src = it.src;
    });
  }

  function next() {
    if (!S.view.length) return;
    if (S.randomMode && S.view.length > 1) {
      let j; do { j = rand(S.view.length); } while (j === S.cur);
      show(j);
    } else show((S.cur + 1) % S.view.length);
  }
  function prev() {
    if (S.randomMode && S.history.length) show(S.history.pop(), false);
    else show((S.cur - 1 + S.view.length) % S.view.length, false);
  }

  function setRandomMode(on) {
    S.randomMode = on;
    $('#lb-shuffle').setAttribute('aria-pressed', on);
  }

  // slideshow
  function schedule() {
    clearTimeout(S.timer);
    const it = S.view[S.cur];
    if (it && it.type === 'video') return; // advances on 'ended'
    S.timer = setTimeout(next, 4000);
  }
  function startPlay() { S.playing = true; $('#lb-play').textContent = 'Pause'; schedule(); }
  function stopPlay() { S.playing = false; clearTimeout(S.timer); $('#lb-play').textContent = 'Play'; }
  const togglePlay = () => (S.playing ? stopPlay() : startPlay());

  // zoom
  function zoomBy(f, cx, cy) {
    if (!mediaEl || mediaEl.tagName !== 'IMG') return;
    const r = stage.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2);
    const py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
    const ns = Math.min(8, Math.max(1, S.z.s * f));
    const k = ns / S.z.s;
    S.z.x = px - (px - S.z.x) * k;
    S.z.y = py - (py - S.z.y) * k;
    S.z.s = ns;
    if (ns === 1) { S.z.x = 0; S.z.y = 0; }
    applyZoom();
  }

  stage.addEventListener('wheel', e => {
    if (!mediaEl || mediaEl.tagName !== 'IMG') return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  stage.addEventListener('dblclick', e => {
    if (!mediaEl || mediaEl.tagName !== 'IMG') return;
    if (S.z.s > 1) resetZoom(); else zoomBy(2.5, e.clientX, e.clientY);
  });

  // pointer gestures: pan (zoomed), swipe (not zoomed), pinch (two fingers)
  const ptrs = new Map();
  let startX = 0, startY = 0, pinchD = 0;
  stage.addEventListener('pointerdown', e => {
    S.downTarget = e.target; // pointer capture retargets the later click to the stage
    if (!mediaEl || mediaEl.tagName !== 'IMG') return;
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startX = e.clientX; startY = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
    if (S.z.s > 1) stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const prevP = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD) zoomBy(d / pinchD, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchD = d;
    } else if (S.z.s > 1) {
      S.z.x += e.clientX - prevP.x;
      S.z.y += e.clientY - prevP.y;
      applyZoom();
    }
  });
  const endPtr = e => {
    if (!ptrs.has(e.pointerId)) return;
    const wasSingle = ptrs.size === 1;
    ptrs.delete(e.pointerId);
    stage.classList.remove('dragging');
    pinchD = 0;
    if (wasSingle && S.z.s === 1) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) dx < 0 ? next() : prev();
    }
  };
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);

  // buttons
  $('#lb-close').onclick = closeLB;
  $('#lb-next').onclick = next;
  $('#lb-prev').onclick = prev;
  $('#lb-zoom-in').onclick = () => zoomBy(1.4);
  $('#lb-zoom-out').onclick = () => zoomBy(1 / 1.4);
  $('#lb-zoom-reset').onclick = resetZoom;
  $('#lb-info').onclick = () => {
    const p = $('#lb-panel');
    p.hidden = !p.hidden;
    LB.classList.toggle('info-open', !p.hidden);
  };
  $('#lb-play').onclick = togglePlay;
  $('#lb-shuffle').onclick = () => setRandomMode(!S.randomMode);
  $('#lb-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen(); else LB.requestFullscreen?.();
  };
  // close only when the press started on the empty backdrop, not on the image/video
  LB.addEventListener('click', e => { if (e.target === stage && S.downTarget === stage) closeLB(); });

  // header buttons
  function openRandom() {
    if (!S.view.length) return;
    setRandomMode(true);
    openLB(rand(S.view.length));
  }
  $('#btn-random').onclick = openRandom;
  $('#btn-slideshow').onclick = () => {
    if (!S.view.length) return;
    openLB(0); startPlay();
  };

  // keyboard
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (LB.hidden) { if (e.key === 'r' || e.key === 'R') openRandom(); return; }
    switch (e.key) {
      case 'Escape': closeLB(); break;
      case 'ArrowRight': next(); break;
      case 'ArrowLeft': prev(); break;
      case '+': case '=': zoomBy(1.4); break;
      case '-': zoomBy(1 / 1.4); break;
      case '0': resetZoom(); break;
      case 'f': case 'F': $('#lb-full').click(); break;
      case 'i': case 'I': $('#lb-info').click(); break;
      case 'd': case 'D': $('#lb-download').click(); break;
      case 'r': case 'R': setRandomMode(!S.randomMode); if (S.randomMode) next(); break;
      case ' ': e.preventDefault(); togglePlay(); break;
    }
  });

  // controls
  let qt;
  $('#q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(applyFilters, 180); });
  $('#type').onchange = applyFilters;
  $('#sort').onchange = applyFilters;
  $('#size').addEventListener('input', e => {
    document.documentElement.style.setProperty('--size', e.target.value + 'px');
    try { localStorage.setItem('size', e.target.value); } catch (_) {}
  });

  load();
})();
