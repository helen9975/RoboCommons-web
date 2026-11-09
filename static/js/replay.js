/* In-browser replay of a recorded task-generation run.
 *
 * Everything narrated comes from static/scene3d/scene.json (build_scene3d.py):
 * prompt, plan, stage timings, verdicts, generated code and every pose. Only
 * the in-between motion and the pace are animated. The whole view is a pure
 * function of timeline position, so scrubbing works in both directions. */
(function () {
  'use strict';

  const root = document.getElementById('rp');
  if (!root) return;
  const $ = s => root.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const VARIANTS = [
    { id: 'K065', label: '0 distractors' },
    { id: 'K066', label: '2 distractors' },
    { id: 'K067', label: '4 distractors' },
  ];
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const bounce = x => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const dur = s => (s < 1 ? '<1 s' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} m ${String(Math.round(s % 60)).padStart(2, '0')} s`);

  /* ---------------------------------------------------------- timeline */

  function buildTimeline(task) {
    const stage = id => task.stages.find(s => s.id === `orchestrator.${id}`).s;
    const phase = id => task.phases.find(p => p.id === id).s;
    const segs = [];
    let t = 0;
    const add = (id, seconds, real, step) => { segs.push({ id, t0: t, t1: t + seconds, real, step }); t += seconds; };
    add('prompt', Math.min(3.4, task.prompt.length * 0.026) + 0.3, 0, null);
    add('plan', 3.2, stage('task_interpreter'), 'interp');
    add('room', 3.2, stage('manifest_expander') + stage('asset_research'), 'assets');
    add('code', 1.2 + task.order.length * 1.05, stage('code_author'), 'code');
    add('intent', 1.0, stage('intent_gate'), 'intent');
    const scale = stage('validator') / task.phases.reduce((a, p) => a + p.s, 0);
    add('p1', 0.4, phase('phase1_compile') * scale, 'p1');
    add('p2', 1.0, phase('phase2_instantiate') * scale, 'p2');
    add('p3', 0.4, phase('phase3_runtime_reset') * scale, 'p3');
    add('p4', 2.6, phase('phase4_constraints') * scale, 'p4');
    add('p5', 3.6, phase('phase5_success_check') * scale, 'p5');
    add('p6', 3.6, phase('phase6_randomization') * scale, 'p6');
    add('done', 2.0, 0, 'done');
    const real = segs.reduce((a, s) => a + s.real, 0);
    let cum = 0;
    for (const s of segs) { s.realStart = cum * task.wall_s / real; cum += s.real; s.realEnd = cum * task.wall_s / real; }
    return { segs, duration: t, seg: id => segs.find(s => s.id === id) };
  }

  const segProgress = (seg, t) => clamp01((t - seg.t0) / (seg.t1 - seg.t0));

  /* ---------------------------------------------------------- side panel */

  // The five steps named in the explainer video; each row lights up while the
  // timeline segments it covers (`covers`, segment step ids) are playing.
  const STEPS = task => {
    const stage = re => task.stages.filter(s => re.test(s.id)).reduce((a, s) => a + s.s, 0);
    const phases = task.phases.map((p, i) => ({ id: `p${i + 1}`, label: p.label, s: p.s, sub: true, covers: [`p${i + 1}`] }));
    return [
      { id: 'describe', label: 'Describe', hint: 'interpret the prompt', s: stage(/task_interpreter$/), covers: ['interp'] },
      { id: 'ground', label: 'Ground', hint: 'resolve scene and assets', s: stage(/manifest_expander|asset_research/), covers: ['assets'] },
      { id: 'place', label: 'Place', hint: 'write the task program', s: stage(/code_author$/), covers: ['code'] },
      { id: 'verify', label: 'Verify', s: stage(/intent_gate|validator$/), covers: ['intent', ...phases.map(p => p.id)] },
      { id: 'intent', label: 'Consistent with the request', s: stage(/intent_gate$/), sub: true, covers: ['intent'] },
      ...phases,
      { id: 'share', label: 'Share', hint: 'commit to the repository', s: null, covers: ['done'] },
    ];
  };

  // The plans spell these either way: distance / distance_m, radius / radius_m.
  const distanceOf = p => (p.distance_m != null ? p.distance_m : p.distance);
  const radiusOf = p => (p.radius_m != null ? p.radius_m : p.radius);

  function declLine(d) {
    const p = d.params;
    if (d.kind === 'on_surface') return `on_surface(${p.props.join(', ')}, ${p.surface})`;
    if (d.kind === 'ring_around') return `ring_around(${p.props.join(', ')}, ${p.reference}, ${radiusOf(p)} m)`;
    return `${d.kind}(${p.prop}, ${p.reference}, ${p.direction}, ${distanceOf(p)} m)`;
  }

  const targetDistance = task => {
    const d = task.init_decls.find(x => distanceOf(x.params) != null);
    return d ? distanceOf(d.params) : null;
  };

  function detailHTML(id, task, ctx) {
    if (id === 'prompt') return '<p class="rp-d-title">Input</p><p class="rp-d-text">The natural-language request, the only task-specific input to the generator.</p>';
    if (id === 'plan') {
      const rows = task.assets.map(a => `<li><b>${esc(a.cls)}</b><span>× ${a.count}</span><em>${esc(a.role)}</em></li>`).join('');
      const decl = task.init_decls.map(d => `<div>${esc(declLine(d))}</div>`).join('');
      return `<p class="rp-d-title">Structured plan</p><ul class="rp-assets">${rows}</ul><div class="rp-code">${decl}</div>`;
    }
    if (id === 'room') {
      const from = src => task.assets.filter(a => a.source === src).map(a => a.cls).join(', ');
      return `<p class="rp-d-title">Scene</p><div class="rp-code"><div>preset: ${esc(task.preset)}</div><div>robot: ${esc(task.robot)}</div><div>prune_native_clutter: ${task.pruned}</div></div>
        <p class="rp-d-text"><b>From Objaverse:</b> ${esc(from('objaverse'))}<br><b>Already in the scene:</b> ${esc(from('scene'))}</p>`;
    }
    if (id === 'code') {
      const lines = task.order.map((o, i) => `<div data-line="${i}">place_on(${esc(o)}, counter, settle=True)</div>`).join('');
      return `<p class="rp-d-title">Generated task program</p><div class="rp-code rp-code-lines">${lines}</div>`;
    }
    if (id === 'intent') {
      return `<p class="rp-d-title">Intent check</p><p class="rp-d-text">The plan and program are checked against the request: every quantity it names must be provisioned, and the goal must not already hold at the start.</p>`;
    }
    if (id === 'p1' || id === 'p2' || id === 'p3') {
      return `<p class="rp-d-title">Validation</p><p class="rp-d-text">The program is compiled and instantiated in an isolated process, then stepped in simulation.</p>`;
    }
    if (id === 'p4') {
      const want = targetDistance(task);
      return `<p class="rp-d-title">Layout measured in simulation</p>
        <p class="rp-d-big">${(ctx.measured * 100).toFixed(1)}<small> cm</small></p>
        <p class="rp-d-text">tray to teacup, center to center${want != null ? `. The request specified ${Math.round(want * 100)} cm.` : '.'}</p>`;
    }
    if (id === 'p5') {
      return `<p class="rp-d-title">Generated success predicate</p><pre class="rp-pre">${esc(task.predicate.replace(/^ {4}/gm, ''))}</pre>
        <p class="rp-d-pass" data-pass>evaluates to true at the goal</p>`;
    }
    if (id === 'p6') {
      return `<p class="rp-d-title">Seeded resets</p><p class="rp-d-big"><span data-reset>1</span><small> / ${task.seeded.length}</small></p>
        <p class="rp-d-text">The ${task.seeded.length} seeded initial states delivered with the task. Evaluation then runs ${task.resets.length} episodes per policy, each from its own initial state.</p>`;
    }
    return ctx.doneHTML;
  }

  /* ---------------------------------------------------------- 3D */

  async function start3D() {
    const [THREE, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/environments/RoomEnvironment.js'),
    ]);

    const base = 'static/scene3d/';
    const [scene3d, buffer, tasksData] = await Promise.all([
      fetch(base + 'scene.json').then(r => r.json()),
      fetchWithProgress(base + 'geom.bin'),
      fetch('static/data/tasks.json').then(r => r.json()),
    ]);

    const canvas = $('.rp-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const NIGHT = new THREE.Color(0x070c12);
    scene.background = NIGHT;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;

    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 60);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 11;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.enablePan = false;
    // OrbitControls claims every touch and wheel event: keep the page scrollable
    // until someone actually grabs the canvas.
    canvas.style.touchAction = 'pan-y';
    controls.enableZoom = false;
    canvas.addEventListener('pointerdown', () => { controls.enableZoom = true; }, { capture: true });
    canvas.addEventListener('pointerleave', () => { controls.enableZoom = false; });

    scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a3f46, 1.25));
    const sun = new THREE.DirectionalLight(0xfff6ea, 2.7);
    sun.position.set(1.8, -1.6, 4.5);
    sun.target.position.set(-0.2, 0.4, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 9 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.012;
    scene.add(sun, sun.target);

    /* shared reveal shader: radial wipe, scan pulse, dollhouse cut-away */
    const [bmin, bmax] = scene3d.bounds;
    const roomC = new THREE.Vector2((bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2);
    const roomH = new THREE.Vector2((bmax[0] - bmin[0]) / 2, (bmax[1] - bmin[1]) / 2);
    const uni = {
      uReveal: { value: 0 },
      uPulse: { value: -1 },
      uCenter: { value: new THREE.Vector2(scene3d.counter[0] - 0.2, scene3d.counter[1] + 0.4) },
      uRoomC: { value: roomC },
      uRoomH: { value: roomH },
      uCam: { value: new THREE.Vector3() },
    };
    const patch = mat => {
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, uni);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vWorldP;
            uniform float uReveal; uniform float uPulse;
            uniform vec2 uCenter; uniform vec2 uRoomC; uniform vec2 uRoomH; uniform vec3 uCam;`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            float rD = distance(vWorldP.xy, uCenter);
            if (rD > uReveal) discard;
            if (vWorldP.z > 2.5) discard;
            vec2 rel = vWorldP.xy - uRoomC;
            vec2 camRel = uCam.xy - uRoomC;
            if (vWorldP.z > 0.06) {
              if (abs(camRel.x) > uRoomH.x && rel.x * camRel.x > 0.0 && abs(rel.x) > uRoomH.x - 0.72) discard;
              if (abs(camRel.y) > uRoomH.y && rel.y * camRel.y > 0.0 && abs(rel.y) > uRoomH.y - 0.72) discard;
            }`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float rim = smoothstep(0.22, 0.0, uReveal - rD) * step(uReveal, 4.9);
            float pulse = uPulse < 0.0 ? 0.0 : smoothstep(0.16, 0.0, abs(rD - uPulse));
            totalEmissiveRadiance += vec3(0.25, 0.95, 0.85) * (rim * 1.6 + pulse * 0.8);`);
      };
      mat.customProgramCacheKey = () => 'rp-reveal';
      return mat;
    };

    /* materials and geometry */
    const loader = new THREE.TextureLoader();
    const texCache = {};
    const tex = name => {
      if (!texCache[name]) {
        const t = loader.load(`${base}tex/${name}`);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.flipY = false;
        t.anisotropy = 8;
        texCache[name] = t;
      }
      return texCache[name];
    };
    const matCache = new Map();
    const material = (i, hasUV, reveal) => {
      const key = `${i}|${hasUV}|${reveal}`;
      if (matCache.has(key)) return matCache.get(key);
      const m = scene3d.materials[i];
      const mat = new THREE.MeshStandardMaterial({
        roughness: m.rough,
        metalness: 0,
        transparent: m.rgba[3] < 0.99,
        opacity: m.rgba[3],
        side: THREE.DoubleSide,
      });
      mat.color.setRGB(m.rgba[0], m.rgba[1], m.rgba[2], THREE.SRGBColorSpace);
      if (m.tex && hasUV) mat.map = tex(m.tex);
      if (m.emit > 0) { mat.emissive.copy(mat.color); mat.emissiveIntensity = m.emit; }
      if (reveal) patch(mat);
      matCache.set(key, mat);
      return mat;
    };
    const meshOf = (p, reveal) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, p.pos, p.n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buffer, p.nrm, p.n * 4), 4, true));
      if (p.uv != null) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buffer, p.uv, p.n * 2), 2));
      const Idx = p.n < 65536 ? Uint16Array : Uint32Array;
      g.setIndex(new THREE.BufferAttribute(new Idx(buffer, p.idx, p.ni), 1));
      return new THREE.Mesh(g, material(p.mat, p.uv != null, reveal));
    };

    const room = new THREE.Group();
    for (const p of scene3d.static) { const m = meshOf(p, true); m.receiveShadow = true; room.add(m); }
    for (const p of scene3d.casters) { const m = meshOf(p, true); m.castShadow = m.receiveShadow = true; room.add(m); }
    scene.add(room);

    const robot = new THREE.Group();
    robot.position.fromArray(scene3d.robot.pos);
    robot.quaternion.set(scene3d.robot.quat[1], scene3d.robot.quat[2], scene3d.robot.quat[3], scene3d.robot.quat[0]);
    for (const link of Object.values(scene3d.links)) {
      const g = new THREE.Group();
      g.position.fromArray(link.pos);
      g.quaternion.set(link.quat[1], link.quat[2], link.quat[3], link.quat[0]);
      for (const p of link.parts) { const m = meshOf(p, true); m.castShadow = true; g.add(m); }
      robot.add(g);
    }
    scene.add(robot);

    const [pw, pd, ph] = scene3d.robot.pedestal;
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(pw, pd, ph),
      patch(new THREE.MeshStandardMaterial({ color: 0x241c1a, roughness: 0.6 })));
    pedestal.position.set(scene3d.robot.pos[0], scene3d.robot.pos[1], ph / 2);
    pedestal.quaternion.copy(robot.quaternion);
    pedestal.castShadow = pedestal.receiveShadow = true;
    scene.add(pedestal);

    const props = {};
    for (const [name, def] of Object.entries(scene3d.props)) {
      const g = new THREE.Group();
      for (const p of def.parts) { const m = meshOf(p, false); m.castShadow = m.receiveShadow = true; g.add(m); }
      g.visible = false;
      scene.add(g);
      props[name] = g;
    }

    const grid = new THREE.GridHelper(16, 32, 0x2b4a55, 0x14242e);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.06;
    scene.add(grid);

    /* overlays: distance ruler and goal ring */
    const accent = new THREE.MeshBasicMaterial({ color: 0x72e0d2, transparent: true, depthTest: false, toneMapped: false });
    const ruler = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 10), accent);
    ruler.renderOrder = 5;
    const capA = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), accent);
    const capB = capA.clone();
    capA.renderOrder = capB.renderOrder = 5;
    scene.add(ruler, capA, capB);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.005, 10, 72), accent.clone());
    ring.renderOrder = 5;
    scene.add(ring);

    /* tags */
    const tagLayer = $('.rp-tags');
    const tags = {};
    const tagOf = key => {
      if (!tags[key]) {
        const el = document.createElement('span');
        el.className = 'rp-tag';
        tagLayer.appendChild(el);
        tags[key] = el;
      }
      return tags[key];
    };
    const v3 = new THREE.Vector3();
    const showTag = (key, text, world, alpha, cls) => {
      const el = tagOf(key);
      if (alpha <= 0.01) { el.style.opacity = 0; return; }
      v3.copy(world).project(camera);
      if (v3.z > 1) { el.style.opacity = 0; return; }
      const w = canvas.clientWidth, h = canvas.clientHeight;
      el.textContent = text;
      el.className = `rp-tag${cls ? ' ' + cls : ''}`;
      el.style.opacity = alpha;
      el.style.transform = `translate(-50%, -100%) translate(${((v3.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v3.y) / 2 * h).toFixed(1)}px)`;
    };

    /* ------------------------------------------------ state */
    let task, tl, steps, measured = 0;
    let t = 0, playing = false, userCam = false, needsRender = true, inView = false, lastDetail = null;
    const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();

    const setPose = (g, a, b, u, lift) => {
      p0.set(a[0], a[1], a[2]); p1.set(b[0], b[1], b[2]);
      g.position.lerpVectors(p0, p1, u);
      g.position.z += lift;
      q0.set(a[4], a[5], a[6], a[3]); q1.set(b[4], b[5], b[6], b[3]);
      g.quaternion.slerpQuaternions(q0, q1, u);
    };

    function updateProps(now) {
      const code = tl.seg('code'), p5 = tl.seg('p5'), p6 = tl.seg('p6');
      for (const [name, g] of Object.entries(props)) {
        const i = task.order.indexOf(name);
        if (i < 0) { g.visible = false; continue; }
        const init = task.initial[name];
        const startT = code.t0 + 0.55 + i * 1.05;
        if (now < startT) { g.visible = false; tagOf(name).style.opacity = 0; continue; }
        g.visible = true;
        const u = clamp01((now - startT) / 0.85);
        let pose = false;

        if (now >= p5.t0 && now < p5.t1 && task.goal[name]) {
          const w = segProgress(p5, now);
          const there = w < 0.32 ? smooth(w / 0.32) : w < 0.74 ? 1 : 1 - smooth((w - 0.74) / 0.26);
          const moves = Math.hypot(task.goal[name][0] - init[0], task.goal[name][1] - init[1]) > 0.02;
          setPose(g, init, task.goal[name], there, moves ? Math.sin(Math.PI * there) * 0.16 : 0);
          pose = true;
        } else if (now >= p6.t0 && now < p6.t1) {
          const seq = [init, ...task.seeded.map(r => r[name] || init), init];
          const w = segProgress(p6, now) * (seq.length - 1);
          const k = Math.min(seq.length - 2, Math.floor(w));
          const f = smooth((w - k) / 0.55);
          const hop = Math.hypot(seq[k + 1][0] - seq[k][0], seq[k + 1][1] - seq[k][1]) > 0.005 ? Math.sin(Math.PI * f) * 0.09 : 0;
          setPose(g, seq[k], seq[k + 1], f, hop);
          pose = true;
        }
        if (!pose) setPose(g, init, init, 0, (1 - bounce(u)) * 0.42);
        g.scale.setScalar(Math.max(0.001, Math.min(1, u * 5)));

        const age = now - startT;
        const alpha = now > code.t1 + 0.2 ? 0 : smooth(age / 0.25) * (1 - smooth((age - 1.9) / 0.4));
        v3.copy(g.position); v3.z += 0.12;
        showTag(name, name, v3.clone(), alpha, name === 'teacup' || name === 'tray' ? 'is-key' : '');
      }
    }

    function updateOverlays(now) {
      const p4 = tl.seg('p4'), p5 = tl.seg('p5');
      const on4 = now >= p4.t0 && now < p4.t1;
      ruler.visible = capA.visible = capB.visible = on4;
      const a4 = on4 ? Math.min(smooth(segProgress(p4, now) / 0.15), 1 - smooth((segProgress(p4, now) - 0.88) / 0.12)) : 0;
      if (on4) {
        const a = task.initial.teacup, b = task.initial.tray;
        const z = Math.max(a[2], b[2]) + 0.02;
        const grow = smooth(segProgress(p4, now) / 0.32);
        const A = new THREE.Vector3(a[0], a[1], z), B = new THREE.Vector3(b[0], b[1], z);
        const E = A.clone().lerp(B, grow);
        ruler.position.copy(A).lerp(E, 0.5);
        ruler.scale.y = Math.max(0.001, A.distanceTo(E));
        ruler.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
        capA.position.copy(A); capB.position.copy(E);
        accent.opacity = a4;
        showTag('ruler', `${(measured * 100).toFixed(1)} cm`, A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, 0, 0.05)), a4 * smooth((segProgress(p4, now) - 0.25) / 0.1), 'is-key');
      } else {
        showTag('ruler', '', v3, 0);
      }

      const on5 = now >= p5.t0 && now < p5.t1;
      ring.visible = on5;
      if (on5) {
        const w = segProgress(p5, now);
        const lit = smooth((w - 0.28) / 0.08) * (1 - smooth((w - 0.8) / 0.12));
        const tr = task.initial.tray;
        ring.position.set(tr[0], tr[1], tr[2] + 0.03);
        ring.material.opacity = lit;
        ring.scale.setScalar(1 + (1 - lit) * 0.3);
        showTag('goal', `success: ${task.invariant}`, new THREE.Vector3(tr[0], tr[1], tr[2] + 0.27), lit, 'is-pass');
      } else {
        showTag('goal', '', v3, 0);
      }
    }

    /* camera path: wide at the start, on the counter while it fills */
    const CAM = {
      wide: { p: [4.6, -3.7, 4.0], c: [0, 0.1, 0.7] },
      mid: { p: [3.7, -2.9, 3.3], c: [-0.1, 0.2, 0.85] },
      near: { p: [0.66, -0.36, 1.74], c: [-0.32, 0.42, 1.12] },
      close: { p: [0.72, 0.12, 1.72], c: [-0.26, 0.58, 1.14] },
    };
    function cameraPath(now) {
      const keys = [
        [0, CAM.wide], [tl.seg('room').t0, CAM.wide], [tl.seg('code').t0 - 0.2, CAM.mid],
        [tl.seg('code').t0 + 1.2, CAM.near], [tl.seg('p4').t0, CAM.near], [tl.seg('p5').t0 + 0.2, CAM.close],
        [tl.seg('p5').t1 - 0.3, CAM.close], [tl.seg('p6').t0 + 0.4, CAM.near], [tl.seg('done').t0, CAM.near],
        [tl.duration, CAM.mid],
      ];
      let i = 0;
      while (i < keys.length - 2 && now > keys[i + 1][0]) i++;
      const [ta, a] = keys[i], [tb, b] = keys[i + 1];
      const u = tb > ta ? smooth((now - ta) / (tb - ta)) : 0;
      camera.position.set(a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u, a.p[2] + (b.p[2] - a.p[2]) * u);
      controls.target.set(a.c[0] + (b.c[0] - a.c[0]) * u, a.c[1] + (b.c[1] - a.c[1]) * u, a.c[2] + (b.c[2] - a.c[2]) * u);
      const drift = (now - tl.duration / 2) * 0.012;
      camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 0, 1), drift).add(controls.target);
    }

    /* ------------------------------------------------ panel */
    const promptEl = $('.rp-prompt-text');
    const caret = $('.rp-caret');
    const stepEls = {};
    const clockEl = $('.rp-clock');
    const range = $('.rp-range');
    const playBtn = $('.rp-play');
    const detailEl = $('.rp-detail');
    const ticksEl = $('.rp-ticks');

    function renderPrompt(now) {
      const seg = tl.seg('prompt');
      const n = Math.round(smooth(segProgress(seg, now) * 1.08) * task.prompt.length);
      const typing = now < seg.t1;
      caret.style.display = typing ? '' : 'none';
      const words = new Set(task.assets.map(a => a.cls));
      const shown = task.prompt.slice(0, n);
      if (now < tl.seg('plan').t0 + 0.4) { promptEl.textContent = shown; return; }
      promptEl.innerHTML = esc(shown).replace(/\b[a-z]+\b/g, w => (words.has(w) ? `<mark>${w}</mark>` : w));
    }

    function renderPanel(now) {
      const cur = tl.segs.find(s => now < s.t1) || tl.segs[tl.segs.length - 1];
      let target = null;
      for (const row of steps) {
        const segs = tl.segs.filter(x => row.covers.includes(x.step));
        const end = segs[segs.length - 1].t1;
        const done = row.id === 'share' ? now >= tl.duration : now >= end || cur.id === 'done';
        const active = !done && row.covers.includes(cur.step);
        stepEls[row.id].classList.toggle('is-done', done);
        stepEls[row.id].classList.toggle('is-active', active);
        if (active) target = stepEls[row.id]; // later rows are deeper: a sub-step wins over its parent
      }
      if (target && target !== renderPanel.lastActive) {
        renderPanel.lastActive = target;
        const list = $('.rp-steps');
        list.scrollTop = target.offsetTop - list.clientHeight / 2;
      }
      $('.rp-steps').classList.toggle('is-collapsed', cur.id === 'done');
      const wanted = cur.id;
      if (wanted !== lastDetail) {
        const doneHTML = doneCard();
        detailEl.innerHTML = detailHTML(wanted, task, { measured, doneHTML });
        lastDetail = wanted;
      }
      if (wanted === 'code') {
        const code = tl.seg('code');
        detailEl.querySelectorAll('[data-line]').forEach((el, i) => {
          const at = code.t0 + 0.55 + i * 1.05;
          el.classList.toggle('is-on', now >= at);
          el.classList.toggle('is-cur', now >= at && now < at + 1.05);
        });
      }
      if (wanted === 'p5') {
        const pass = detailEl.querySelector('[data-pass]');
        if (pass) pass.classList.toggle('is-on', segProgress(tl.seg('p5'), now) > 0.3);
      }
      if (wanted === 'p6') {
        const k = Math.min(task.seeded.length, 1 + Math.floor(segProgress(tl.seg('p6'), now) * (task.seeded.length + 1)));
        const el = detailEl.querySelector('[data-reset]');
        if (el) el.textContent = k;
      }
      const realNow = cur.realStart + (cur.realEnd - cur.realStart) * segProgress(cur, now);
      clockEl.textContent = clock(realNow);
      if (document.activeElement !== range || !range.matches(':active')) range.value = Math.round(now / tl.duration * 1000);
      range.style.setProperty('--p', `${now / tl.duration * 100}%`);
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      playBtn.dataset.state = playing ? 'pause' : now >= tl.duration ? 'replay' : 'play';
    }

    function doneCard() {
      const rec = tasksData.tasks.find(x => x.id === task.id);
      const clip = rec && rec.clips && rec.clips.success;
      const rows = rec ? Object.entries(rec.rates).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1])
        .map(([p, [s, e]]) => `<li><span>${esc(tasksData.policies[p] || p)}</span><i style="--w:${s / e * 100}%"></i><b>${Math.round(s / e * 100)}%</b></li>`).join('') : '';
      return `<p class="rp-d-title">Added to the repository</p>
        <p class="rp-d-text">Generated in <b>${clock(task.wall_s)}</b>. At test time, the policy receives only the instruction <em>“${esc(task.instruction)}”</em>.</p>
        ${clip ? `<video class="rp-clip" src="${clip.src}" muted loop playsinline autoplay></video>
        <p class="rp-d-cap">${esc(tasksData.policies[clip.policy] || clip.policy)}, evaluation rollout</p>` : ''}
        <ul class="rp-rates">${rows}</ul>`;
    }

    function seek(now) {
      t = Math.max(0, Math.min(tl.duration, now));
      const room = tl.seg('room');
      uni.uReveal.value = t < room.t0 ? 0 : t >= room.t1 ? 9 : smooth(segProgress(room, t)) * 5;
      const p2 = tl.seg('p2');
      uni.uPulse.value = t >= p2.t0 && t < p2.t1 ? segProgress(p2, t) * 6 : -1;
      if (!userCam) cameraPath(t);
      renderPrompt(t);
      renderPanel(t);
      needsRender = true;
    }

    function setTask(id, resetTime = true) {
      task = scene3d.tasks[id];
      tl = buildTimeline(task);
      steps = STEPS(task);
      const a = task.initial.teacup, b = task.initial.tray;
      measured = Math.hypot(a[0] - b[0], a[1] - b[1]);
      lastDetail = null;
      renderPanel.lastActive = null;
      $('.rp-steps').innerHTML = steps.map(s => `<li data-step="${s.id}" class="${s.sub ? 'is-sub' : ''}"><span class="rp-dot"></span><span class="rp-step-label">${esc(s.label)}${s.hint ? ` <em>${esc(s.hint)}</em>` : ''}</span><span class="rp-step-s">${s.s == null ? '' : dur(s.s)}</span></li>`).join('');
      $$steps();
      ticksEl.innerHTML = tl.segs.map(s => `<i style="left:${s.t0 / tl.duration * 100}%"></i>`).join('');
      root.querySelectorAll('.rp-tab').forEach(x => x.setAttribute('aria-selected', String(x.dataset.id === id)));
      Object.values(tags).forEach(el => { el.style.opacity = 0; });
      if (resetTime) seek(0);
    }
    function $$steps() {
      Object.keys(stepEls).forEach(k => delete stepEls[k]);
      root.querySelectorAll('.rp-steps li').forEach(li => { stepEls[li.dataset.step] = li; });
    }

    /* ------------------------------------------------ controls */
    root.querySelectorAll('.rp-tab').forEach(btn => btn.addEventListener('click', () => {
      setTask(btn.dataset.id);
      userCam = false;
      $('.rp-recenter').hidden = true;
      playing = true;
    }));
    playBtn.addEventListener('click', () => {
      if (t >= tl.duration) seek(0);
      playing = !playing;
      renderPanel(t);
    });
    range.addEventListener('input', () => { playing = false; seek(range.value / 1000 * tl.duration); });
    controls.addEventListener('start', () => {
      userCam = true;
      $('.rp-recenter').hidden = false;
      $('.rp-hint').classList.add('is-gone');
    });
    controls.addEventListener('change', () => { needsRender = true; });
    $('.rp-recenter').addEventListener('click', () => {
      userCam = false;
      $('.rp-recenter').hidden = true;
      seek(t);
    });

    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 1.15 ? 52 : 38;
      camera.updateProjectionMatrix();
      needsRender = true;
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    /* ------------------------------------------------ loop */
    let last = performance.now();
    function frame(nowMs) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      if (!inView) return;
      if (playing) {
        seek(t + dt);
        if (t >= tl.duration) { playing = false; renderPanel(t); }
      }
      if (userCam) controls.update();
      else camera.lookAt(controls.target);
      uni.uCam.value.copy(camera.position);
      if (needsRender || userCam || playing) {
        camera.updateMatrixWorld(); // tags project through this, ahead of render()
        updateProps(t);
        updateOverlays(t);
        renderer.render(scene, camera);
        needsRender = false;
      }
    }

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTask('K067');
    if (reduced) seek(tl.duration);
    new IntersectionObserver(es => {
      es.forEach(e => {
        inView = e.isIntersecting;
        if (inView && !root.dataset.autoplayed && !reduced && e.intersectionRatio >= 0.35) {
          root.dataset.autoplayed = '1';
          playing = true;
        }
      });
      needsRender = true;
    }, { threshold: [0, 0.35] }).observe($('.rp-view'));

    root.classList.add('is-ready');
    requestAnimationFrame(frame);
    window.rcReplay = { seek, setTask, pause: () => { playing = false; }, duration: () => tl.duration, segs: () => tl.segs };
  }

  async function fetchWithProgress(url) {
    const bar = $('.rp-load i');
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return r.arrayBuffer();
    const out = new Uint8Array(total);
    const reader = r.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > total) return fetch(url).then(x => x.arrayBuffer());
      out.set(value, got);
      got += value.length;
      if (bar) bar.style.width = `${got / total * 100}%`;
    }
    return out.buffer;
  }

  function fallback() {
    root.classList.add('is-fallback');
    $('.rp-view').innerHTML = '<img src="static/img/tasks/K067/initial.jpg" alt="The generated task scene: a kitchen counter with a teacup, a tray and four other objects, beside a Franka arm.">';
    root.classList.add('is-ready');
  }

  function hasWebGL() {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  }

  $('.rp-tabs').innerHTML = VARIANTS.map(v => `<button class="rp-tab" role="tab" data-id="${v.id}" aria-selected="false">${v.label}</button>`).join('');

  let started = false;
  new IntersectionObserver((es, io) => {
    if (started || !es.some(e => e.isIntersecting)) return;
    started = true;
    io.disconnect();
    if (!hasWebGL()) return fallback();
    start3D().catch(err => { console.error(err); fallback(); });
  }, { rootMargin: '700px 0px' }).observe(root);
})();
