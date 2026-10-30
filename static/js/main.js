(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (s, n) => (n ? (100 * s / n) : 0);
  const fmt = v => (v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1));
  const LANE_COLOR = { blocks: 'var(--blocks)', kitchen: 'var(--kitchen)', libero: 'var(--libero)' };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ lazy, in-view video playback
  // Any <video data-src> gets its source when it nears the viewport and pauses when it leaves.
  const videoObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) {
        if (!v.src && v.dataset.src) v.src = v.dataset.src;
        if (!v.dataset.manual) v.play().catch(() => {});
      } else if (!v.paused) {
        v.pause();
      }
    }
  }, { rootMargin: '200px 0px' });
  const watchVideos = root => $$('video[data-src]', root).forEach(v => videoObserver.observe(v));

  // ------------------------------------------------------------------ reveal on scroll
  const revealObserver = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
  }, { threshold: 0.12 });
  $$('.reveal').forEach(el => revealObserver.observe(el));

  // ------------------------------------------------------------------ nav
  const nav = $('#nav');
  const hero = $('#top');
  new IntersectionObserver(([e]) => nav.classList.toggle('show', !e.isIntersecting), { threshold: 0.08 }).observe(hero);
  const navLinks = $$('.nav-links a');
  const sectionObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach(a => { const s = $(a.getAttribute('href')); if (s) sectionObserver.observe(s); });

  // ------------------------------------------------------------------ count-up stats
  const countObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      countObserver.unobserve(e.target);
      const el = e.target;
      const to = parseFloat(el.dataset.count);
      const dec = +(el.dataset.decimals || 0);
      const suffix = el.dataset.suffix || '';
      const show = v => el.textContent = (el.dataset.sep ? Math.round(v).toLocaleString('en-US') : v.toFixed(dec)) + suffix;
      if (reduceMotion) { show(to); continue; }
      const t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / 1400);
        show(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  $$('[data-count]').forEach(el => countObserver.observe(el));

  // ------------------------------------------------------------------ BibTeX
  $('#copy-bib').addEventListener('click', async e => {
    try { await navigator.clipboard.writeText($('#bibtex').textContent); e.target.textContent = 'Copied'; }
    catch { e.target.textContent = 'Select & copy'; }
    setTimeout(() => (e.target.textContent = 'Copy'), 1600);
  });

  // ------------------------------------------------------------------ user study bars
  const STUDY = [
    { title: 'Usability (SUS)', hint: 'higher is better', rows: [['GenSim', 52.5, 9.3], ['Cursor', 68.8, 7.8], ['RoboCommons', 83.4, 6.9]] },
    { title: 'Workload (NASA-TLX)', hint: 'lower is better', rows: [['GenSim', 41.8, 9.0], ['Cursor', 36.7, 10.4], ['RoboCommons', 18.6, 7.7]] },
    { title: 'Preferred overall', hint: 'share of participants', rows: [['GenSim', 8], ['Cursor', 23], ['RoboCommons', 69]], unit: '%' },
  ];
  const bars = $('#study-bars');
  bars.innerHTML = STUDY.map(g => `
    <div class="bar-group"><h4>${g.title}<span>${g.hint}</span></h4>
      ${g.rows.map(([name, v, ci]) => `
        <div class="brow ${name === 'RoboCommons' ? 'us' : ''}"><span>${name}</span>
          <div class="track">
            ${ci ? `<i class="ci" style="left:${v - ci}%;width:${2 * ci}%"></i>` : ''}
            <div class="fill" data-w="${v}">${v}${g.unit || ''}${ci ? ` <small style="opacity:.7;font-weight:400">&nbsp;±${ci}</small>` : ''}</div>
          </div></div>`).join('')}
    </div>`).join('');
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    $$('.fill', bars).forEach(f => (f.style.width = f.dataset.w + '%'));
    obs.disconnect();
  }, { threshold: 0.3 }).observe(bars);

  // ------------------------------------------------------------------ data-driven sections
  const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json(); });
  Promise.all([getJSON('static/data/tasks.json'), getJSON('static/data/hero.json'), getJSON('static/data/explorer.json')])
    .then(([data, heroClips, explorer]) => {
      buildMosaic(heroClips);
      const byId = Object.fromEntries(data.tasks.map(t => [t.id, t]));
      buildPlaceholder(data);
      buildDemo(data, byId);
      buildFrameworks(data, byId);
      buildRepository(data, byId);
      buildExplorer(explorer);
      buildLadder(byId);
    })
    .catch(err => {
      console.error(err);
      $('#task-grid').innerHTML = '<p class="empty">Could not load task data. Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>) rather than opening the file directly.</p>';
    });

  // ------------------------------------------------------------------ hero mosaic
  function buildMosaic(clips) {
    const m = $('#mosaic');
    if (!clips.length) return;
    const cols = innerWidth < 680 ? 4 : innerWidth < 980 ? 6 : 8;
    const rows = Math.ceil((innerHeight * 1.15) / ((innerWidth * 1.16) / cols)) + 1;
    const n = cols * rows;
    const order = [...clips].sort(() => Math.random() - 0.5);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const v = document.createElement('video');
      Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: !reduceMotion, preload: 'auto' });
      v.setAttribute('muted', '');
      v.src = order[i % order.length];
      // Stagger start times so the repeats don't play in lockstep.
      v.addEventListener('loadedmetadata', () => { v.currentTime = Math.random() * (v.duration || 1); }, { once: true });
      tile.appendChild(v);
      frag.appendChild(tile);
    }
    m.appendChild(frag);
    requestAnimationFrame(() => m.classList.add('ready'));
    new IntersectionObserver(([e]) => $$('video', m).forEach(v => (e.isIntersecting && !reduceMotion ? v.play().catch(() => {}) : v.pause())))
      .observe(hero);
  }

  function buildPlaceholder(data) {
    const g = $('#vp-grid');
    if (!g) return;
    const picks = data.tasks.filter((_, i) => i % 9 === 0).slice(0, 24);
    g.innerHTML = picks.map(t => `<img src="static/img/tasks/${t.id}/goal.jpg" alt="" loading="lazy">`).join('');
  }

  // ------------------------------------------------------------------ shared bits
  const famName = (data, f) => data.families[f];
  const polName = (data, p) => data.policies[p] || p;

  function clipFigure(data, t, kind, opts = {}) {
    const c = t.clips[kind];
    if (!c) return '';
    const ok = kind === 'success';
    return `<figure class="shot ${opts.cls || ''}">
      <video data-src="${c.src}" muted loop playsinline preload="none" poster="static/img/tasks/${t.id}/initial.jpg"></video>
      <figcaption>Rollout</figcaption>
      <div class="meta"><span><span class="${ok ? 'pill-ok' : 'pill-no'}">${ok ? 'Success' : 'Failure'}</span>&nbsp; ${esc(polName(data, c.policy))}</span>
      ${c.speed > 1.05 ? `<span class="speed">${c.speed.toFixed(1)}×</span>` : ''}</div>
    </figure>`;
  }

  // ------------------------------------------------------------------ example generations
  const DEMO = ['K065', 'B032', 'L061', 'K057', 'B040', 'L057', 'K037'];
  function buildDemo(data, byId) {
    const tabs = $('#demo-tabs');
    const body = $('#demo-body');
    const list = DEMO.map(id => byId[id]).filter(Boolean);
    tabs.innerHTML = list.map((t, i) => `<button class="demo-tab" role="tab" aria-selected="${i === 0}" data-id="${t.id}" style="--c:${LANE_COLOR[t.lane]}"><span class="lane-dot"></span>${esc(t.instruction)}</button>`).join('');
    let typing;
    const show = id => {
      const t = byId[id];
      $$('.demo-tab', tabs).forEach(b => b.setAttribute('aria-selected', b.dataset.id === id));
      const kind = t.clips.success ? 'success' : 'failure';
      body.innerHTML = `
        <div class="demo-text">
          <div><div class="field-l">Request <span class="lane-dot" style="--c:${LANE_COLOR[t.lane]}"></span>${esc(data.lanes[t.lane].label)}</div><p class="prompt" id="demo-prompt"></p></div>
          <div><div class="field-l">Policy instruction</div><span class="instr">${esc(t.instruction)}</span></div>
          <div><div class="field-l">Generated success predicate G</div><p class="crit">${esc(t.criterion)}</p></div>
          <div><div class="field-l">Validation</div><div class="checks">${['compiles', 'runs in sim', 'settles stably', 'collision-free', 'IK-reachable', 'G(initial) = 0', 'G(goal) = 1'].map(c => `<span class="check">${c}</span>`).join('')}</div></div>
        </div>
        <div class="demo-media">
          <div class="pair">
            <figure class="shot"><img src="static/img/tasks/${t.id}/initial.jpg" alt="Initial state of ${esc(t.id)}"><figcaption>Initial state</figcaption></figure>
            <figure class="shot"><img src="static/img/tasks/${t.id}/goal.jpg" alt="Verified goal state of ${esc(t.id)}"><figcaption>Verified goal</figcaption></figure>
          </div>
          ${clipFigure(data, t, kind, { cls: 'shot-wide' })}
        </div>`;
      watchVideos(body);
      const p = $('#demo-prompt');
      const text = t.prompt.charAt(0).toUpperCase() + t.prompt.slice(1);
      clearInterval(typing);
      if (reduceMotion) { p.textContent = `“${text}”`; return; }
      let i = 0;
      p.innerHTML = '“<span class="caret"></span>';
      typing = setInterval(() => {
        i = Math.min(text.length, i + 2);
        p.innerHTML = '“' + esc(text.slice(0, i)) + (i < text.length ? '<span class="caret"></span>' : '”');
        if (i >= text.length) clearInterval(typing);
      }, 18);
    };
    tabs.addEventListener('click', e => { const b = e.target.closest('.demo-tab'); if (b) show(b.dataset.id); });
    show(list[0].id);
  }

  // ------------------------------------------------------------------ frameworks
  const FW = [
    { lane: 'kitchen', name: 'MolmoSpaces', sub: 'Kitchen', hero: 'K004', strip: ['K037', 'K057', 'K091', 'K049'],
      text: 'Full procedurally generated kitchens with articulated fixtures. RoboCommons uses the framework\'s own occupancy-map robot placement and IK reachability checks.' },
    { lane: 'libero', name: 'LIBERO', sub: 'Tabletop & kitchen scenes', hero: 'L061', strip: ['L009', 'L039', 'L057', 'L079'],
      text: 'Tasks compile to native BDDL scene definitions and run in the standard LIBERO / robosuite evaluation loop.' },
    { lane: 'blocks', name: 'RoboEval', sub: 'Blocks', hero: 'B061', strip: ['B032', 'B015', 'B097', 'B040'],
      text: 'A structured tabletop with colored and numbered cubes and goal patches, suited to precise spatial and semantic predicates.' },
  ];
  function buildFrameworks(data, byId) {
    const lanePolicies = l => [...new Set(data.tasks.filter(t => t.lane === l).flatMap(t => Object.keys(t.rates)))];
    $('#fw-grid').innerHTML = FW.map(f => {
      const t = byId[f.hero];
      const c = t.clips.success || t.clips.failure;
      const pols = lanePolicies(f.lane);
      const n = data.tasks.filter(x => x.lane === f.lane).length;
      return `<article class="fw reveal">
        <div class="fw-media"><video data-src="${c.src}" poster="static/img/tasks/${t.id}/initial.jpg" muted loop playsinline preload="none"></video>
          <span class="badge">“${esc(t.instruction)}”</span></div>
        <div class="fw-body">
          <h3><span class="lane-dot" style="--c:${LANE_COLOR[f.lane]}"></span>${f.name} <span class="muted" style="font-size:15px;font-weight:500">${f.sub}</span></h3>
          <p>${f.text}</p>
          <div class="fw-meta"><span>${n} tasks</span><span>${pols.length} policies</span>${pols.map(p => `<span>${esc(polName(data, p))}</span>`).join('')}</div>
        </div>
        <div class="fw-strip">${f.strip.map(id => `<img src="static/img/tasks/${id}/goal.jpg" alt="Goal render of ${id}" loading="lazy">`).join('')}</div>
      </article>`;
    }).join('');
    $$('#fw-grid .reveal').forEach(el => revealObserver.observe(el));
    watchVideos($('#fw-grid'));
  }

  // ------------------------------------------------------------------ repository
  function buildRepository(data, byId) {
    const state = { lane: 'all', family: 'all', q: '', sort: 'featured', shown: 24 };
    const laneChips = $('#lane-chips');
    const famChips = $('#family-chips');
    const grid = $('#task-grid');
    const more = $('#more');

    const countBy = (key, val) => data.tasks.filter(t => t[key] === val).length;
    laneChips.innerHTML = `<button class="chip" data-lane="all" aria-pressed="true">All frameworks <small>${data.tasks.length}</small></button>` +
      Object.entries(data.lanes).map(([k, l]) => `<button class="chip" data-lane="${k}" aria-pressed="false"><span class="lane-dot" style="--c:${LANE_COLOR[k]}"></span>${esc(l.label)} <small>${countBy('lane', k)}</small></button>`).join('');
    famChips.innerHTML = `<button class="chip" data-family="all" aria-pressed="true">All families</button>` +
      Object.entries(data.families).map(([k, n]) => `<button class="chip" data-family="${k}" aria-pressed="false">${esc(n)}</button>`).join('');

    const filtered = () => {
      const q = state.q.trim().toLowerCase();
      let list = data.tasks.filter(t => (state.lane === 'all' || t.lane === state.lane) &&
        (state.family === 'all' || t.family === state.family) &&
        (!q || (t.instruction + ' ' + t.prompt + ' ' + t.id).toLowerCase().includes(q)));
      if (state.sort === 'featured') list = featured(list);
      if (state.sort === 'best') list = [...list].sort((a, b) => b.overall - a.overall);
      if (state.sort === 'worst') list = [...list].sort((a, b) => a.overall - b.overall);
      return list;
    };

    // Featured: tasks some policy solves first, then the rest; frameworks and families interleaved.
    const featured = list => {
      const rank = t => (t.clips.success ? 0 : 1);
      const buckets = {};
      for (const t of [...list].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))) {
        const k = rank(t) + t.lane;
        (buckets[k] = buckets[k] || []).push(t);
      }
      const out = [];
      for (const r of [0, 1]) {
        const lanes = ['kitchen', 'libero', 'blocks'].map(l => buckets[r + l] || []);
        // spread families inside each lane so neighbors differ
        lanes.forEach((arr, i) => { lanes[i] = arr.sort((a, b) => (a.id.slice(1) % 7) - (b.id.slice(1) % 7) || a.id.localeCompare(b.id)); });
        while (lanes.some(a => a.length)) lanes.forEach(a => a.length && out.push(a.shift()));
      }
      return out;
    };

    const card = t => {
      const rates = Object.entries(t.rates);
      const clip = t.clips.success || t.clips.failure;
      return `<button class="task" type="button" data-id="${t.id}" aria-label="${esc(t.id)}: ${esc(t.instruction)}">
        <div class="task-media">
          <img src="static/img/tasks/${t.id}/goal.jpg" alt="" loading="lazy">
          ${clip ? `<video data-hover="${clip.src}" muted loop playsinline preload="none"></video>` : ''}
          <span class="task-id"><span class="lane-dot" style="--c:${LANE_COLOR[t.lane]}"></span>${t.id}</span>
          <span class="task-fam">${esc(famName(data, t.family))}</span>
          ${t.caveat ? '<span class="task-caveat" title="See note">!</span>' : ''}
        </div>
        <div class="task-body">
          <p class="task-instr">${esc(t.instruction)}</p>
          <div class="task-rates" aria-hidden="true">${rates.map(([p, [s, n]]) => `<i class="${s ? 'hit' : ''}" style="height:${Math.max(8, pct(s, n))}%" title="${esc(polName(data, p))}: ${s}/${n}"></i>`).join('')}</div>
          <div class="task-foot"><span>${rates.length} policies</span><span>overall <b>${fmt(100 * t.overall)}%</b></span></div>
        </div>
      </button>`;
    };

    const render = () => {
      const list = filtered();
      $('#task-count').textContent = `${list.length} task${list.length === 1 ? '' : 's'}`;
      grid.innerHTML = list.length ? list.slice(0, state.shown).map(card).join('') : '<p class="empty">No tasks match these filters.</p>';
      more.hidden = list.length <= state.shown;
      more.textContent = `Show more tasks (${list.length - state.shown} remaining)`;
    };

    const press = (box, attr, val) => $$('.chip', box).forEach(c => c.setAttribute('aria-pressed', c.dataset[attr] === val));
    laneChips.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.lane = c.dataset.lane; state.shown = 24; press(laneChips, 'lane', state.lane); render(); });
    famChips.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.family = c.dataset.family; state.shown = 24; press(famChips, 'family', state.family); render(); });
    let qTimer;
    $('#search').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; state.shown = 24; render(); }, 120); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    more.addEventListener('click', () => { state.shown += 24; render(); });

    // hover-to-play
    grid.addEventListener('pointerover', e => {
      const c = e.target.closest('.task');
      if (!c || c.classList.contains('playing')) return;
      const v = $('video', c);
      if (!v) return;
      if (!v.src) v.src = v.dataset.hover;
      v.play().then(() => c.classList.add('playing')).catch(() => {});
    });
    grid.addEventListener('pointerout', e => {
      const c = e.target.closest('.task');
      if (!c || c.contains(e.relatedTarget)) return;
      c.classList.remove('playing');
      const v = $('video', c);
      if (v) v.pause();
    });
    grid.addEventListener('click', e => { const c = e.target.closest('.task'); if (c) openTask(data, byId, c.dataset.id); });

    render();
  }

  // ------------------------------------------------------------------ task modal
  const modal = $('#modal');
  $('#modal-x').addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  modal.addEventListener('close', () => $$('video', modal).forEach(v => v.pause()));

  function openTask(data, byId, id) {
    const t = byId[id];
    const rates = Object.entries(t.rates).sort((a, b) => pct(b[1][0], b[1][1]) - pct(a[1][0], a[1][1]));
    const sibs = t.members.filter(m => byId[m]);
    $('#modal-body').innerHTML = `
      <div class="m-media">
        <figure class="shot"><img src="static/img/tasks/${t.id}/initial.jpg" alt="Initial state"><figcaption>Initial state</figcaption></figure>
        <figure class="shot"><img src="static/img/tasks/${t.id}/goal.jpg" alt="Verified goal"><figcaption>Verified goal</figcaption></figure>
      </div>
      <div class="m-body">
        <div>
          <div class="m-tags">
            <span class="m-tag"><span class="lane-dot" style="--c:${LANE_COLOR[t.lane]}"></span>${esc(data.lanes[t.lane].label)}</span>
            <span class="m-tag">${esc(famName(data, t.family))}</span>
            <span class="m-tag" style="font-family:var(--mono)">${t.id}</span>
          </div>
          <h3 id="m-title">${esc(t.instruction)}</h3>
          ${t.prompt ? `<div class="m-sec"><div class="field-l">Generator request</div><p class="m-prompt">“${esc(t.prompt)}”</p></div>` : ''}
          ${t.criterion ? `<div class="m-sec"><div class="field-l">Success predicate</div><p class="crit">${esc(t.criterion)}</p></div>` : ''}
          ${t.assets ? `<div class="m-sec"><div class="field-l">Assets</div><p>${esc(t.assets)}</p></div>` : ''}
          ${t.caveat ? `<p class="m-caveat"><b>Note.</b> ${esc(t.caveat)}</p>` : ''}
        </div>
        <div>
          <div class="field-l">Success by policy</div>
          <div class="rate-rows">${rates.map(([p, [s, n]]) => `<div class="rate-row"><span>${esc(polName(data, p))}</span><span class="bar"><i style="width:0" data-w="${pct(s, n)}"></i></span><span class="v">${s}/${n}</span></div>`).join('')}</div>
          <div class="m-sec"><div class="field-l">Rollouts</div><div class="m-videos">${clipFigure(data, t, 'success', { cls: 'shot-wide' })}${clipFigure(data, t, 'failure', { cls: 'shot-wide' })}</div></div>
          ${sibs.length > 1 ? `<div class="m-sec"><div class="field-l">Linked variations · ${esc(t.probe)}</div><div class="siblings">${sibs.map(m => {
            const s = byId[m];
            return `<button class="sib ${m === t.id ? 'cur' : ''}" type="button" data-id="${m}"><img src="static/img/tasks/${m}/goal.jpg" alt="" loading="lazy"><span><b>${m}</b>${fmt(100 * s.overall)}%</span></button>`;
          }).join('')}</div></div>` : ''}
        </div>
      </div>`;
    $$('.sib', modal).forEach(b => b.addEventListener('click', () => openTask(data, byId, b.dataset.id)));
    if (!modal.open) modal.showModal();
    $('.modal-card', modal).scrollTop = 0;
    $$('video[data-src]', modal).forEach(v => { v.src = v.dataset.src; v.play().catch(() => {}); });
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.rate-row i', modal).forEach(i => (i.style.width = i.dataset.w + '%'))));
  }

  // ------------------------------------------------------------------ results explorer (Table II)
  const ASPECT = { blocks: '32 / 9', kitchen: '640 / 368', libero: '1 / 1' };
  function buildExplorer(ex) {
    const state = { domain: 'blocks', policy: 'molmoact2', family: 3 };
    const tabs = $('#exp-domains');
    const table = $('#exp-table');
    const detail = $('#exp-detail');
    const cap = table.querySelector('caption').outerHTML;
    tabs.innerHTML = ex.domains.map(d => `<button role="tab" data-d="${d.id}" aria-selected="${d.id === state.domain}"><span class="lane-dot" style="--c:${LANE_COLOR[d.id]}"></span>${esc(d.label)}</button>`).join('');

    const renderTable = () => {
      const d = ex.domains.find(x => x.id === state.domain);
      const max = Math.max(...d.policies.flatMap(p => p.values.slice(0, 5).map(v => v.rate)), 1);
      table.innerHTML = cap + `<thead><tr><th></th>${ex.families.map(f => `<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>` +
        d.policies.map(p => `<tr class="${p.id === state.policy ? 'sel' : ''}"><th class="pol" scope="row">${esc(p.label)}</th>${p.values.map((v, fi) => {
          const w = Math.min(1, Math.sqrt(v.rate / max)) * 0.92;
          const pressed = p.id === state.policy && fi === state.family;
          return `<td class="${fi === 5 ? 'overall' : ''}"><button type="button" data-p="${p.id}" data-f="${fi}" aria-pressed="${pressed}" style="--v:${w.toFixed(3)}" class="${w > 0.55 ? 'dark-ink' : ''}" aria-label="${esc(p.label)}, ${esc(ex.families[fi])}: ${v.rate}% ± ${v.se}">${v.rate.toFixed(1)}<small>± ${v.se.toFixed(1)}</small></button></td>`;
        }).join('')}</tr>`).join('') + '</tbody>';
    };

    const renderDetail = () => {
      const d = ex.domains.find(x => x.id === state.domain);
      const p = d.policies.find(x => x.id === state.policy) || d.policies[0];
      const v = p.values[state.family];
      let tasks = ex.tasks.filter(t => t.domain === state.domain && (state.family === 5 || t.family === state.family));
      if (state.family === 5) tasks = [0, 1, 2, 3, 4].map(f => tasks.find(t => t.family === f)).filter(Boolean).slice(0, 3);
      detail.innerHTML = `
        <div class="exp-head"><h3>${esc(p.label)} · ${esc(ex.families[state.family])}: ${v.rate.toFixed(1)}%</h3>
        <p>Example tasks from this cell. ${esc(p.label)}'s rollouts are outlined; other policies on the same task are shown for comparison.</p></div>
        ${tasks.map(t => {
          const vids = [...t.videos].sort((a, b) => (b.policy === p.id) - (a.policy === p.id) || (b.outcome === 'Success') - (a.outcome === 'Success')).slice(0, 6);
          const sc = t.scores[p.id];
          return `<div class="exp-task">
            <div class="exp-task-h"><q>${esc(t.instruction)}</q><span>${t.id}${sc ? ` · ${esc(p.label)} ${sc.successes}/${sc.episodes}` : ''}</span></div>
            <div class="exp-clips" style="${state.domain === 'blocks' ? 'grid-template-columns:repeat(auto-fill,minmax(300px,1fr))' : ''}">${vids.map(c => `
              <figure class="exp-clip ${c.policy === p.id ? 'focus' : ''}">
                <div class="shot" style="aspect-ratio:${ASPECT[state.domain]}"><video data-src="${c.video}" poster="${c.poster}" muted loop playsinline preload="none"></video></div>
                <figcaption><span>${esc(c.policyLabel)}</span><span class="${c.outcome === 'Success' ? 'pill-ok' : 'pill-no'}">${esc(c.outcome)}</span></figcaption>
              </figure>`).join('')}</div>
          </div>`;
        }).join('') || '<p class="exp-head">No example rollouts for this cell.</p>'}`;
      watchVideos(detail);
    };

    tabs.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.domain = b.dataset.d;
      const d = ex.domains.find(x => x.id === state.domain);
      if (!d.policies.some(p => p.id === state.policy)) state.policy = d.policies[0].id;
      $$('button', tabs).forEach(x => x.setAttribute('aria-selected', x === b));
      renderTable(); renderDetail();
    });
    table.addEventListener('click', e => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      state.policy = b.dataset.p; state.family = +b.dataset.f;
      renderTable(); renderDetail();
    });
    renderTable(); renderDetail();
  }

  // ------------------------------------------------------------------ clutter ladder
  function buildLadder(byId) {
    const rungs = [['K065', 0], ['K066', 2], ['K067', 4]];
    const pol = 'molmobot';
    $('#ladder').innerHTML = rungs.map(([id, n]) => {
      const t = byId[id];
      const [s, eps] = t.rates[pol];
      const c = t.clips.success;
      return `<div class="rung">
        <figure class="shot"><video data-src="${c.src}" poster="static/img/tasks/${id}/initial.jpg" muted loop playsinline preload="none"></video><figcaption>${n} distractors</figcaption></figure>
        <div class="rung-b"><h4>“set the teacup on the tray” <span>${id}</span></h4>
          <div class="rung-v"><b>${Math.round(pct(s, eps))}%</b><span>MolmoBot, ${s} / ${eps} episodes</span></div>
          <div class="dots">${Array.from({ length: eps }, (_, i) => `<i class="${i < s ? 'on' : ''}"></i>`).join('')}</div>
        </div></div>`;
    }).join('') + '<p class="ladder-cap">Clutter ladder in MolmoSpaces: the goal is held fixed while distractors are added. Shown: rollouts of MolmoBot, the strongest kitchen policy.</p>';
    watchVideos($('#ladder'));
  }

  watchVideos(document);
})();
