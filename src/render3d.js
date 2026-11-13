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
    upgradeCountryside(fields, [trunks, crowns]);
  }

  // ── Animaux qui se baladent : vaches et moutons à la campagne, chiens et chats dans les quartiers résidentiels ──
  const animals = [];
  function voxCow() {
    const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    b.add(vbox(0xf4f1ea, 20, 11, 10, 0, 13, 0));
    b.add(vbox(0x2a2a2a, 7, 7.5, 10.4, -3, 14, 0)); b.add(vbox(0x2a2a2a, 5, 5, 10.4, 6, 15, 0));
    b.add(vbox(0xf4f1ea, 8, 8, 8, 13, 17, 0)); b.add(vbox(0xf2a8a8, 3, 4, 7, 17.5, 15, 0));
    for (const s of [-1, 1]) { b.add(vbox(0xe8e0c8, 1.6, 3, 1.6, 12, 22, s * 3.5)); b.add(vbox(0x1b1b1b, 1, 1.4, 1, 16.6, 19, s * 2.4)); }
    const legs = [];
    for (const [x, z] of [[7, 3], [7, -3], [-7, 3], [-7, -3]]) { const l = vbox(0xf4f1ea, 3, 8, 3, x, 4, z); b.add(l); legs.push(l); }
    return { g, legs, speed: 14, scale: 1 };
  }
  function voxSheep() {
    const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    b.add(vbox(0xf2efe4, 14, 10, 10, 0, 11, 0));
    for (let i = 0; i < 5; i++) b.add(vbox(0xfaf8f0, 5, 4, 5, -5 + i * 2.5, 16.5, (i % 2 ? 2 : -2)));
    b.add(vbox(0x2a2a2a, 6, 6, 6, 9, 13, 0));
    for (const s of [-1, 1]) b.add(vbox(0x2a2a2a, 1.4, 1.6, 3, 9, 15, s * 3.6));
    const legs = [];
    for (const [x, z] of [[4, 3], [4, -3], [-4, 3], [-4, -3]]) { const l = vbox(0x2a2a2a, 2, 6, 2, x, 3, z); b.add(l); legs.push(l); }
    return { g, legs, speed: 12, scale: 0.9 };
  }
  function voxDog(i) {
    const cols = [0x9a6a3a, 0xd8b07a, 0x2a2a2a, 0xf2f2ee];
    const c = cols[i % cols.length], g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    b.add(vbox(c, 13, 6, 6, 0, 8, 0));
    b.add(vbox(c, 6, 6, 6, 7.5, 12, 0)); b.add(vbox(0x1b1b1b, 1.4, 1.4, 1.4, 11, 11.4, 0));
    for (const s of [-1, 1]) { b.add(vbox(new THREE.Color(c).multiplyScalar(0.7).getHex(), 1.6, 4, 2, 6.5, 13, s * 3.4)); b.add(vbox(0x1b1b1b, 0.8, 1, 0.8, 10.6, 13.4, s * 1.6)); }
    const tail = vbox(c, 1.6, 6, 1.6, -7, 11, 0); tail.rotation.z = 0.6; b.add(tail);
    const legs = [];
    for (const [x, z] of [[4.5, 2], [4.5, -2], [-4.5, 2], [-4.5, -2]]) { const l = vbox(c, 2, 5, 2, x, 2.5, z); b.add(l); legs.push(l); }
    return { g, legs, speed: 30, scale: 0.9 };
  }
  function spawnAnimals(blocks) {
    const rnd = Render.seeded(31415);
    const rural = blocks.filter((b) => b.rural && (b.crop === 1 || b.farm)), resid = blocks.filter((b) => b.resid);
    const add = (mk, list, n) => {
      if (!list.length) return;
      for (let i = 0; i < n; i++) {
        const home = list[Math.floor(rnd() * list.length)], A = mk(i);
        A.g.scale.setScalar(A.scale || 1);
        A.x = home.x + (rnd() - 0.5) * 30; A.z = home.y + (rnd() - 0.5) * 30; A.tx = A.x; A.tz = A.z;
        A.wait = rnd() * 4; A.list = list; A.ph = rnd() * 6; A.face = rnd() * 6;
        A.g.position.set(A.x, 0, A.z);
        scene.add(A.g); animals.push(A);
      }
    };
    add(voxCow, rural, 16);
    add(voxSheep, rural, 22);
    add(voxDog, resid, 12);
    add((i) => { const c = voxCat(i); return { g: c, legs: c.userData.legs, speed: 22, scale: 0.55 }; }, resid, 12);
  }
  function updateAnimals(dt) {
    for (const A of animals) {
      if (A.wait > 0) { A.wait -= dt; A.legs.forEach((l) => { l.rotation.z = 0; }); continue; }
      const dx = A.tx - A.x, dz = A.tz - A.z, d = Math.hypot(dx, dz);
      if (d < 2) {
        // choisit une nouvelle destination dans une parcelle voisine de son quartier
        const near = A.list.filter((b) => Math.hypot(b.x - A.x, b.y - A.z) < 220);
        const b = near.length ? near[Math.floor(Math.random() * near.length)] : A.list[0];
        A.tx = b.x + (Math.random() - 0.5) * 40; A.tz = b.y + (Math.random() - 0.5) * 40;
        A.wait = 1 + Math.random() * 5;
        continue;
      }
      const st = Math.min(d, A.speed * dt);
      A.x += (dx / d) * st; A.z += (dz / d) * st;
      A.face = Math.atan2(dz, dx);
      A.ph += dt * A.speed * 0.5;
      A.g.position.set(A.x, 0, A.z); A.g.rotation.y = -A.face;
      A.legs.forEach((l, i) => { l.rotation.z = Math.sin(A.ph + (i % 2) * Math.PI) * 0.5; });
    }
  }

  // ── Kits Kenney (CC0) : chargement et instanciation génériques ──
  async function loadKit(base, names) {
    const L = await getLoader();
    const out = {};
    await Promise.all(names.map(async (n) => {
      const gl = await L.loadAsync(`${base}${n}.glb`);
      gl.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gl.scene);
      const parts = [];
      gl.scene.traverse((o) => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); });
      out[n] = { box, size: box.getSize(new THREE.Vector3()), ctr: box.getCenter(new THREE.Vector3()), parts };
    }));
    return out;
  }
  // place[] = { x, z, size (plus grande dimension horizontale visée), ry, sy (étirement vertical), col }
  // h : hauteur absolue visée (clôtures, haies), sinon proportions du modèle ; matFor : matériau de remplacement
  function instanceModel(M, place, shadows, matFor) {
    if (!place.length) return;
    const base = new THREE.Matrix4(), pre = new THREE.Matrix4(), m4 = new THREE.Matrix4(), col = new THREE.Color();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    pre.makeTranslation(-M.ctr.x, -M.box.min.y, -M.ctr.z);
    const k0 = 1 / Math.max(M.size.x, M.size.z, 0.001);
    for (const part of M.parts) {
      const im = new THREE.InstancedMesh(part.geo, matFor ? matFor(part.mat) : part.mat, place.length);
      place.forEach((pl, i) => {
        const s = pl.size * k0;
        if (pl.h) pl.sy = pl.h / (M.size.y * s);
        q.setFromAxisAngle(up, pl.ry || 0);
        base.compose(pos.set(pl.x, pl.y || 0, pl.z), q, scl.set(s, s * (pl.sy || 1), s));
        im.setMatrixAt(i, m4.copy(base).multiply(pre).multiply(part.m));
        if (pl.col !== undefined) im.setColorAt(i, col.setHex(pl.col));
      });
      im.castShadow = !!shadows; im.receiveShadow = true;
      scene.add(im);
    }
  }
  const kitsOff = () => location.protocol === 'file:' || /[?&]blocs=1/.test(location.search);

  // ── Quartiers résidentiels : pavillons City Kit Suburban, jardins, clôtures, arbres ──
  function buildResidential(blocks) {
    // repli : petites maisons simples
    const rnd = Render.seeded(1848);
    const lots = [];
    for (const b of blocks) {
      const n = b.w > 52 && b.h > 52 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const dx = n === 4 ? (i % 2 ? 1 : -1) : (i ? 1 : -1), dz = n === 4 ? (i < 2 ? -1 : 1) : 0;
        lots.push({ x: b.x + dx * b.w / 4, z: b.y + dz * b.h / 4, size: n === 4 ? b.w / 2 - 4 : Math.min(b.w / 2 - 4, b.h - 8), ry: Math.floor(rnd() * 4) * Math.PI / 2, v: rnd(), b });
      }
    }
    const walls = new THREE.InstancedMesh(G.box, mat(0xe8dcc4), lots.length), roofs = new THREE.InstancedMesh(G.prism, mat(0xa8503a), lots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    lots.forEach((l, i) => {
      const w = l.size * 0.7;
      walls.setMatrixAt(i, m4.compose(p.set(l.x, w * 0.3, l.z), q.setFromEuler(e.set(0, l.ry, 0)), sc.set(w, w * 0.6, w * 0.8)));
      roofs.setMatrixAt(i, m4.compose(p.set(l.x, w * 0.6 + w * 0.15, l.z), q.setFromEuler(e.set(0, l.ry, Math.PI / 2)), sc.set(w * 0.3, w, w * 0.5)));
    });
    for (const im of [walls, roofs]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
    upgradeResidential(lots, [walls, roofs]);
  }
  async function upgradeResidential(lots, fallback) {
    if (kitsOff()) return;
    try {
      const names = 'abcdefghijklmnopqrstu'.split('').map((l) => 'building-type-' + l);
      const K = await loadKit('assets/kenney/suburban/', [...names, 'tree-large', 'tree-small', 'fence-1x3', 'planter']);
      const byV = names.map(() => []), trees = { 'tree-large': [], 'tree-small': [] }, fences = [], planters = [];
      const rnd = Render.seeded(1789);
      for (const l of lots) {
        byV[Math.floor(l.v * names.length)].push({ x: l.x, z: l.z, size: l.size * 0.92, ry: l.ry });
        if (rnd() < 0.6) (rnd() < 0.5 ? trees['tree-large'] : trees['tree-small']).push({ x: l.x + (rnd() - 0.5) * l.size, z: l.z + (rnd() - 0.5) * l.size, size: 10 + rnd() * 6, ry: rnd() * 6 });
        if (rnd() < 0.35) planters.push({ x: l.x + l.size * 0.45, z: l.z + l.size * 0.45, size: 5, ry: 0 });
      }
      // clôtures autour des pâtés
      const seen = new Set();
      for (const l of lots) {
        const b = l.b; if (seen.has(b)) continue; seen.add(b);
        if (rnd() < 0.5) fences.push({ x: b.x, z: b.y + (rnd() < 0.5 ? -1 : 1) * (b.h / 2 + 3), size: b.w * 0.95, h: 5, ry: 0 });
      }
      // variantes de toits : la texture d'origine (verte) décalée en tuiles rouges, ardoises bleues et gris
      const variants = ['none', 'hue-rotate(-115deg) saturate(1.2)', 'hue-rotate(95deg)', 'saturate(0.15) brightness(0.9)'].map((filter) => {
        const cache = new Map();
        return (m) => {
          if (filter === 'none' || !m.map || !m.map.image) return m;
          if (!cache.has(m)) {
            const img = m.map.image, cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            const x = cv.getContext('2d'); x.filter = filter; x.drawImage(img, 0, 0);
            const t = new THREE.CanvasTexture(cv); t.flipY = m.map.flipY; t.magFilter = m.map.magFilter; t.minFilter = m.map.minFilter;
            const nm = m.clone(); nm.map = t; cache.set(m, nm);
          }
          return cache.get(m);
        };
      });
      names.forEach((n, i) => {
        const groups = [[], [], [], []];
        byV[i].forEach((pl, j) => groups[(j + i) % 4].push(pl));
        groups.forEach((g, k) => instanceModel(K[n], g, CITY_SHADOWS, variants[k]));
      });
      for (const t in trees) instanceModel(K[t], trees[t], true);
      instanceModel(K['fence-1x3'], fences, false);
      instanceModel(K.planter, planters, false);
      for (const f of fallback) scene.remove(f);
    } catch (e) { console.warn('Kit Suburban indisponible, maisons simples conservées', e); }
  }

  // ── Campagne : cultures, arbres, clôtures, rochers (Nature Kit) ; haies, tonneaux, caisses (Platformer Kit) ──
  async function upgradeCountryside(fields, fallback) {
    if (kitsOff()) return;
    try {
      const NAT = ['crops_wheatStageB', 'crops_cornStageD', 'crop_pumpkin', 'crop_carrot', 'crops_leafsStageB', 'tree_oak', 'tree_default', 'tree_fat', 'tree_detailed', 'tree_pineRoundC', 'fence_simple', 'log_stack', 'rock_largeA', 'plant_bushLarge', 'flower_yellowA', 'flower_redA'];
      const [N, P] = await Promise.all([loadKit('assets/kenney/nature/', NAT), loadKit('assets/kenney/platformer/', ['hedge', 'barrel', 'crate', 'fence-rope', 'flowers'])]);
      const put = {}; const add = (k, pl) => (put[k] = put[k] || []).push(pl);
      const rnd = Render.seeded(2027);
      const CROP = ['crops_wheatStageB', null, 'crop_carrot', 'crops_cornStageD'];
      const TREES = ['tree_oak', 'tree_default', 'tree_fat', 'tree_detailed', 'tree_pineRoundC'];
      for (const b of fields) {
        const crop = CROP[b.crop];
        if (b.farm) {
          // cour de ferme : tonneaux, caisses, tas de bois
          add('P:barrel', { x: b.x + 22, z: b.y - 16, size: 6 }); add('P:crate', { x: b.x + 26, z: b.y - 8, size: 7, ry: rnd() });
          add('N:log_stack', { x: b.x - 24, z: b.y + 16, size: 14, ry: rnd() * 3 });
        } else if (crop) {
          // rangs de cultures
          for (let x = -b.w / 2 + 5; x < b.w / 2 - 2; x += 9) for (let z = -b.h / 2 + 5; z < b.h / 2 - 2; z += 9) {
            const k = crop === 'crop_carrot' && rnd() < 0.15 ? 'crop_pumpkin' : crop;
            add('N:' + k, { x: b.x + x, z: b.y + z, size: k === 'crops_cornStageD' ? 8 : 7, ry: rnd() * 6 });
          }
        } else {
          // prairie : fleurs et buissons
          for (let i = 0; i < 4; i++) add(rnd() < 0.5 ? 'N:flower_yellowA' : 'N:flower_redA', { x: b.x + (rnd() - 0.5) * b.w, z: b.y + (rnd() - 0.5) * b.h, size: 5 });
          if (rnd() < 0.5) add('N:plant_bushLarge', { x: b.x + (rnd() - 0.5) * b.w * 0.6, z: b.y + (rnd() - 0.5) * b.h * 0.6, size: 12 });
        }
        // bordures : clôture, haie ou rangée d'arbres
        const edge = rnd();
        const side = rnd() < 0.5 ? -1 : 1;
        if (edge < 0.35) add('N:fence_simple', { x: b.x, z: b.y + side * (b.h / 2 + 4), size: b.w, h: 6 });
        else if (edge < 0.6) add('P:hedge', { x: b.x, z: b.y + side * (b.h / 2 + 4), size: b.w, h: 8 });
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) add('N:' + TREES[Math.floor(rnd() * TREES.length)], { x: b.x - b.w / 2 + rnd() * b.w, z: b.y - side * (b.h / 2 + 5), size: 16 + rnd() * 10, ry: rnd() * 6 });
        if (rnd() < 0.15) add('N:rock_largeA', { x: b.x + (rnd() - 0.5) * b.w, z: b.y + (rnd() - 0.5) * b.h, size: 9, ry: rnd() * 6 });
      }
      for (const k in put) {
        const [kit, name] = k.split(':');
        instanceModel((kit === 'N' ? N : P)[name], put[k], name.startsWith('tree') || name === 'log_stack');
      }
      for (const f of fallback) scene.remove(f);
    } catch (e) { console.warn('Kits Nature / Platformer indisponibles, campagne simple conservée', e); }
  }

  function buildCity() {
    const blocks = Render.blockList();
    buildCountryside(blocks.filter((b) => b.rural));
    buildResidential(blocks.filter((b) => b.resid && !b.park));
    spawnAnimals(blocks);
    const houses = blocks.filter((b) => !b.park && !b.rural && !b.resid);
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
        const P = voxPerson(rnd, cols[i % 5]);
        P.g.position.set(x, 0, z); P.g.rotation.y = Math.PI + (rnd() - 0.5) * 0.6; // tournés vers la scène
        P.g.scale.setScalar(0.95 + rnd() * 0.2);
        if (rnd() < 0.4) P.arm.rotation.x = -2.6; // bras levé, ça applaudit
        crowd.add(P.g);
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
  // ── Candidats en style voxel, d'après leurs photos (cheveux, pilosité, lunettes, tenue) ──
  // hs : coupe (long, bob, short, swept, messy, curly, curlyLong, balding, bald, shaved, tied)
  // out : tenue (suit, sweater, tracksuit, casual, trench, tweed, tux) ; tie / bow : cravate, nœud papillon
  const VOX = {
    melenchon: { hair: 0xd9d9d9, hs: 'swept', glasses: 0x2a2a2a, suit: 0x22252c, tie: 0xc8202f, brow: 0xbfbfbf },
    glucksmann: { hair: 0x6b5a4e, hs: 'short', stubble: 0x5a4a40, suit: 0x2a3142 },
    tondelier: { hair: 0x6a4026, hs: 'bob', suit: 0x3c9a4e, fem: 1 },
    lepen: { hair: 0xf0dc6e, hs: 'long', suit: 0x1d1d22, fem: 1 },
    philippe: { hair: 0x55524e, hs: 'balding', beard: 0x8a8682, streak: 0xeeeeee, glasses: 0x1a1a1a, suit: 0x3a3f4a, tie: 0x2a3a6a, h: 1.1 },
    retailleau: { hair: 0xa8a8a8, hs: 'short', glasses: 0x111111, suit: 0x6a6d73, tie: 0x1f2f5a },
    arthaud: { hair: 0x6e665c, hs: 'short', glasses: 0x2a2a2a, out: 'trench', suit: 0xc8b48a, fem: 1 },
    batho: { hair: 0xc8c0a8, hs: 'curly', suit: 0x24304a, fem: 1 },
    bouamrane: { hair: 0x2a2420, hs: 'balding', glasses: 0x333333, stubble: 0x8a8a8a, skin: 0xb07a55, suit: 0x27304a, tie: 0x22283a },
    cazeneuve: { hair: 0x9a9a9a, hs: 'balding', glasses: 0x6a6a6a, suit: 0x23283a, tie: 0x2a3550 },
    kazib: { hair: 0x1a1612, hs: 'shaved', beard: 0x1a1612, skin: 0xc08f6a, out: 'casual', suit: 0x1b1b1d, shirt: 0xf4f4f0 },
    labib: { hair: 0x1e1612, hs: 'curlyLong', skin: 0xd2a07c, out: 'tracksuit', suit: 0x1b1b1d, fem: 1 },
    roussel: { hair: 0x8a8a84, hs: 'messy', suit: 0x2b2f38 },
    ruffin: { hair: 0x5a5550, hs: 'short', stubble: 0x5a5550, suit: 0x2b2f38 },
    attal: { hair: 0x1f1813, hs: 'messy', suit: 0x1d2440, h: 0.97 },
    becht: { hair: 0x2a221c, hs: 'short', suit: 0x22283a, tie: 0x2f55c4 },
    bertrand: { hair: 0xb8b8b8, hs: 'short', suit: 0x23283a, tie: 0x2a3a6a },
    dupontaignan: { hair: 0x7a7a78, hs: 'swept', suit: 0x22314f, tie: 0x2a3a6a },
    lisnard: { hair: 0x2a221c, hs: 'short', suit: 0x2a2f3a, tie: 0x3f6fd8, shirt: 0xcfe0f5 },
    philippot: { hair: 0x2a221c, hs: 'short', suit: 0x1d2440, tie: 0x1d2440, shirt: 0xcfe0f5 },
    platret: { hair: 0x5a5550, hs: 'short', suit: 0x1d2440, tie: 0x1a1a2a },
    villepin: { hair: 0xeaeaea, hs: 'swept', big: 1, suit: 0x1f2333, tie: 0x203050, h: 1.1 },
    zemmour: { hair: 0x3a332c, hs: 'balding', suit: 0x22283a, tie: 0x1f3f8f, h: 0.92 },
    asselineau: { hair: 0xdedede, hs: 'balding', suit: 0x22252c, tie: 0x1a1a1a },
    branco: { hair: 0x2a1d17, hs: 'messy', out: 'sweater', suit: 0xc0282e },
    cheve: { hair: 0x2a221c, hs: 'short', stubble: 0x3a2e28, eyepatch: 1, out: 'casual', suit: 0x3a3a3a, shirt: 0x2a3a5a },
    dubuisson: { hair: 0x1a1612, hs: 'short', skin: 0xb98a63, suit: 0x1f3a7a, shirt: 0xcfe0f5 },
    egger: { hair: 0x6b4a32, hs: 'tied', out: 'casual', suit: 0x2a2a2a, shirt: 0x3a3a3a, fem: 1 },
    markovic: { hair: 0x1f1612, hs: 'tied', out: 'tweed', suit: 0x1b1b1d, shirt: 0xd0287a, necklace: 0xd8b04a, fem: 1 },
    mikolajczak: { hair: 0x2a1d17, hs: 'curly', mustache: 0x2a1d17, out: 'casual', suit: 0x1b1b1d, shirt: 0x1b1b1d },
    polony: { hair: 0xd2693a, hs: 'curly', out: 'tweed', suit: 0x2a2a2a, shirt: 0xf4f0e6, fem: 1 },
    riner: { hair: 0x111111, hs: 'shaved', skin: 0x6a4530, out: 'tux', suit: 0x111111, bow: 0x111111, h: 1.25 },
    verdier: { hair: 0x4a3426, hs: 'short', suit: 0x3b4252, tie: 0x5a2a2a },
  };
  const VSKIN = 0xf0c09a;
  function vbox(color, sx, sy, sz, x, y, z, opts) {
    const m = mesh(G.box, mat(color, { roughness: 0.9, ...(opts || {}) }), sx, sy, sz, x, y, z);
    m.castShadow = true;
    return m;
  }
  // coiffures, relatives à la tête (cube 30 × 28 × 26, visage en z = +13)
  function voxHair(head, V) {
    const H = V.hair, add = (sx, sy, sz, x, y, z) => head.add(vbox(H, sx, sy, sz, x, y, z));
    const cap = (h) => { add(33, h, 30, 0, 26 + h / 2, -0.5); };
    const back = (h) => add(33, h, 5, 0, 29 - h / 2, -13.5);
    const sides = (h, w) => { for (const s of [-1, 1]) add(w || 3, h, 24, s * 16, 29 - h / 2, -1); };
    switch (V.hs) {
      case 'long':
      case 'curlyLong': {
        add(33, 8, 30, 0, 30, -0.5); add(30, 3, 27, 0, 35, -0.5); add(26, 2, 23, 0, 37.4, -0.5);
        add(32, 5, 4, 0, 25, 12.6); add(6, 3, 4, -9, 21.6, 12.6); add(4, 3, 4, 7, 22, 12.6);
        const w = V.hs === 'curlyLong' ? 8 : 5;
        for (const s of [-1, 1]) { add(w, 34, 26, s * (15 + w / 2 - 1), 13, -1); add(4, 26, 4, s * 13.4, 15, 12.6); }
        add(33 + (w - 5) * 2, 36, 6, 0, 13, -14);
        if (V.hs === 'curlyLong') for (let i = 0; i < 10; i++) add(7, 7, 7, ((i % 5) - 2) * 8, 30 + (i % 2) * 6 - Math.floor(i / 5) * 18, -12 + (i % 3) * 2);
        break;
      }
      case 'bob':
        add(33, 8, 30, 0, 30, -0.5); add(30, 3, 27, 0, 35, -0.5);
        add(32, 4, 4, 0, 26, 12.6);
        for (const s of [-1, 1]) { add(5, 22, 26, s * 16.6, 19, -1); add(4, 16, 4, s * 13.4, 20, 12.6); }
        add(33, 24, 5, 0, 19, -13.5);
        break;
      case 'short':
        cap(7); back(16); sides(10); add(30, 3, 4, 0, 28, 12.6);
        break;
      case 'swept': {
        const k = V.big ? 1.25 : 1;
        cap(7); back(16); sides(10);
        add(32 * k, 6 * k, 28, 0, 33 + 3 * k, -1); // volume sur le dessus
        const q = vbox(H, 24 * k, 6 * k, 9, 3, 33 + 3 * k, 10); q.rotation.z = -0.12; head.add(q); // mèche relevée
        if (V.big) for (const s of [-1, 1]) add(6, 12, 22, s * 18, 24, -2);
        break;
      }
      case 'messy':
        cap(7); back(16); sides(10); add(30, 3, 4, 0, 28, 12.6);
        for (let i = 0; i < 9; i++) add(6, 5, 6, ((i % 3) - 1) * 9 + (i % 2) * 2, 33 + (i % 2) * 2, ((Math.floor(i / 3)) - 1) * 9);
        break;
      case 'curly':
        cap(7); back(16); sides(10, 5);
        for (let i = 0; i < 12; i++) add(7, 7, 7, ((i % 4) - 1.5) * 8, 32 + (i % 2) * 2.5, (Math.floor(i / 4) - 1) * 9 + 1);
        for (const s of [-1, 1]) add(4, 8, 4, s * 12, 26, 12.8);
        break;
      case 'balding':
        back(14); sides(11);
        break;
      case 'shaved':
        head.add(vbox(H, 31, 1.6, 27, 0, 29.6, 0, { transparent: true, opacity: 0.55 }));
        break;
      case 'tied':
        cap(6); back(10); sides(9);
        add(30, 3, 3, 0, 28.5, 12.8);
        add(10, 10, 8, 0, 25, -18); // chignon
        break;
      default: break; // bald
    }
  }
  function voxFace(head, V) {
    const skin = V.skin || VSKIN;
    head.add(vbox(skin, 30, 28, 26, 0, 15, 0));
    for (const s of [-1, 1]) {
      head.add(vbox(skin, 3.5, 6, 5, s * 16.6, 14, 1)); // oreilles
      if (V.eyepatch && s < 0) {
        head.add(vbox(0x111111, 6.5, 6.5, 1, s * 6.5, 16, 13.4)); // cache-œil
      } else {
        head.add(vbox(0x2a1a1e, 3.6, 5, 1, s * 6.5, 16, 13.2));
        head.add(vbox(0xffffff, 1.4, 1.4, 1, s * 6.5 + 0.9, 17.6, 13.6));
      }
      head.add(vbox(V.brow || new THREE.Color(V.hair).multiplyScalar(0.75).getHex(), 6, 1.6, 1, s * 6.5, 21.5, 13.2));
      if (V.fem) {
        head.add(vbox(0xf2a0aa, 5, 2.4, 1, s * 9.5, 11.2, 13.1));
        head.add(vbox(0xffffff, 1.8, 2, 1.8, s * 17.2, 9.6, 2.5));
      }
    }
    if (V.eyepatch) { const st = vbox(0x111111, 34, 1.4, 1, 0, 20, 13.6); st.rotation.z = 0.32; head.add(st); }
    head.add(vbox(V.fem ? 0xb84a55 : 0x9a5a50, V.fem ? 4.5 : 4, 1.4, 1, 0, 8.6, 13.1)); // bouche
    const beard = V.beard || V.stubble;
    if (beard) {
      const o = V.stubble && !V.beard ? { transparent: true, opacity: 0.45 } : null;
      head.add(vbox(beard, 30.4, 9, 1.4, 0, 5.5, 13.4, o));
      for (const s of [-1, 1]) head.add(vbox(beard, 1.4, 13, 22, s * 15.4, 8, 1, o));
      head.add(vbox(beard, 12, 2.4, 1.6, 0, 10.4, 13.6, o));
      head.add(vbox(0x7a3a36, 4, 1.4, 1, 0, 8.6, 14.3)); // bouche visible dans la barbe
      if (V.streak) head.add(vbox(V.streak, 4, 9, 1.6, 0, 4.5, 13.8));
    }
    if (V.mustache) head.add(vbox(V.mustache, 10, 1.8, 1.4, 0, 10.6, 13.6, { transparent: true, opacity: 0.6 }));
    if (V.glasses) {
      const gc = V.glasses, f = (sx, sy, sz, x, y, z) => head.add(vbox(gc, sx, sy, sz, x, y, z));
      for (const s of [-1, 1]) {
        if (V.eyepatch && s < 0) continue;
        f(8.5, 1.2, 1, s * 6.5, 20, 13.9); f(8.5, 1.2, 1, s * 6.5, 12.4, 13.9);
        f(1.2, 8.8, 1, s * 6.5 - 4.2, 16.2, 13.9); f(1.2, 8.8, 1, s * 6.5 + 4.2, 16.2, 13.9);
        f(1, 1.2, 13, s * 15.3, 18, 7);
      }
      f(4.4, 1.2, 1, 0, 17.5, 13.9);
    }
  }
  function voxBody(inner, V) {
    const out = V.out || 'suit', jacket = V.suit || 0x2a2f3a, shirt = V.shirt || 0xf4f4f0;
    const trousers = out === 'trench' || out === 'tweed' ? 0x26262c : out === 'sweater' || out === 'casual' ? 0x2c3440 : jacket;
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 5.5, 22, 0);
      hip.add(vbox(trousers, 10, 22, 11, 0, -11, 0));
      hip.add(vbox(out === 'tracksuit' ? 0xf4f4f0 : 0x141418, 10.4, 4, 13, 0, -20, 1));
      inner.add(hip); legs.push(hip);
    }
    if (out === 'casual') {
      inner.add(vbox(shirt, 22, 24, 12.6, 0, 34, 0));
      for (const s of [-1, 1]) inner.add(vbox(jacket, 8, 24, 13.2, s * 8.5, 34, 0));
    } else {
      inner.add(vbox(jacket, 24, 24, 13, 0, 34, 0));
    }
    if (out === 'suit' || out === 'tux' || out === 'trench' || out === 'tweed') {
      const vw = out === 'tweed' ? 11 : 8;
      inner.add(vbox(shirt, vw, 9, 1, 0, 41.5, 6.8));
      for (const s of [-1, 1]) { const lap = vbox(jacket, 5, 11, 1.2, s * (vw / 2 + 0.2), 40, 7.1); lap.rotation.z = s * 0.45; inner.add(lap); }
      if (V.tie) { inner.add(vbox(V.tie, 2.6, 12, 1, 0, 38.5, 7.4)); inner.add(vbox(V.tie, 3.6, 2.4, 1.2, 0, 44.4, 7.5)); }
      if (V.bow) inner.add(vbox(V.bow, 7, 3, 1.4, 0, 44.5, 7.6));
      if (out === 'trench') inner.add(vbox(new THREE.Color(jacket).multiplyScalar(0.75).getHex(), 24.4, 2.2, 13.4, 0, 30, 0));
      if (out === 'tweed') for (let i = 0; i < 6; i++) inner.add(vbox(0xf4f0e6, 1, 1, 1, -9 + (i % 2) * 18, 26 + i * 3, 6.9));
    }
    if (out === 'sweater') inner.add(vbox(shirt, 10, 2, 1, 0, 45, 6.8));
    if (out === 'tracksuit') {
      inner.add(vbox(0xf4f4f0, 1, 22, 1, 0, 34, 6.8));
      inner.add(vbox(jacket, 12, 3, 13.4, 0, 45.5, 0));
    }
    if (V.necklace) for (let i = 0; i < 7; i++) inner.add(vbox(V.necklace, 1.6, 1.6, 1.6, (i - 3) * 1.7, 43 - Math.abs(i - 3) * 0.9, 7.2));
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 16, 44, 0);
      sh.add(vbox(jacket, 8, 18, 9, 0, -8, 0));
      if (out === 'tracksuit') sh.add(vbox(0xf4f4f0, 8.4, 16, 1, 0, -8, 4.3));
      if (out === 'suit' || out === 'tux' || out === 'tweed') sh.add(vbox(0xf4f4f0, 8.6, 3, 9.6, 0, -17.5, 0));
      sh.add(vbox(V.skin || VSKIN, 8, 7, 8, 0, -22, 0));
      inner.add(sh); arms.push(sh);
    }
    return { legs, arms };
  }
  function buildVoxel(c, V) {
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const inner = new THREE.Group(); inner.scale.setScalar(1.25 * (V.h || 1)); body.add(inner);
    const { legs, arms } = voxBody(inner, V);
    const head = new THREE.Group(); head.position.set(0, 46, 0); inner.add(head);
    voxFace(head, V);
    voxHair(head, V);
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

  // ── Petits personnages voxel : militants et public des meetings, hommes et femmes ──
  const HAIRS = [0x1f1612, 0x3a2a20, 0x6b4a32, 0xc9a25a, 0x8a8a84, 0x2a221c, 0x9a4a2a];
  const SKINS = [0xf0c09a, 0xe8b48c, 0xd2a07c, 0xb07a55, 0x8a5a3c, 0xf4cfb0];
  function voxPerson(rnd, shirtCol, opts) {
    const o = opts || {};
    const fem = rnd() < 0.5, hair = HAIRS[Math.floor(rnd() * HAIRS.length)], skin = SKINS[Math.floor(rnd() * SKINS.length)];
    const shirt = typeof shirtCol === 'number' ? mat(shirtCol, { roughness: 0.9 }) : shirtCol;
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const legs = [];
    const pants = fem && rnd() < 0.4 ? 0x2a3550 : 0x2e3440;
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 2.6, 12, 0);
      hip.add(vbox(pants, 4.6, 12, 5, 0, -6, 0)); hip.add(vbox(0x1a1a1a, 4.8, 2, 6, 0, -11, 0.6));
      body.add(hip); legs.push(hip);
    }
    const torso = new THREE.Mesh(G.box, shirt); torso.scale.set(11, 12, 6.5); torso.position.set(0, 18, 0); torso.castShadow = true; body.add(torso);
    const head = new THREE.Group(); head.position.set(0, 24, 0); body.add(head);
    head.add(vbox(skin, 11, 10, 9.5, 0, 5, 0));
    for (const s of [-1, 1]) head.add(vbox(0x2a1a1e, 1.6, 2.2, 0.6, s * 2.4, 5.2, 4.9));
    if (fem) head.add(vbox(0xf2a0aa, 2, 1, 0.6, -3.6, 3.2, 4.85), vbox(0xf2a0aa, 2, 1, 0.6, 3.6, 3.2, 4.85));
    if (o.cap) {
      head.add(vbox(o.cap, 12, 3, 10.5, 0, 10.6, 0));
      head.add(vbox(o.cap, 8, 1, 5, 0, 9.4, 6.5)); // visière
    } else head.add(vbox(hair, 12, 3, 10.5, 0, 10.6, -0.2));
    if (fem) {
      head.add(vbox(hair, 12, 10, 3, 0, 5, -5.2)); // cheveux longs dans le dos
      for (const s of [-1, 1]) head.add(vbox(hair, 2, 9, 9, s * 5.9, 5.5, -0.4));
      if (rnd() < 0.5) head.add(vbox(hair, 4, 7, 3, 0, 4, -7.5)); // queue de cheval
    } else {
      head.add(vbox(hair, 12, 5, 2.5, 0, 7.5, -4.9));
      if (rnd() < 0.25) head.add(vbox(hair, 10, 3, 1, 0, 1.8, 4.9, { transparent: true, opacity: 0.6 })); // barbe
    }
    const arm = new THREE.Group(); arm.position.set(7, 22, 0); body.add(arm);
    const sl = new THREE.Mesh(G.box, shirt); sl.scale.set(3.4, 10, 3.6); sl.position.set(0, -5, 0); arm.add(sl);
    arm.add(vbox(skin, 3.4, 3, 3.6, 0, -11, 0));
    const arm2 = new THREE.Group(); arm2.position.set(-7, 22, 0); body.add(arm2);
    const sl2 = new THREE.Mesh(G.box, shirt); sl2.scale.set(3.4, 10, 3.6); sl2.position.set(0, -5, 0); arm2.add(sl2);
    arm2.add(vbox(skin, 3.4, 3, 3.6, 0, -11, 0));
    return { g, body, legs, arm, arm2, fem };
  }

  function buildCandidate(c) {
    if (VOX[c.def.id]) return buildVoxel(c, VOX[c.def.id]);
    const L = LOOK[c.def.id] || lookFrom(c.def.look || {});
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
  let milSeed = 1;
  function buildMilitant(m) {
    const M = milMats(m.team);
    const rnd = Render.seeded(milSeed++ * 97 + 13);
    const P = voxPerson(rnd, M.shirt, { cap: TEAMS[m.team].dark ? hex(TEAMS[m.team].dark) : 0x222222 });
    const { g, body, legs, arm } = P;
    g.scale.setScalar(1.3);
    // militant à distance : mégaphone ; sinon bulletin de vote
    if (m.ranged) { const c = mesh(G.cone, mat(0xf2f2f2), 3.5, 8, 3.5, 0, -12, 4); c.rotation.x = -Math.PI / 2; arm.add(c); }
    else arm.add(vbox(0xffffff, 6, 8, 0.8, 0, -13, 2.5));
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
  // chat voxel (lâcher de chats) : corps, tête, oreilles, queue dressée
  function voxCat(colIdx) {
    const cols = [0xe8913a, 0x2a2a2a, 0xf2f2ee, 0x9a8a7a, 0xd8b07a];
    const c = cols[colIdx % cols.length], g = new THREE.Group(), b = new THREE.Group(); g.add(b);
    b.add(vbox(c, 16, 9, 8, 0, 9, 0));
    b.add(vbox(c, 9, 8, 8, 10, 14, 0));
    for (const s of [-1, 1]) { b.add(vbox(c, 2.4, 3, 2.4, 12, 19.5, s * 2.6)); b.add(vbox(0x1b1b1b, 1, 1.4, 1, 14.6, 15, s * 2)); }
    b.add(vbox(0xf2a0aa, 1.2, 1, 1.4, 14.7, 12.6, 0));
    const tail = vbox(c, 2.4, 12, 2.4, -9, 16, 0); tail.rotation.z = 0.35; b.add(tail);
    const legs = [];
    for (const [x, z] of [[5, 2.5], [5, -2.5], [-5, 2.5], [-5, -2.5]]) { const l = vbox(c, 2.6, 6, 2.6, x, 3, z); b.add(l); legs.push(l); }
    g.userData = { cat: true, legs, ph: Math.random() * 6 };
    return g;
  }
  let catN = 0;
  function buildProj(p) {
    if (p.kind === 'cat') return voxCat(catN++);
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
    updateAnimals(Math.min(dt, 0.1));
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
      for (const p of S.proj) {
        const o = ensure(p, buildProj);
        if (o.userData.cat) {
          const u = o.userData; u.ph += dt * 18;
          o.position.set(p.x, Math.abs(Math.sin(u.ph)) * 4, p.y); o.rotation.y = -(p.face || 0);
          u.legs.forEach((l, i) => { l.rotation.z = Math.sin(u.ph + (i % 2) * Math.PI) * 0.7; });
          continue;
        }
        o.position.set(p.x, o.userData.bubble ? 70 : p.bureau ? 50 : 55, p.y);
      }
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

  // ── Portraits voxel (menu, HUD) : rendu hors écran, mis en cache ──
  let pr = null;
  const portraits = new Map();
  function portrait(id, team) {
    const key = id + '|' + team;
    if (portraits.has(key)) return portraits.get(key);
    const V = VOX[id];
    if (!V) return null;
    if (!pr) {
      const canvas = document.createElement('canvas');
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(160, 160, false);
      const sc = new THREE.Scene();
      sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 0.75));
      const d = new THREE.DirectionalLight(0xffffff, 0.75); d.position.set(60, 120, 160); sc.add(d);
      const cam = new THREE.PerspectiveCamera(30, 1, 1, 2000);
      pr = { r, sc, cam };
    }
    const fake = { team, isPlayer: false, x: 0, y: 0, def: CAND_BY_ID[id] };
    const o = buildVoxel(fake, V);
    o.traverse((m) => { if (m.isMesh && m.geometry.type === 'RingGeometry') m.visible = false; });
    pr.sc.add(o);
    const h = 1.25 * (V.h || 1);
    // cadrage tête et épaules, légèrement de trois quarts
    pr.cam.position.set(26 * h, 80 * h, 82 * h); pr.cam.lookAt(0, 72 * h, 0);
    pr.r.render(pr.sc, pr.cam);
    const url = pr.r.domElement.toDataURL('image/png');
    pr.sc.remove(o);
    portraits.set(key, url);
    return url;
  }

  return { init, resize, sync, setCamera, render, project, pickGround, cam, portrait };
})();
