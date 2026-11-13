'use strict';
// ─── Rendu 3D (Three.js) ─────────────────────────────────────────────────────
// Repère : le jeu est en 2D (x, y). En 3D : x → x, y → z, la hauteur est l'axe y.
const R3 = (() => {
  let renderer, scene, camera, sun, raycaster;
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const cam = { x: 0, y: 0, dist: 1250 };
  const live = new Map();       // entité du jeu → objet 3D
  let statics = null;           // bâtiments construits depuis MAP (bureaux, objectifs, camps)
  let lastS = null;

  // ── Matériaux partagés ──
  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts }));
    return matCache.get(key);
  }
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sph: new THREE.SphereGeometry(1, 20, 14),
    sphLo: new THREE.SphereGeometry(1, 10, 8),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
    cylLo: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone: new THREE.ConeGeometry(1, 1, 14),
    prism: new THREE.CylinderGeometry(1, 1, 1, 3),
  };
  function mesh(geo, material, sx, sy, sz, x, y, z) {
    const m = new THREE.Mesh(geo, material);
    m.scale.set(sx, sy, sz);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function scaleTo(m, r) { m.scale.setScalar(r); return m; }
  const hex = (s) => new THREE.Color(s).getHex();

  // ── Initialisation ──
  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e13);
    scene.fog = new THREE.Fog(0x0b0e13, 2600, 5200);
    camera = new THREE.PerspectiveCamera(38, 1, 10, 9000);
    raycaster = new THREE.Raycaster();

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30303c, 0.85));
    sun = new THREE.DirectionalLight(0xfff3e0, 0.95);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -1100; sc.right = 1100; sc.top = 1100; sc.bottom = -1100; sc.near = 100; sc.far = 4000;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    buildGround();
    buildCity();
    statics = buildStatics();
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ── Sol, immeubles, arbres ──
  function buildGround() {
    const { canvas, worldSize } = Render.makeGround(0.9);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const g = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, worldSize), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(MAP.R + 6, MAP.R + 40, 60, 96, 1, true), mat(0x161b22, { side: THREE.DoubleSide }));
    rim.position.y = -30;
    scene.add(rim);
  }

  // ── Immeubles Kenney City Kit Commercial (CC0, assets/kenney) ──
  // Les blocs simples restent affichés si les modèles ne se chargent pas (ouverture en file://, hors ligne…).
  const KENNEY = 'assets/kenney/city-commercial/';
  let CITY_SHADOWS = /[?&]ombres=1/.test(location.search); // ombres des immeubles détaillés : coûteuses, désactivées par défaut
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function upgradeCity(houses, fallback) {
    if (location.protocol === 'file:' || /[?&]blocs=1/.test(location.search)) return; // ?blocs=1 : ville simplifiée
    try {
      if (!THREE.GLTFLoader) await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
      const loader = new THREE.GLTFLoader();
      const gltfs = await Promise.all('abcdefghijklmn'.split('').map((l) => loader.loadAsync(`${KENNEY}building-${l}.glb`)));
      const variants = gltfs.map((gl) => {
        gl.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gl.scene);
        const parts = [];
        gl.scene.traverse((o) => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
        return { box, size: box.getSize(new THREE.Vector3()), ctr: box.getCenter(new THREE.Vector3()), parts, list: [] };
      });
      const rnd = Render.seeded(4242);
      for (const b of houses) variants[Math.floor(rnd() * variants.length)].list.push({ b, flip: rnd() < 0.5 });
      const base = new THREE.Matrix4(), pre = new THREE.Matrix4(), m4 = new THREE.Matrix4(), col = new THREE.Color();
      const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      for (const v of variants) {
        if (!v.list.length) continue;
        pre.makeTranslation(-v.ctr.x, -v.box.min.y, -v.ctr.z);
        for (const part of v.parts) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, v.list.length);
          v.list.forEach(({ b, flip }, i) => {
            const s = Math.min(b.w / v.size.x, b.h / v.size.z) * 0.95;
            // hauteur : proportions du modèle, modulées par la hauteur prévue du bloc
            const sy = s * U.clamp(0.75 + b.hgt / 110, 0.8, 1.6);
            q.setFromAxisAngle(up, flip ? Math.PI : 0);
            base.compose(pos.set(b.x, 0, b.y), q, scl.set(s, sy, s));
            m4.copy(base).multiply(pre).multiply(part.m);
            im.setMatrixAt(i, m4);
            // teinte légère selon le quartier : chaude à gauche, froide à droite
            const a = ((Math.atan2(-b.y, b.x) * 180) / Math.PI + 360) % 360;
            const side = (MAP.sectors.find((sc) => a >= sc.a0 && a < sc.a1) || MAP.sectors[0]).side;
            col.setHex(side === 'gauche' ? 0xffd2cc : side === 'droite' ? 0xcfdcff : 0xf2f2ea);
            im.setColorAt(i, col);
          });
          im.castShadow = CITY_SHADOWS; im.receiveShadow = true;
          scene.add(im);
        }
      }
      for (const f of fallback) scene.remove(f);
    } catch (e) {
      console.warn('Immeubles Kenney indisponibles, blocs simples conservés', e);
    }
  }

  // ── Campagne autour de la ville : fermes, bottes de foin, haies, vaches ──
  function buildCountryside(fields) {
    const rnd = Render.seeded(1789);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const bales = new THREE.InstancedMesh(G.cyl, mat(0xd8b85a, { roughness: 1 }), fields.length * 4);
    const trunks = new THREE.InstancedMesh(G.cylLo, mat(0x5b4030), fields.length * 4);
    const crowns = new THREE.InstancedMesh(G.sphLo, mat(0x4f8a3c), fields.length * 4);
    const cows = new THREE.InstancedMesh(G.box, mat(0xf4f1ea), fields.length * 3);
    const spots = new THREE.InstancedMesh(G.box, mat(0x2a2a2a), fields.length * 3);
    let nb = 0, nt = 0, nc = 0;
    const put = (im, i, x, y, z, sx, sy, sz, rx, ry, rz) => {
      q.setFromEuler(e.set(rx || 0, ry || 0, rz || 0)); im.setMatrixAt(i, m4.compose(p.set(x, y, z), q, sc.set(sx, sy, sz)));
    };
    for (const b of fields) {
      const ry = rnd() * Math.PI;
      if (b.farm) {
        // ferme : murs crème, toit de tuiles, grange rouge
        const g = new THREE.Group(); g.position.set(b.x, 0, b.y); g.rotation.y = ry;
        g.add(mesh(G.box, mat(0xeee3c8), 30, 18, 20, -6, 9, 0));
        const r = mesh(G.prism, mat(0xb5523a), 1, 1, 1, -6, 24, 0); r.rotation.z = Math.PI / 2; r.scale.set(9, 32, 14); g.add(r);
        g.add(mesh(G.box, mat(0x9a3b2e), 18, 22, 18, 18, 11, 4));
        const r2 = mesh(G.prism, mat(0x5a4a3a), 1, 1, 1, 18, 26, 4); r2.rotation.z = Math.PI / 2; r2.scale.set(7, 20, 13); g.add(r2);
        g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
        scene.add(g);
      } else if (b.crop === 0) {
        // blé moissonné : bottes de foin rondes couchées
        for (let k = 0; k < 3; k++) put(bales, nb++, b.x + (rnd() - 0.5) * b.w * 0.7, 6, b.y + (rnd() - 0.5) * b.h * 0.7, 6, 9, 6, 0, rnd() * 3, Math.PI / 2);
      } else if (b.crop === 1) {
        // prairie : quelques vaches
        for (let k = 0; k < 2; k++) {
          const x = b.x + (rnd() - 0.5) * b.w * 0.6, z = b.y + (rnd() - 0.5) * b.h * 0.6, a = rnd() * 6;
          put(cows, nc, x, 7, z, 14, 8, 7, 0, a, 0);
          put(spots, nc++, x + Math.cos(a) * 2, 8.5, z - Math.sin(a) * 2, 5, 5.5, 7.4, 0, a, 0);
        }
      }
      // haie d'arbres sur un bord du champ
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const x = b.x - b.w / 2 - 4 + rnd() * (b.w + 8), z = b.y + (rnd() < 0.5 ? -1 : 1) * (b.h / 2 + 4), s = 0.8 + rnd() * 0.5;
        put(trunks, nt, x, 9 * s, z, 2.5 * s, 18 * s, 2.5 * s);
        put(crowns, nt++, x, 24 * s, z, 11 * s, 12 * s, 11 * s);
      }
    }
    bales.count = nb; trunks.count = crowns.count = nt; cows.count = spots.count = nc;
    for (const im of [bales, trunks, crowns, cows, spots]) { im.castShadow = true; scene.add(im); }
  }

  function buildCity() {
    const blocks = Render.blockList();
    buildCountryside(blocks.filter((b) => b.rural));
    const houses = blocks.filter((b) => !b.park && !b.rural);
    const parks = blocks.filter((b) => b.park);
    const im = new THREE.InstancedMesh(G.box, new THREE.MeshStandardMaterial({ roughness: 0.85 }), houses.length);
    const roof = new THREE.InstancedMesh(G.box, new THREE.MeshStandardMaterial({ roughness: 0.6 }), houses.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    houses.forEach((b, i) => {
      const a = ((Math.atan2(-b.y, b.x) * 180) / Math.PI + 360) % 360;
      const sector = MAP.sectors.find((s) => a >= s.a0 && a < s.a1) || MAP.sectors[0];
      const tint = sector.side === 'gauche' ? 0x4a3338 : sector.side === 'droite' ? 0x2f3a50 : 0x36403b;
      const h = b.hgt * 0.7;
      m4.makeScale(b.w, h, b.h); m4.setPosition(b.x, h / 2, b.y);
      im.setMatrixAt(i, m4);
      col.setHex(tint).offsetHSL(0, 0, (i % 7) * 0.012);
      im.setColorAt(i, col);
      m4.makeScale(b.w * 0.86, 4, b.h * 0.86); m4.setPosition(b.x, h + 2, b.y);
      roof.setMatrixAt(i, m4);
      col.setHex(0x232a33);
      roof.setColorAt(i, col);
    });
    for (const x of [im, roof]) { x.castShadow = true; x.receiveShadow = true; scene.add(x); }
    upgradeCity(houses, [im, roof]);
    const trunk = new THREE.InstancedMesh(G.cylLo, mat(0x5b4030), parks.length * 3);
    const leaf = new THREE.InstancedMesh(G.sphLo, mat(0x3f8f55), parks.length * 3);
    let k = 0;
    const rnd = Render.seeded(77);
    for (const b of parks) {
      for (let j = 0; j < 3; j++) {
        const x = b.x + (rnd() - 0.5) * b.w * 0.7, y = b.y + (rnd() - 0.5) * b.h * 0.7, s = 0.8 + rnd() * 0.5;
        m4.makeScale(3 * s, 22 * s, 3 * s); m4.setPosition(x, 11 * s, y); trunk.setMatrixAt(k, m4);
        m4.makeScale(13 * s, 15 * s, 13 * s); m4.setPosition(x, 28 * s, y); leaf.setMatrixAt(k, m4);
        k++;
      }
    }
    trunk.count = leaf.count = k;
    for (const x of [trunk, leaf]) { x.castShadow = true; scene.add(x); }
  }

  // ── Drapeau tricolore ──
  let flagTex = null;
  function flag(h) {
    if (!flagTex) {
      const c = document.createElement('canvas'); c.width = 48; c.height = 32;
      const g = c.getContext('2d');
      g.fillStyle = '#2f55c4'; g.fillRect(0, 0, 16, 32); g.fillStyle = '#fff'; g.fillRect(16, 0, 16, 32); g.fillStyle = '#e0384b'; g.fillRect(32, 0, 16, 32);
      flagTex = new THREE.CanvasTexture(c);
    }
    const grp = new THREE.Group();
    grp.add(mesh(G.cylLo, mat(0x8a8f99), 1.5, h, 1.5, 0, h / 2, 0));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide }));
    f.geometry.translate(15, 0, 0);
    f.position.y = h - 10;
    f.castShadow = true;
    grp.add(f);
    grp.userData.cloth = f;
    return grp;
  }

  function columns(grp, n, w, h, z, r, color) {
    for (let i = 0; i < n; i++) grp.add(mesh(G.cyl, mat(color), r, h, r, -w / 2 + (w / (n - 1)) * i, h / 2, z));
  }

  // ── Bâtiments ──
  function buildQG(team) {
    const T = TEAMS[team], q = MAP.QG[team];
    const g = new THREE.Group();
    g.position.set(q.x, 0, q.y);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(CFG.qgRadius, 48), new THREE.MeshStandardMaterial({ color: hex(T.color), transparent: true, opacity: 0.18 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 1.5; g.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(CFG.qgRadius - 6, CFG.qgRadius, 64), new THREE.MeshBasicMaterial({ color: hex(T.color) }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 2; g.add(ring);
    // l'immeuble est adossé au bord de la ville : l'esplanade reste libre pour les candidats
    const side = team === 'gauche' ? -1 : 1;
    const glass = mat(0x8fb0e8, { emissive: 0x223355, emissiveIntensity: 0.6 });
    const bx = side * 150;
    g.add(mesh(G.box, mat(hex(T.dark)), 90, 110, 150, bx, 55, 0));
    g.add(mesh(G.box, mat(hex(T.color)), 96, 10, 156, bx, 112, 0));
    g.add(mesh(G.box, glass, 92, 12, 152, bx, 40, 0));
    g.add(mesh(G.box, glass, 92, 12, 152, bx, 76, 0));
    g.add(mesh(G.box, mat(hex(T.color)), 8, 40, 120, bx - side * 46, 70, 0)); // enseigne
    const f = flag(140); f.position.set(side * 110, 0, -110); g.add(f);
    scene.add(g);
    return g;
  }

  function buildObjective(o) {
    const g = new THREE.Group();
    g.position.set(o.x, 0, o.y);
    const ring = new THREE.Mesh(new THREE.RingGeometry(o.r + 18, o.r + 30, 64), new THREE.MeshBasicMaterial({ color: 0xc9cfd8, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 2; g.add(ring);
    g.userData.ring = ring;
    const stone = 0xe9e4d6, stone2 = 0xcfc6ae, roofc = 0x6d6a73;
    if (o.id === 'elysee') {
      g.add(mesh(G.box, mat(0x3a4250), 330, 4, 240, 0, 2, 0));
      g.add(mesh(G.box, mat(stone), 260, 70, 80, 0, 35, -40));
      g.add(mesh(G.box, mat(roofc), 266, 18, 86, 0, 79, -40));
      g.add(mesh(G.box, mat(stone2), 60, 55, 110, -125, 27, 30));
      g.add(mesh(G.box, mat(stone2), 60, 55, 110, 125, 27, 30));
      g.add(mesh(G.box, mat(roofc), 64, 12, 114, -125, 60, 30));
      g.add(mesh(G.box, mat(roofc), 64, 12, 114, 125, 60, 30));
      columns(g, 6, 90, 62, 4, 4, 0xf4f0e4);
      const ped = mesh(G.prism, mat(stone), 1, 1, 1, 0, 78, 6); ped.rotation.z = Math.PI / 2; ped.scale.set(26, 104, 14); g.add(ped);
      const f = flag(70); f.position.set(0, 88, -40); g.add(f);
    } else if (o.id === 'an') {
      g.add(mesh(G.box, mat(stone), 210, 64, 90, 0, 32, -20));
      g.add(mesh(G.box, mat(roofc), 214, 10, 94, 0, 69, -20));
      columns(g, 8, 150, 60, 34, 4.5, 0xf4f0e4);
      g.add(mesh(G.box, mat(stone), 170, 8, 30, 0, 64, 34));
      const ped = mesh(G.prism, mat(stone), 1, 1, 1, 0, 80, 34); ped.rotation.z = Math.PI / 2; ped.scale.set(22, 170, 14); g.add(ped);
      g.add(mesh(G.box, mat(stone2), 180, 6, 40, 0, 3, 60));
      const f = flag(60); f.position.set(80, 74, -30); g.add(f);
    } else {
      g.add(mesh(G.box, mat(stone), 210, 60, 100, 0, 30, -10));
      g.add(mesh(G.box, mat(roofc), 214, 10, 104, 0, 65, -10));
      g.add(mesh(G.cyl, mat(stone2), 36, 26, 36, 0, 83, -10));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(38, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8f9aa6, { metalness: 0.4, roughness: 0.4 }));
      dome.position.set(0, 96, -10); dome.castShadow = true; g.add(dome);
      g.add(mesh(G.cyl, mat(stone), 6, 18, 6, 0, 140, -10));
      columns(g, 4, 70, 50, 44, 4, 0xf4f0e4);
      const f = flag(50); f.position.set(-90, 70, -30); g.add(f);
    }
    scene.add(g);
    return g;
  }

  function buildBureau(home, pos) {
    const g = new THREE.Group();
    g.position.set(pos.x, 0, pos.y);
    const col = mat(hex(TEAMS[home].color));
    g.add(mesh(G.box, mat(0x1d232b), 74, 10, 56, 0, 5, 0));
    const posts = [];
    for (const [x, z] of [[-30, -22], [30, -22], [-30, 22], [30, 22]]) { const p = mesh(G.box, col, 5, 46, 5, x, 32, z); posts.push(p); g.add(p); }
    const roof = mesh(G.box, col, 82, 6, 64, 0, 57, 0); g.add(roof);
    g.add(mesh(G.box, mat(0xdfe8f2, { transparent: true, opacity: 0.75 }), 26, 26, 20, 0, 24, 0));
    g.add(mesh(G.box, mat(0x222222), 12, 1, 3, 0, 37.5, 0));
    const pips = [];
    for (let i = 0; i < CFG.bureauMax; i++) { const p = mesh(G.box, col, 9, 6, 6, -27 + i * 10.8, 3, 36); pips.push(p); g.add(p); }
    g.userData = { posts, roof, pips, owner: home };
    scene.add(g);
    return g;
  }

  // ── Mairies (Quaternius, CC0) et scènes de meeting (iPoly3D, CC0) en glTF, avec repli procédural ──
  let gltfLoader = null;
  async function getLoader() {
    if (!THREE.GLTFLoader) await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
    return gltfLoader || (gltfLoader = new THREE.GLTFLoader());
  }
  // place un modèle : posé au sol, centré, mis à l'échelle sur sa plus grande dimension horizontale
  function fitModel(src, size, rotY) {
    const o = src.clone(true);
    o.rotation.y = rotY || 0;
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = size / Math.max(sz.x, sz.z);
    const wrap = new THREE.Group();
    o.position.set(-c.x, -box.min.y, -c.z);
    wrap.add(o); wrap.scale.setScalar(k);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return wrap;
  }
  async function upgradeCamps(groups) {
    if (location.protocol === 'file:' || /[?&]blocs=1/.test(location.search)) return;
    try {
      const L = await getLoader();
      const load = (f) => L.loadAsync(f).then((g) => g.scene);
      const [mairies, scenes] = await Promise.all([
        Promise.all(['a', 'b', 'c'].map((v) => load(`assets/quaternius/mairie-${v}.glb`))),
        Promise.all(['a', 'b', 'c'].map((v) => load(`assets/ipoly3d/scene-${v}.glb`))),
      ]);
      let nm = 0, ns = 0;
      MAP.campDefs.forEach(([type], i) => {
        const g = groups[i], u = g.userData;
        const keep = new Set([u.flag, u.windows, u.crowd, u.banner]);
        for (const ch of [...g.children]) if (!keep.has(ch)) g.remove(ch);
        if (type === 'mairie') {
          g.add(fitModel(mairies[nm % 3], 115, 0));
          nm++;
          // lanterne au-dessus de la porte : allumée quand la mairie est disponible
          u.windows.scale.set(12, 8, 4); u.windows.position.set(0, 34, 38);
          if (u.flag) u.flag.position.set(48, 70, 0);
        } else {
          const st = fitModel(scenes[ns % 3], 135, 0);
          st.position.z = -18;
          // les scènes d'origine sont noires : plancher et fond violets façon meeting
          st.traverse((m) => {
            if (!m.isMesh) return;
            const c = m.material.color;
            if (c && c.r + c.g + c.b < 0.3) m.material = mat(0x5a3d7a, { roughness: 0.6 });
          });
          u.banner.position.set(0, 70, -60);
          g.add(st);
          ns++;
        }
      });
    } catch (e) {
      console.warn('Modèles des mairies / meetings indisponibles, version simple conservée', e);
    }
  }

  function buildCamp(type, pos) {
    const g = new THREE.Group();
    g.position.set(pos.x, 0, pos.y);
    const parts = {};
    if (type === 'mairie') {
      g.add(mesh(G.box, mat(0xd8d1bf), 100, 52, 64, 0, 26, 0));
      const r = mesh(G.prism, mat(0x7d7461), 1, 1, 1, 0, 64, 0); r.rotation.z = Math.PI / 2; r.scale.set(20, 104, 38); g.add(r);
      const clock = mesh(G.cyl, mat(0xffffff), 9, 2, 9, 0, 44, 33); clock.rotation.x = Math.PI / 2; g.add(clock);
      parts.windows = mesh(G.box, mat(0xffe08a, { emissive: 0xffc94d, emissiveIntensity: 0.8 }), 80, 10, 66, 0, 22, 0);
      g.add(parts.windows);
      g.add(mesh(G.box, mat(0x5a5040), 16, 26, 4, 0, 13, 32));
      const f = flag(60); f.position.set(38, 52, 0); g.add(f);
      parts.flag = f;
    } else {
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(56, 56, 12, 24, 1, false, Math.PI / 2, Math.PI), mat(0x5a3d7a));
      stage.position.set(0, 6, -10); stage.castShadow = stage.receiveShadow = true; g.add(stage);
      g.add(mesh(G.box, mat(0xffd34d), 14, 22, 10, 0, 23, -30));
      g.add(mesh(G.cylLo, mat(0x333333), 1.2, 20, 1.2, 0, 44, -30));
      parts.banner = mesh(G.box, mat(0xffd34d), 110, 30, 3, 0, 52, -62);
      g.add(parts.banner);
      const crowd = new THREE.Group();
      const rnd = Render.seeded(pos.x * 7 + pos.y * 13);
      const cols = [0xe0384b, 0x2f6fe0, 0xf1f1f1, 0x4caf72, 0xffd34d];
      for (let i = 0; i < 18; i++) {
        const x = -50 + rnd() * 100, z = 18 + rnd() * 40;
        crowd.add(mesh(G.cylLo, mat(cols[i % 5]), 5, 16, 5, x, 8, z));
        crowd.add(mesh(G.sphLo, mat(0xf0c9a8), 5, 5, 5, x, 20, z));
      }
      g.add(crowd);
      parts.crowd = crowd;
    }
    g.userData = parts;
    scene.add(g);
    return g;
  }

  function buildStatics() {
    const st = {
      qg: { gauche: buildQG('gauche'), droite: buildQG('droite') },
      obj: { top: buildObjective(MAP.objectives.top), mid: buildObjective(MAP.objectives.mid), bot: buildObjective(MAP.objectives.bot) },
      bureaux: MAP.bureauDefs.map(([, home, p]) => buildBureau(home, p)),
      camps: MAP.campDefs.map(([type, p]) => buildCamp(type, p)),
      flags: [],
    };
    upgradeCamps(st.camps);
    scene.traverse((o) => { if (o.userData && o.userData.cloth) st.flags.push(o.userData.cloth); });
    return st;
  }

  // ── Candidats caricaturés (grosse tête, signes distinctifs) ──
  const SKIN = 0xf1c6a5;
  const LOOK = {
    melenchon: { hair: 0xe6e6e6, style: 'swept', suit: 0x2c2c34, shirt: 0x2c2c34, collar: true, pin: 0xd7263d, brows: 0xd0d0d0, browTilt: 0.25, nose: 1.25, mouth: 'open', height: 1 },
    glucksmann: { hair: 0x2b201a, style: 'messy', suit: 0x1f2a44, shirt: 0xffffff, stubble: 0x3a2e28, pin: 0x2f55c4, brows: 0x2b201a, browTilt: -0.1, nose: 1.1, mouth: 'smile', height: 1.04 },
    tondelier: { hair: 0x4a2c1f, style: 'long', suit: 0x3c9a4e, shirt: 0xf2efe6, pin: 0x9be28f, brows: 0x4a2c1f, browTilt: -0.1, nose: 0.9, mouth: 'smile', height: 0.95, lips: 0xc0505a },
    lepen: { voxel: true, hair: 0xf0dc6e, style: 'long', suit: 0x1e2a5a, shirt: 0xf2efe6, pin: 0x2f55c4, brows: 0xc9a85e, browTilt: 0, nose: 1, mouth: 'smile', height: 0.98, lips: 0xb84a55 },
    philippe: { hair: 0x3a2a22, style: 'short', suit: 0x23324f, shirt: 0xffffff, tie: 0x3f6fd8, beard: 0x3a2a22, beardStreak: 0xe8e8e8, brows: 0x3a2a22, browTilt: 0.05, nose: 1.1, mouth: 'flat', height: 1.12 },
    retailleau: { hair: 0xb8b8b8, style: 'short', suit: 0x2a2f3a, shirt: 0xffffff, tie: 0x1f3f8f, glasses: true, brows: 0x8a8a8a, browTilt: 0.35, nose: 1.05, mouth: 'flat', height: 1 },
  };

  // apparence par défaut à partir de quelques traits (candidats ajoutés)
  function lookFrom(l) {
    const brows = new THREE.Color(l.hair || 0x333333).multiplyScalar(0.8).getHex();
    return { shirt: 0xf2efe6, brows, browTilt: 0, nose: 1, mouth: l.fem ? 'smile' : 'flat', height: 1, lips: l.fem ? 0xb84a55 : null, ...l };
  }
  // ── Candidat en style voxel (essai : Marine Le Pen, d'après l'image de référence) ──
  // tout en pavés : grosse tête cubique, cheveux en blocs, tailleur, col blanc, poignets blancs
  function buildVoxel(c, L) {
    const V = (color, sx, sy, sz, x, y, z) => { const m = mesh(G.box, mat(color, { roughness: 0.9 }), sx, sy, sz, x, y, z); m.castShadow = true; return m; };
    const SKIN_V = 0xf0c09a, suit = L.suit === 0x1e2a5a ? 0x1d1d22 : L.suit, hair = L.hair, white = 0xf4f4f0;
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const inner = new THREE.Group(); inner.scale.setScalar(1.25 * (L.height || 1)); body.add(inner);
    // jambes (pivot à la hanche)
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 5.5, 22, 0);
      hip.add(V(suit, 10, 22, 11, 0, -11, 0));
      hip.add(V(0x141418, 10.4, 4, 13, 0, -20, 1)); // chaussures
      inner.add(hip); legs.push(hip);
    }
    // buste : veste, chemise blanche en V
    inner.add(V(suit, 24, 24, 13, 0, 34, 0));
    inner.add(V(white, 8, 9, 1, 0, 41.5, 6.8));
    for (const s of [-1, 1]) { const lap = V(suit, 5, 11, 1.2, s * 4.2, 40, 7.1); lap.rotation.z = s * 0.45; inner.add(lap); }
    // bras (pivot à l'épaule) : manche, poignet blanc, main
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 16, 44, 0);
      sh.add(V(suit, 8, 18, 9, 0, -8, 0));
      sh.add(V(white, 8.6, 3, 9.6, 0, -17.5, 0));
      sh.add(V(SKIN_V, 8, 7, 8, 0, -22, 0));
      inner.add(sh); arms.push(sh);
    }
    // tête : gros cube, visage plat
    const head = new THREE.Group(); head.position.set(0, 46, 0); inner.add(head);
    head.add(V(SKIN_V, 30, 28, 26, 0, 15, 0));
    for (const s of [-1, 1]) {
      head.add(V(0x2a1a1e, 3.6, 5, 1, s * 6.5, 16, 13.2)); // yeux
      head.add(V(0xffffff, 1.4, 1.4, 1, s * 6.5 + 0.9, 17.6, 13.6)); // reflet
      head.add(V(0xf2a0aa, 5, 2.4, 1, s * 9.5, 11.2, 13.1)); // joues roses
      head.add(V(SKIN_V, 3.5, 6, 5, s * 16.6, 14, 1)); // oreilles
      head.add(V(0xffffff, 1.8, 2, 1.8, s * 17.2, 9.6, 2.5)); // boucles d'oreilles
    }
    head.add(V(0x9a5a50, 3.5, 1.3, 1, 0, 8.6, 13.1)); // bouche
    // cheveux : calotte à gradins, mèches sur le front, cheveux longs sur les côtés et dans le dos
    head.add(V(hair, 33, 8, 30, 0, 30, -0.5));
    head.add(V(hair, 30, 3, 27, 0, 35, -0.5));
    head.add(V(hair, 26, 2, 23, 0, 37.4, -0.5));
    head.add(V(hair, 32, 5, 4, 0, 25, 12.6)); // frange
    head.add(V(hair, 6, 3, 4, -9, 21.6, 12.6));
    head.add(V(hair, 4, 3, 4, 7, 22, 12.6));
    for (const s of [-1, 1]) {
      head.add(V(hair, 5, 34, 26, s * 16.6, 13, -1)); // côtés, longs jusqu'aux épaules
      head.add(V(hair, 4, 26, 4, s * 13.4, 15, 12.6)); // mèches qui encadrent le visage
    }
    head.add(V(hair, 33, 36, 5, 0, 13, -13.5)); // dos
    const ring = new THREE.Mesh(new THREE.RingGeometry(26, 33, 40), new THREE.MeshBasicMaterial({ color: hex(TEAMS[c.team].color), transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1.5; root.add(ring);
    if (c.isPlayer) {
      const pr = new THREE.Mesh(new THREE.RingGeometry(36, 41, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
      pr.rotation.x = -Math.PI / 2; pr.position.y = 1.6; root.add(pr);
    }
    const shield = new THREE.Mesh(G.sph, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, emissive: 0x88aaff, emissiveIntensity: 0.4, depthWrite: false }));
    shield.scale.set(42, 60, 42); shield.position.y = 50; shield.visible = false; root.add(shield);
    root.userData = { body, head, arms, legs, shield, phase: Math.random() * 6, px: c.x, py: c.y, face: 0 };
    return root;
  }

  function buildCandidate(c) {
    const L = LOOK[c.def.id] || lookFrom(c.def.look || {});
    if (L.voxel) return buildVoxel(c, L);
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const inner = new THREE.Group();
    inner.scale.setScalar(L.height);
    body.add(inner);
    const suit = mat(L.suit), trousers = mat(new THREE.Color(L.suit).multiplyScalar(0.7).getHex()), skin = mat(L.skin || SKIN);
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 7, 28, 0);
      hip.add(mesh(G.cyl, trousers, 5.5, 26, 5.5, 0, -13, 0));
      hip.add(mesh(G.box, mat(0x151515), 10, 5, 15, 0, -26, 3));
      inner.add(hip); legs.push(hip);
    }
    inner.add(mesh(G.cyl, suit, 15, 32, 12, 0, 44, 0));
    inner.add(mesh(G.box, mat(L.shirt), 9, 18, 1, 0, 51, 11.6));
    if (L.tie) inner.add(mesh(G.box, mat(L.tie), 3.2, 16, 1, 0, 49, 12.3));
    if (L.collar) inner.add(mesh(G.cyl, suit, 9, 4, 9, 0, 61, 0));
    if (L.pin) inner.add(mesh(G.sphLo, mat(L.pin, { emissive: L.pin, emissiveIntensity: 0.4 }), 2.2, 2.2, 1.5, -8, 54, 11.5));
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 17, 58, 0);
      sh.add(mesh(G.cyl, suit, 4.5, 26, 4.5, 0, -13, 0));
      sh.add(mesh(G.sph, skin, 4.5, 4.5, 4.5, 0, -27, 0));
      inner.add(sh); arms.push(sh);
    }
    const head = new THREE.Group(); head.position.set(0, 64, 0);
    inner.add(head);
    head.add(mesh(G.cyl, skin, 5, 6, 5, 0, 1, 0));
    head.add(mesh(G.sph, skin, 20, 21, 19, 0, 20, 0));
    head.add(mesh(G.sph, skin, 4, 6, 3, -19.5, 20, 0));
    head.add(mesh(G.sph, skin, 4, 6, 3, 19.5, 20, 0));
    for (const s of [-1, 1]) {
      head.add(mesh(G.sph, mat(0xffffff), 4.2, 4.6, 2.5, s * 7, 23, 16.5));
      head.add(mesh(G.sph, mat(0x1b1b1b), 2, 2.2, 1.5, s * 7, 23, 18.6));
      const brow = mesh(G.box, mat(L.brows), 8, 2, 2, s * 7, 30, 17);
      brow.rotation.z = -s * L.browTilt;
      head.add(brow);
    }
    head.add(mesh(G.sph, mat(L.skin ? new THREE.Color(L.skin).multiplyScalar(0.9).getHex() : 0xe9b292), 3.6 * L.nose, 4.2 * L.nose, 4 * L.nose, 0, 18, 19.5));
    const mouthMat = mat(L.lips || 0x7a2e2e);
    if (L.mouth === 'smile') { const m = new THREE.Mesh(new THREE.TorusGeometry(5, 1.1, 6, 16, Math.PI), mouthMat); m.position.set(0, 12, 17.6); m.rotation.z = Math.PI; head.add(m); }
    else if (L.mouth === 'open') head.add(mesh(G.sph, mat(0x5a1e1e), 4.5, 3, 2, 0, 11.5, 17.4));
    else head.add(mesh(G.box, mouthMat, 9, 1.6, 1, 0, 11.5, 18));
    if (L.beard) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), mat(L.beard));
      b.scale.set(20.5, 21, 19.5); b.position.set(0, 20, 0.5); head.add(b);
      if (L.beardStreak) head.add(mesh(G.box, mat(L.beardStreak), 4, 9, 2, 0, 5, 17));
      head.add(mesh(G.box, mat(0x7a2e2e), 8, 1.5, 1, 0, 11.5, 18.6));
    }
    if (L.stubble) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4), mat(L.stubble, { transparent: true, opacity: 0.35 }));
      b.scale.set(20.3, 21.2, 19.3); b.position.set(0, 20, 0); head.add(b);
    }
    if (L.glasses) {
      for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.8, 6, 16), mat(0x222222)); r.position.set(s * 7, 23, 19.3); head.add(r); }
      head.add(mesh(G.box, mat(0x222222), 5, 0.8, 0.8, 0, 23.5, 19.6));
    }
    const hair = mat(L.hair);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
    // calotte basculée vers l'arrière : couvre le crâne sans masquer le visage
    cap.castShadow = true;
    cap.position.set(0, 20, -0.5);
    cap.rotation.x = -0.55;
    if (L.style === 'swept') {
      cap.scale.set(21.6, 22.5, 21); head.add(cap);
      head.add(mesh(G.sph, hair, 6, 9, 12, -18, 22, -4)); head.add(mesh(G.sph, hair, 6, 9, 12, 18, 22, -4));
      const lock = mesh(G.sph, hair, 14, 6, 10, 4, 39, 5); lock.rotation.z = -0.3; head.add(lock);
    } else if (L.style === 'messy') {
      cap.scale.set(22, 23, 21.5); head.add(cap);
      for (let i = 0; i < 8; i++) head.add(mesh(G.sphLo, hair, 6.5, 6.5, 6.5, Math.cos(i * 0.8) * 12, 39 + (i % 2) * 2.5, Math.sin(i * 1.7) * 8 + 3));
    } else if (L.style === 'long') {
      cap.scale.set(22.5, 23.5, 21.8); head.add(cap);
      head.add(mesh(G.cyl, hair, 21.5, 28, 15, 0, 12, -7));
      for (const s of [-1, 1]) head.add(mesh(G.sph, hair, 7, 16, 11, s * 18.5, 14, -1));
      const fringe = mesh(G.sph, hair, 17, 6, 10, -4, 36, 11); fringe.rotation.z = 0.25; head.add(fringe);
    } else if (L.style === 'bald') {
      // crâne dégarni : couronne de cheveux sur l'arrière et les côtés
      const crown = new THREE.Mesh(new THREE.TorusGeometry(19, 3.2, 8, 24, Math.PI * 1.3), hair);
      crown.rotation.set(Math.PI / 2, 0, Math.PI * 0.35 + Math.PI); crown.position.set(0, 23, -2); head.add(crown);
    } else {
      cap.scale.set(21.2, 22.2, 20.6); head.add(cap);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(26, 33, 40), new THREE.MeshBasicMaterial({ color: hex(TEAMS[c.team].color), transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1.5; root.add(ring);
    if (c.isPlayer) {
      const pr = new THREE.Mesh(new THREE.RingGeometry(36, 41, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
      pr.rotation.x = -Math.PI / 2; pr.position.y = 1.6; root.add(pr);
    }
    const shield = new THREE.Mesh(G.sph, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, emissive: 0x88aaff, emissiveIntensity: 0.4, depthWrite: false }));
    shield.scale.set(42, 60, 42); shield.position.y = 50; shield.visible = false; root.add(shield);
    root.userData = { body, head, arms, legs, shield, phase: Math.random() * 6, px: c.x, py: c.y, face: 0 };
    return root;
  }

  // ── Militants ──
  const MIL = {};
  function milMats(team) {
    if (!MIL[team]) MIL[team] = { shirt: mat(hex(TEAMS[team].color)), cap: mat(hex(TEAMS[team].dark)) };
    return MIL[team];
  }
  const greyMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.45 });
  function buildMilitant(m) {
    const M = milMats(m.team);
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const legs = [];
    for (const s of [-1, 1]) { const hip = new THREE.Group(); hip.position.set(s * 4, 14, 0); hip.add(mesh(G.cylLo, mat(0x2e3440), 3, 14, 3, 0, -7, 0)); body.add(hip); legs.push(hip); }
    body.add(mesh(G.cylLo, M.shirt, 8, 18, 6.5, 0, 23, 0));
    body.add(mesh(G.sphLo, mat(SKIN), 7.5, 7.5, 7.5, 0, 38, 0));
    const capm = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.cap);
    capm.scale.set(8, 5, 8); capm.position.y = 40; body.add(capm);
    const arm = new THREE.Group(); arm.position.set(8, 30, 0); body.add(arm);
    arm.add(mesh(G.cylLo, M.shirt, 2.4, 14, 2.4, 0, -7, 0));
    if (m.ranged) { const c = mesh(G.cone, mat(0xf2f2f2), 5, 12, 5, 0, -14, 6); c.rotation.x = -Math.PI / 2; arm.add(c); }
    else arm.add(mesh(G.box, mat(0xffffff), 8, 11, 1, 0, -15, 3));
    g.userData = { body, legs, arm, px: m.x, py: m.y, phase: Math.random() * 6, conv: false };
    return g;
  }

  // ── Projectiles et effets ──
  // Les polémiques des candidats sont des phylactères (bulles de parole) ; un sort a une bulle pleine aux couleurs du camp.
  const bubbleTex = new Map();
  function bubble(text, team, spell) {
    const key = text + '|' + team + '|' + (spell ? 1 : 0);
    let b = bubbleTex.get(key);
    if (b) return b;
    const cv = document.createElement('canvas');
    const x = cv.getContext('2d');
    const fs = 44;
    x.font = `900 ${fs}px system-ui, sans-serif`;
    const tw = Math.ceil(x.measureText(text).width);
    const w = tw + 56, bh = 84, tail = 26, h = bh + tail;
    cv.width = w; cv.height = h;
    const col = TEAMS[team].color;
    const fill = spell ? col : '#ffffff', ink = spell ? '#ffffff' : '#15181d';
    x.lineWidth = 7; x.strokeStyle = spell ? '#ffffff' : col; x.fillStyle = fill;
    const r = 36, L = 4, T = 4, R = w - 4, B = bh;
    x.beginPath();
    x.moveTo(L + r, T); x.lineTo(R - r, T); x.quadraticCurveTo(R, T, R, T + r); x.lineTo(R, B - r); x.quadraticCurveTo(R, B, R - r, B);
    x.lineTo(w * 0.42, B); x.lineTo(w * 0.28, h - 3); x.lineTo(w * 0.3, B); // la queue de la bulle
    x.lineTo(L + r, B); x.quadraticCurveTo(L, B, L, B - r); x.lineTo(L, T + r); x.quadraticCurveTo(L, T, L + r, T);
    x.closePath(); x.fill(); x.stroke();
    x.fillStyle = ink; x.font = `900 ${fs}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, bh / 2 + 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    b = { tex, aspect: w / h };
    bubbleTex.set(key, b);
    return b;
  }
  function buildProj(p) {
    if (p.word && p.src && p.src.kind === 'cand') {
      const spell = p.kind === 'shot';
      const b = bubble(p.word, p.team, spell);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: b.tex, transparent: true, depthWrite: false }));
      const hgt = spell ? 62 + p.width * 0.4 : 40;
      sp.scale.set(hgt * b.aspect, hgt, 1);
      sp.center.set(0.3, 0);
      sp.renderOrder = 5;
      sp.userData.bubble = true;
      return sp;
    }
    if (p.kind === 'atk') {
      const col = p.bureau ? 0xffe27a : hex(TEAMS[p.team].light);
      return scaleTo(new THREE.Mesh(G.sphLo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 })), p.bureau ? 7 : p.small ? 4 : 8);
    }
    const g = new THREE.Group();
    const col = hex(TEAMS[p.team].color);
    g.add(scaleTo(new THREE.Mesh(G.sph, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8 })), p.width * 0.55));
    g.add(scaleTo(new THREE.Mesh(G.sph, new THREE.MeshBasicMaterial({ color: hex(TEAMS[p.team].light), transparent: true, opacity: 0.3, depthWrite: false })), p.width * 0.95));
    return g;
  }

  function buildFx(f) {
    const col = f.type === 'heal' || f.heal ? 0x5fd17a : f.type === 'zone' ? 0xff7a1a : hex(TEAMS[f.team].color);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(f.radius - 8, f.radius, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 3; g.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(f.radius, 64), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 2.5; g.add(disc);
    g.userData = { ring, disc };
    return g;
  }

  // ── Synchronisation avec l'état du jeu ──
  function sync(S, dt, t) {
    if (S !== lastS) { for (const o of live.values()) scene.remove(o); live.clear(); lastS = S; }
    const seen = new Set();
    const ensure = (e, build) => {
      let o = live.get(e);
      if (!o) { o = build(e); live.set(e, o); scene.add(o); }
      seen.add(e);
      return o;
    };
    if (S) {
      for (const c of S.cands) {
        const o = ensure(c, buildCandidate);
        o.visible = !c.dead;
        if (!c.dead) animateCand(o, c, S, dt, t);
      }
      for (const m of S.mil) animateMil(ensure(m, buildMilitant), m, dt);
      for (const p of S.proj) { const o = ensure(p, buildProj); o.position.set(p.x, o.userData.bubble ? 70 : p.bureau ? 50 : 55, p.y); }
      for (const f of S.fx) {
        const o = ensure(f, buildFx);
        o.position.set(f.x, 0, f.y);
        const u = o.userData;
        if (f.type === 'blast') {
          const p = f.done ? 1 : U.clamp((S.t - f.t0) / (f.at - f.t0), 0, 1);
          u.disc.scale.setScalar(Math.max(0.01, p));
          u.disc.material.opacity = f.done ? 0.5 : 0.25;
        } else if (f.type === 'ring') {
          const p = U.clamp((S.t - f.t0) / (f.until - f.t0), 0, 1);
          o.scale.setScalar(0.6 + 0.4 * p);
          u.ring.material.opacity = 0.9 * (1 - p); u.disc.material.opacity = 0.2 * (1 - p);
        }
      }
      S.bureaux.forEach((b, i) => {
        const u = statics.bureaux[i].userData;
        if (u.owner !== b.owner) {
          u.owner = b.owner;
          const m = mat(hex(TEAMS[b.owner].color));
          for (const p of u.posts) p.material = m;
          u.roof.material = m;
        }
        u.pips.forEach((p, k) => { p.material = k < b.g ? mat(hex(TEAMS[b.owner].color)) : mat(0x444c57); });
      });
      for (const k of ['top', 'mid', 'bot']) statics.obj[k].userData.ring.material.color.set(Render.gaugeColor(S.obj[k]));
      S.camps.forEach((c, i) => {
        const u = statics.camps[i].userData, on = S.t >= c.availableAt;
        if (u.crowd) u.crowd.visible = on;
        if (u.windows) u.windows.material = on ? mat(0xffe08a, { emissive: 0xffc94d, emissiveIntensity: 0.8 }) : mat(0x3a3a3a);
      });
    }
    for (const [e, o] of live) if (!seen.has(e)) { scene.remove(o); live.delete(e); if (o.isSprite) o.material.dispose(); }
    for (const f of statics.flags) f.rotation.y = Math.sin(t * 2 + f.id) * 0.25;
  }

  function animateCand(o, c, S, dt, t) {
    const u = o.userData;
    const vx = c.x - u.px, vy = c.y - u.py;
    const moving = Math.hypot(vx, vy) > 0.4;
    u.px = c.x; u.py = c.y;
    o.position.set(c.x, 0, c.y);
    let face = u.face;
    if (moving) face = Math.atan2(vx, vy);
    if (c.lastAtkAt && S.t - c.lastAtkAt < 0.4 && c.face !== undefined) face = Math.atan2(Math.cos(c.face), Math.sin(c.face));
    let d = face - u.face;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    u.face += d * Math.min(1, dt * 12);
    u.body.rotation.y = u.face;
    u.phase += dt * (moving ? 11 : 2);
    const sw = moving ? Math.sin(u.phase) * 0.7 : 0;
    u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
    u.arms[0].rotation.x = -sw * 0.8; u.arms[1].rotation.x = sw * 0.8;
    u.arms[0].rotation.z = -0.08; u.arms[1].rotation.z = 0.08;
    u.body.position.y = moving ? Math.abs(Math.sin(u.phase)) * 3 : Math.sin(u.phase) * 0.6;
    // geste de polémique : bras levé, index pointé
    if (c.lastAtkAt && S.t - c.lastAtkAt < 0.35) { u.arms[1].rotation.x = -2.3; u.arms[1].rotation.z = 0.15; }
    if (c.channel) { u.arms[0].rotation.x = -2.6; u.arms[1].rotation.x = -2.6; u.arms[0].rotation.z = -0.5 * Math.sin(t * 6); }
    u.head.rotation.z = c.stunUntil > S.t ? Math.sin(t * 14) * 0.25 : 0;
    u.shield.visible = c.shield > 0 && c.shieldUntil > S.t;
  }

  function animateMil(o, m, dt) {
    const u = o.userData;
    const vx = m.x - u.px, vy = m.y - u.py;
    const moving = Math.hypot(vx, vy) > 0.2;
    u.px = m.x; u.py = m.y;
    o.position.set(m.x, 0, m.y);
    if (moving) o.rotation.y = Math.atan2(vx, vy);
    u.phase += dt * (moving ? 12 : 3);
    const sw = moving ? Math.sin(u.phase) * 0.8 : 0;
    u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
    u.arm.rotation.x = m.voting ? -2.4 : m.target && m.atkCd > 0.8 ? -1.6 : -0.3;
    if (m.converted && !u.conv) {
      u.conv = true;
      o.traverse((x) => { if (x.isMesh) x.material = greyMat; });
    }
  }

  // ── Caméra / rendu ──
  function setCamera(x, y, dist) {
    cam.x = x; cam.y = y; cam.dist = dist;
    camera.position.set(x, dist * 0.86, y + dist * 0.62);
    camera.lookAt(x, 0, y - 40);
    sun.position.set(x + 600, 1500, y + 700);
    sun.target.position.set(x, 0, y);
  }

  function render() { renderer.render(scene, camera); }

  const v3 = new THREE.Vector3();
  function project(x, y, h, W, H) {
    v3.set(x, h || 0, y).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * W, y: (-v3.y * 0.5 + 0.5) * H, ok: v3.z < 1 };
  }
  const ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  function pickGround(mx, my, W, H) {
    ndc.set((mx / W) * 2 - 1, -(my / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return { x: cam.x, y: cam.y };
    return { x: hit.x, y: hit.z };
  }

  return { init, resize, sync, setCamera, render, project, pickGround, cam };
})();
