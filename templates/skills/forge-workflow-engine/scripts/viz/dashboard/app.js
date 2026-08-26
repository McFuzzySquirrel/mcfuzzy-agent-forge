/* global Pixi */
"use strict";

// ─── The Squirrel Forge ───────────────────────────────────────────────────────
// Live PixiJS dashboard for the forge-workflow-engine. Connects to the viz
// server over SSE (/api/events) with an initial snapshot (/api/manifest +
// /api/state), renders the build DAG as a growing oak tree, and maps every
// audit event to a squirrel doing its job.

const P = Pixi;

// ─── Small utilities ──────────────────────────────────────────────────────────

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

function hashString(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function rand(a, b) { return a + Math.random() * (b - a); }

function $id(id) { return document.getElementById(id); }

/** Updates the HUD status line so connection state is always visible. */
function setStatus(text, kind) {
  const meta = $id("meta");
  if (!meta) return;
  meta.textContent = text;
  meta.className = kind || "";
}

// The renderer is set once the Pixi app initializes; texture factories below
// use it to bake procedural Graphics into reusable textures.
let RENDERER = null;

function toTexture(target) {
  return RENDERER.generateTexture({ target });
}

// Bezier point along a cubic (used for acorn travel paths).
function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function edgePath(from, to, sag) {
  const p0 = { x: from.x, y: from.y };
  const p3 = { x: to.x, y: to.y };
  const midX = (p0.x + p3.x) / 2;
  const midY = Math.min(p0.y, p3.y) - sag;
  return { p0, p1: { x: midX, y: midY }, p2: { x: midX, y: midY }, p3 };
}

// ─── Texture factories (procedural, no assets) ────────────────────────────────

function circleTexture(radius, color, alpha = 1) {
  const g = new P.Graphics();
  g.circle(radius, radius, radius).fill({ color, alpha });
  return toTexture(g);
}

function softGlowTexture(radius, color) {
  const g = new P.Graphics();
  const steps = 8;
  for (let i = 0; i < steps; i += 1) {
    const r = radius * (1 - i / steps);
    const a = (1 - i / steps) ** 2 * 0.35;
    g.circle(radius, radius, r).fill({ color, alpha: a });
  }
  return toTexture(g);
}

function acornTexture() {
  const g = new P.Graphics();
  g.ellipse(26, 40, 13, 16).fill({ color: 0x8a5a2b });
  g.ellipse(26, 40, 13, 16).stroke({ width: 2, color: 0x5f3c1a });
  g.arc(26, 28, 13, Math.PI, 0).lineTo(26, 20).closePath().fill({ color: 0x5f3c1a });
  g.rect(25, 16, 2, 6).fill({ color: 0x7a5a2f });
  return toTexture(g);
}

function squirrelTextures(hue) {
  const fur = hslToHex(hue, 55, 48);
  const furDark = hslToHex(hue, 55, 32);
  const cream = 0xf2e3c4;

  const body = new P.Graphics();
  // tail (drawn behind)
  body.circle(-14, -6, 22).fill({ color: furDark });
  body.circle(-8, 2, 14).fill({ color: furDark });
  body.ellipse(-16, -2, 24, 16).fill({ color: cream });
  // body
  body.ellipse(2, 4, 24, 30).fill({ color: fur });
  body.ellipse(2, 4, 24, 30).stroke({ width: 2.5, color: furDark });
  body.ellipse(6, 10, 12, 18).fill({ color: cream, alpha: 0.9 });
  // head
  body.circle(20, -20, 16).fill({ color: fur });
  body.circle(20, -20, 16).stroke({ width: 2.5, color: furDark });
  // ears
  body.poly([8, -32, 14, -44, 18, -32]).fill({ color: fur });
  body.poly([8, -32, 14, -44, 18, -32]).stroke({ width: 2, color: furDark });
  body.poly([24, -34, 28, -46, 33, -34]).fill({ color: fur });
  body.poly([24, -34, 28, -46, 33, -34]).stroke({ width: 2, color: furDark });
  body.poly([11, -38, 14, -44, 17, -38]).fill({ color: cream, alpha: 0.85 });
  // muzzle + nose
  body.circle(33, -14, 7).fill({ color: cream });
  body.circle(37, -15, 3).fill({ color: 0x241610 });
  // feet
  body.ellipse(-4, 34, 8, 5).fill({ color: furDark });
  body.ellipse(12, 35, 8, 5).fill({ color: furDark });

  const tail = new P.Graphics();
  tail.circle(0, 0, 22).fill({ color: furDark });
  tail.circle(-2, 4, 13).fill({ color: cream });
  tail.circle(0, 0, 22).stroke({ width: 2.5, color: furDark });

  const eye = new P.Graphics();
  eye.circle(0, 0, 3).fill({ color: 0x1a0f08 });
  eye.circle(-1, -1, 1).fill({ color: 0xffffff });

  return {
    body: toTexture(body),
    tail: toTexture(tail),
    eye: toTexture(eye),
    fur,
    furDark,
  };
}

function leafTexture(color) {
  const g = new P.Graphics();
  g.ellipse(0, 0, 9, 5).fill({ color });
  g.moveTo(0, 0).lineTo(-9, 0).stroke({ width: 1.5, color: 0x225e30 });
  return toTexture(g);
}

// ─── Squirrel actor ───────────────────────────────────────────────────────────

function createSquirrel(x, y, hue, name) {
  const tex = squirrelTextures(hue);

  const body = new P.Sprite(tex.body);
  body.anchor.set(0.5, 0.5);
  const tail = new P.Sprite(tex.tail);
  tail.anchor.set(0.9, 0.6);
  tail.position.set(-14, -8);
  const eye = new P.Sprite(tex.eye);
  eye.anchor.set(0.5);
  eye.position.set(24, -22);
  const nameLabel = new P.Text({
    text: name,
    style: {
      fontFamily: "system-ui, sans-serif",
      fontSize: 12,
      fill: 0xe8eaff,
      stroke: { color: 0x0b0e1a, width: 3 },
      fontVariant: "small-caps",
    },
  });
  nameLabel.anchor.set(0.5, 0);
  nameLabel.position.set(0, 42);
  nameLabel.alpha = 0.9;

  const root = new P.Container();
  root.position.set(x, y);
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = new P.Circle(0, 0, 36);
  root.addChild(body, tail, eye, nameLabel);

  const actor = {
    root,
    name,
    hue,
    tex,
    state: { pose: "idle", t: 0, gather: null, gauge: 0 },
    setPose(pose) {
      if (actor.state.pose !== "gather" || pose === "gather") actor.state.pose = pose;
      actor.state.t = 0;
    },
  };

  return actor;
}

// ─── Ephemeral particle burst (leaf / gold spark showers) ─────────────────────

function createBurstLayer() {
  const layer = new P.Container();
  const live = [];
  const leafTex = leafTexture(0x5ed36a);
  const goldTex = softGlowTexture(10, 0xf5c542);

  function spawn(x, y, kind = "leaf", count = 10) {
    const texture = kind === "gold" ? goldTex : leafTex;
    const palette = kind === "gold" ? 0xf5c542 : 0x4fae5a;
    for (let i = 0; i < count; i += 1) {
      const s = new P.Sprite(texture);
      s.anchor.set(0.5);
      s.tint = palette;
      s.position.set(x, y);
      const angle = rand(0, Math.PI * 2);
      const speed = rand(30, 160);
      const scale = rand(0.5, 1.4);
      s.scale.set(scale);
      s.rotation = rand(0, Math.PI * 2);
      live.push({
        s,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        gravity: 220,
        drag: 0.92,
        rot: rand(-3, 3),
        life: rand(0.8, 1.6),
        age: 0,
        baseScale: scale,
      });
      layer.addChild(s);
    }
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const p = live[i];
      p.age += dt;
      if (p.age >= p.life) {
        layer.removeChild(p.s);
        p.s.destroy();
        live.splice(i, 1);
        continue;
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.rot * dt;
      p.s.position.set(p.x, p.y);
      p.s.rotation += p.rot * dt;
      const k = 1 - p.age / p.life;
      p.s.alpha = clamp(k, 0, 1);
      p.s.scale.set(p.baseScale * clamp(k * 1.4, 0.2, 1.2));
    }
  }

  return { layer, spawn, update };
}

// ─── The dashboard app ────────────────────────────────────────────────────────

(async function main() {
  const app = new P.Application();
  await app.init({
    resizeTo: window,
    background: 0x070b16,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
    eventFeatures: { move: true, globalMove: true, click: true, wheel: true },
  });
  document.getElementById("canvas-host").appendChild(app.canvas);
  RENDERER = app.renderer;

  const screenW = () => app.screen.width;
  const screenH = () => app.screen.height;

  // ── Layers ────────────────────────────────────────────────────────────────
  const sky = new P.Graphics();
  const moon = new P.Container();
  const cloudLayer = new P.Container();
  const backgroundLayer = new P.Container();
  backgroundLayer.addChild(sky, moon, cloudLayer);

  const trunk = new P.Graphics();
  const branches = new P.Container();
  const treeLayer = new P.Container();
  treeLayer.addChild(trunk, branches);

  const edgeGfx = new P.Graphics();
  const edgeLayer = new P.Container();
  edgeLayer.addChild(edgeGfx);

  const squirrelLayer = new P.Container();
  const acornLayer = new P.Container();
  const leafBloom = new P.Container();
  const effectsLayer = createBurstLayer();

  const world = new P.Container();
  world.addChild(treeLayer, edgeLayer, leafBloom, squirrelLayer, acornLayer, effectsLayer.layer);

  const panArea = new P.Graphics();
  panArea.eventMode = "static";
  panArea.cursor = "grab";

  app.stage.eventMode = "static";
  app.stage.addChild(backgroundLayer, world, panArea);

  // ── Fireflies + falling leaves ────────────────────────────────────────────
  const fireflyTex = softGlowTexture(8, 0xffe9a8);
  const fireflies = new P.ParticleContainer({
    texture: fireflyTex,
    boundsArea: new P.Rectangle(0, 0, 1600, 1200),
    dynamicProperties: { position: true, color: true },
    blendMode: "add",
  });
  const fireflyState = [];
  for (let i = 0; i < 140; i += 1) {
    const p = new P.Particle({
      texture: fireflyTex,
      x: rand(0, 1600),
      y: rand(0, 1200),
      scaleX: rand(0.3, 1),
      scaleY: rand(0.3, 1),
      anchorX: 0.5,
      anchorY: 0.5,
      tint: 0xffe9a8,
    });
    fireflies.addParticle(p);
    fireflyState.push({ p, phase: rand(0, Math.PI * 2), speed: rand(6, 22), amp: rand(10, 40), base: p.x });
  }
  backgroundLayer.addChild(fireflies);

  const leafTexP = leafTexture(0x3f9d4f);
  const fallingLeaves = new P.ParticleContainer({
    texture: leafTexP,
    boundsArea: new P.Rectangle(0, 0, 1600, 1200),
    dynamicProperties: { position: true, rotation: true },
  });
  const fallState = [];
  for (let i = 0; i < 46; i += 1) {
    const p = new P.Particle({
      texture: leafTexP,
      x: rand(0, 1600),
      y: rand(0, 1200),
      scaleX: rand(0.5, 1.2),
      scaleY: rand(0.5, 1.2),
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: rand(0, Math.PI * 2),
      tint: rand(0, 1) > 0.6 ? 0xd99a3f : 0x3f9d4f,
    });
    fallingLeaves.addParticle(p);
    fallState.push({ p, drift: rand(6, 18), rot: rand(-1.5, 1.5), tintPulse: rand(0, Math.PI * 2) });
  }
  backgroundLayer.addChild(fallingLeaves);

  // ── Camera pan / zoom ────────────────────────────────────────────────────
  let dragging = false;
  let dragStart = new P.Point();
  let worldStart = new P.Point();
  let scale = 1;

  function resize() {
    sky.clear();
    const w = screenW();
    const h = screenH();
    const grad = new P.FillGradient({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x070b16 },
        { offset: 0.55, color: 0x141a33 },
        { offset: 1, color: 0x2a2f4a },
      ],
    });
    sky.rect(0, 0, w, h).fill(grad);
    panArea.clear();
    panArea.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.001 });
  }

  panArea.on("pointerdown", (e) => {
    dragging = true;
    panArea.cursor = "grabbing";
    dragStart.set(e.global.x, e.global.y);
    worldStart.set(world.x, world.y);
  });
  app.stage.on("pointerup", () => { dragging = false; panArea.cursor = "grab"; });
  app.stage.on("pointerupoutside", () => { dragging = false; panArea.cursor = "grab"; });
  app.stage.on("globalpointermove", (e) => {
    if (!dragging) return;
    world.position.set(
      worldStart.x + (e.global.x - dragStart.x),
      worldStart.y + (e.global.y - dragStart.y),
    );
  });
  app.stage.on("wheel", (e) => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    const newScale = clamp(scale * factor, 0.25, 2.5);
    const k = newScale / scale;
    // zoom around cursor
    world.x = e.global.x - (e.global.x - world.x) * k;
    world.y = e.global.y - (e.global.y - world.y) * k;
    scale = newScale;
    world.scale.set(scale);
  });
  window.addEventListener("resize", () => {
    resize();
    fitCamera();
  });
  resize();

  // ── Moon + clouds (static backdrop, slight parallax) ─────────────────────
  const moonGlow = new P.Sprite(softGlowTexture(90, 0xe8e6ff));
  moonGlow.anchor.set(0.5);
  moonGlow.position.set(1100, 120);
  moonGlow.alpha = 0.5;
  const moonCore = new P.Sprite(circleTexture(38, 0xf4f2ff));
  moonCore.anchor.set(0.5);
  moonCore.position.set(1100, 120);
  moon.addChild(moonGlow, moonCore);

  const cloudTex = circleTexture(46, 0x8f9cc4, 0.16);
  for (let i = 0; i < 7; i += 1) {
    const c = new P.Sprite(cloudTex);
    c.anchor.set(0.5);
    c.position.set(rand(0, 1600), rand(60, 420));
    c.scale.set(rand(0.6, 1.8), rand(0.4, 1));
    cloudLayer.addChild(c);
  }

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    manifest: null,
    layout: null,
    nodes: new Map(),      // taskId -> { task, actor, leaf }
    edges: [],
    phases: new Map(),     // phaseId -> { phase, branch, knot, sprouted }
    startedAt: null,
    status: "idle",
    running: false,
    counts: { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 },
    total: 0,
  };

  const trunkGrowth = { current: 0, target: 0 };
  const moonPhase = { x: 1100, y: 120, glow: 0 };

  // ── Tree drawing ─────────────────────────────────────────────────────────
  function drawTree() {
    const layout = state.layout;
    if (!layout) return;
    const trunkX = layout.trunkX;
    const bottom = layout.trunkBottom;
    const top = layout.trunkTop;
    const growthT = easeOutCubic(clamp(trunkGrowth.current / (top - bottom + 1), 0, 1));
    const baseW = 26 + 34 * growthT;
    const growY = lerp(bottom, top, growthT);

    trunk.clear();
    trunk.moveTo(trunkX - baseW / 2, bottom + 30);
    trunk.lineTo(trunkX - baseW * 0.35, growY);
    trunk.lineTo(trunkX + baseW * 0.35, growY);
    trunk.lineTo(trunkX + baseW / 2, bottom + 30);
    trunk.closePath().fill({ color: 0x4a2f18 });
    trunk.moveTo(trunkX - baseW / 2, bottom + 30)
      .lineTo(trunkX - baseW * 0.35, growY)
      .lineTo(trunkX + baseW * 0.35, growY)
      .lineTo(trunkX + baseW / 2, bottom + 30)
      .closePath()
      .stroke({ width: 3, color: 0x2c1a0c });
  }

  function drawWhorlBranch(phaseEntry) {
    const phase = phaseEntry.phase;
    const t = phaseEntry.sproutT;
    if (phaseEntry.branch) {
      phaseEntry.branch.clear();
      const span = clamp(t, 0, 1);
      const halfSpan = span * 300;
      const w = 7 * (1 - span * 0.6) + 2;
      phaseEntry.branch.moveTo(state.layout.trunkX - halfSpan, phase.y)
        .lineTo(state.layout.trunkX + halfSpan, phase.y)
        .stroke({ width: w, cap: "round", color: 0x6d4526 });
      phaseEntry.branch.moveTo(state.layout.trunkX - halfSpan, phase.y)
        .quadraticCurveTo(state.layout.trunkX - halfSpan * 0.5, phase.y - 26, state.layout.trunkX, phase.y)
        .stroke({ width: 3, cap: "round", color: 0x8a5a33 });
      phaseEntry.branch.moveTo(state.layout.trunkX + halfSpan, phase.y)
        .quadraticCurveTo(state.layout.trunkX + halfSpan * 0.5, phase.y - 26, state.layout.trunkX, phase.y)
        .stroke({ width: 3, cap: "round", color: 0x8a5a33 });
    }
    if (phaseEntry.knot) {
      phaseEntry.knot.clear();
      const r = 6 + 4 * clamp(t, 0, 1);
      phaseEntry.knot.circle(state.layout.trunkX, phase.y, r).fill({ color: 0x7a4c26 });
    }
  }

  function sproutWhorl(phaseId) {
    const entry = state.phases.get(phaseId);
    if (!entry || entry.sprouted) return;
    entry.sprouted = true;
    entry.sproutT = 0;
    trunkGrowth.target = Math.min(trunkGrowth.target, state.layout.trunkTop);
  }

  // ── Edges ────────────────────────────────────────────────────────────────
  const EDGE_COLORS = { dependency: 0x55c8e6, artifact: 0xf5b942, phase: 0x4f8f4f };

  function drawEdges() {
    edgeGfx.clear();
    for (const edge of state.edges) {
      const from = state.nodes.get(edge.from);
      const to = state.nodes.get(edge.to);
      if (!from || !to) continue;
      const path = edgePath(from.task, to.task, 70);
      const doneFrom = from.status === "complete" || from.status === "skipped";
      const doneTo = to.status === "complete" || to.status === "skipped";
      const alpha = doneFrom && doneTo ? 0.55 : 0.22;
      edgeGfx.moveTo(path.p0.x, path.p0.y)
        .bezierCurveTo(path.p1.x, path.p1.y, path.p2.x, path.p2.y, path.p3.x, path.p3.y)
        .stroke({ width: 2, cap: "round", color: EDGE_COLORS[edge.kind], alpha });
    }
  }

  // ── Squirrel status → pose ───────────────────────────────────────────────
  function applyStatusToNode(entry, status) {
    entry.status = status;
    const actor = entry.actor;
    switch (status) {
      case "running": actor.setPose("busy"); break;
      case "complete": actor.setPose("complete"); break;
      case "failed": actor.setPose("failed"); break;
      case "skipped": actor.setPose("skip"); break;
      default: actor.setPose("idle");
    }
    // leaf bloom
    const leaf = entry.leaf;
    if (leaf) {
      if (status === "complete") { leaf.visible = true; leaf.tint = 0x5ed36a; }
      else if (status === "failed") { leaf.visible = true; leaf.tint = 0xa85a3a; }
    }
  }

  function computeCounts() {
    const counts = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 };
    for (const node of state.nodes.values()) counts[node.status] += 1;
    state.counts = counts;
  }

  function updateHud() {
    const { counts, total } = state;
    $id("acorn-count").textContent = `${counts.complete} / ${total}`;
    $id("progress-fill").style.width = `${total ? Math.round((counts.complete / total) * 100) : 0}%`;
    const chips = [];
    for (const key of ["pending", "running", "complete", "failed", "skipped"]) {
      if (counts[key] > 0) {
        chips.push(`<span class="chip stat">${key} <b>${counts[key]}</b></span>`);
      }
    }
    $id("status-chips").innerHTML = chips.join("");
    buildLegend();
  }

  function buildLegend() {
    const legend = $id("legend");
    const byAgent = new Map();
    for (const node of state.nodes.values()) {
      if (!node.task.ownerAgent) continue;
      if (!byAgent.has(node.task.ownerAgent)) {
        byAgent.set(node.task.ownerAgent, { name: node.actor.name, hue: node.actor.hue });
      }
    }
    const chips = [];
    for (const [agent, info] of byAgent) {
      const color = hslToHex(info.hue, 55, 55);
      chips.push(
        `<span class="chip"><span class="dot" style="background:#${color.toString(16).padStart(6, "0")}"></span>${info.name} (${agent})</span>`,
      );
    }
    legend.innerHTML = chips.join("");
  }

  // ── Camera fit ───────────────────────────────────────────────────────────
  function fitCamera() {
    if (!state.layout || state.layout.tasks.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const task of state.layout.tasks) {
      minX = Math.min(minX, task.x); maxX = Math.max(maxX, task.x);
      minY = Math.min(minY, task.y); maxY = Math.max(maxY, task.y);
    }
    const pad = 140;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    scale = clamp(Math.min(screenW() / bw, screenH() / bh), 0.3, 1.4);
    world.scale.set(scale);
    world.position.set(
      screenW() / 2 - ((minX + maxX) / 2) * scale,
      screenH() / 2 - ((minY + maxY) / 2) * scale + 30,
    );
  }

  // ── Build scene from manifest ────────────────────────────────────────────
  function buildScene(manifest, layout) {
    if (!layout) layout = layoutManifestFallback(manifest);
    state.manifest = manifest;
    state.layout = layout;

    // Idempotent: clear any previous scene so a reconnect/restart rebuilds cleanly.
    for (const node of state.nodes.values()) {
      squirrelLayer.removeChild(node.actor.root);
      node.actor.root.destroy();
    }
    state.nodes.clear();
    state.phases.clear();
    state.edges.length = 0;
    branches.removeChildren().forEach((g) => g.destroy());
    leafBloom.removeChildren().forEach((s) => s.destroy());

    trunkGrowth.current = layout.trunkBottom;
    trunkGrowth.target = layout.trunkTop;

    for (const phase of layout.phases) {
      const branch = new P.Graphics();
      const knot = new P.Graphics();
      branches.addChild(branch, knot);
      state.phases.set(phase.id, { phase, branch, knot, sprouted: false, sproutT: 0 });
    }

    for (const task of layout.tasks) {
      const hue = task.ownerAgent ? hashString(task.ownerAgent) % 360 : 210;
      const actor = createSquirrel(task.x, task.y, hue, squirrelName(task.ownerAgent));
      squirrelLayer.addChild(actor.root);
      actor.root.on("pointerover", () => showTooltip(task, actor));
      actor.root.on("pointerout", hideTooltip);
      actor.root.on("pointertap", (e) => {
        e.stopPropagation();
        showPanel(task, actor);
      });

      const leaf = new P.Sprite(leafTexture(0x5ed36a));
      leaf.anchor.set(0.5, 1);
      leaf.position.set(task.x, task.y - 42);
      leaf.visible = false;
      leaf.rotation = rand(-0.4, 0.4);
      leafBloom.addChild(leaf);

      state.nodes.set(task.id, {
        task,
        actor,
        leaf,
        status: "pending",
        gauge: 0,
      });
    }

    for (const edge of layout.edges) state.edges.push(edge);

    const byAgent = new Map();
    for (const task of layout.tasks) {
      if (!task.ownerAgent) continue;
      byAgent.set(task.ownerAgent, state.nodes.get(task.id).actor.hue);
    }

    drawEdges();
    drawTree();
    fitCamera();
  }

  // Fallback layout when the server doesn't ship one (should not happen).
  function layoutManifestFallback(manifest) {
    const phases = manifest.phases.map((p, i) => ({ id: p.id, title: p.title, index: i }));
    const tasks = [];
    manifest.phases.forEach((p, pi) => {
      p.tasks.forEach((t, ti) => {
        tasks.push({
          id: t.id, title: t.title, ownerAgent: t.ownerAgent,
          phaseId: p.id, phaseIndex: pi,
          x: 640 + (ti / Math.max(1, p.tasks.length - 1) - 0.5) * 900,
          y: 700 - pi * 180,
          produces: t.produces, inputs: t.inputs ?? [], dependencies: t.dependencies,
        });
      });
    });
    return {
      width: 1280, height: 800, trunkX: 640,
      trunkTop: tasks.length ? Math.min(...tasks.map((t) => t.y)) - 60 : 100,
      trunkBottom: 700,
      phases, tasks, edges: [],
    };
  }

  // ── Tooltip / panel ──────────────────────────────────────────────────────
  const STATUS_LABEL = {
    pending: "pending", running: "running", complete: "complete", failed: "failed", skipped: "skipped",
  };

  function statusHtml(status) {
    return `<span class="status-label status-${status}">${STATUS_LABEL[status]}</span>`;
  }

  function showTooltip(task, actor) {
    const tt = $id("tooltip");
    tt.innerHTML =
      `<div class="tt-title">${esc(task.title)}</div>` +
      `<div class="tt-sub">${esc(task.id)}${task.ownerAgent ? " · " + esc(actor.name) + " (" + esc(task.ownerAgent) + ")" : ""}</div>` +
      `<div class="tt-status">${statusHtml(state.nodes.get(task.id).status)}</div>`;
    tt.classList.remove("hidden");
    tt.dataset.task = task.id;
  }

  function hideTooltip() {
    $id("tooltip").classList.add("hidden");
  }

  function showPanel(task, actor) {
    const node = state.nodes.get(task.id);
    const files = node.files || [];
    const panel = $id("panel");
    $id("panel-body").innerHTML =
      `<h3>${esc(actor.name)} — ${esc(task.title)}</h3>` +
      `<div class="kv"><span class="k">Task</span><span>${esc(task.id)}</span></div>` +
      `<div class="kv"><span class="k">Phase</span><span>${esc(task.phaseId)}</span></div>` +
      `<div class="kv"><span class="k">Agent</span><span>${task.ownerAgent ? esc(task.ownerAgent) : "unassigned"}</span></div>` +
      `<div class="kv"><span class="k">Status</span><span>${statusHtml(node.status)}</span></div>` +
      (node.durationMs ? `<div class="kv"><span class="k">Duration</span><span>${Math.round(node.durationMs / 1000)}s</span></div>` : "") +
      (node.errorMessage ? `<div class="kv"><span class="k">Error</span><span style="color:#ff8f8f">${esc(node.errorMessage)}</span></div>` : "") +
      (node.artifactId ? `<div class="kv"><span class="k">Artifact</span><span>${esc(node.artifactId)}</span></div>` : "") +
      (files.length ? `<div class="files">Files:<div>${files.map((f) => esc(f)).join("<div>")}</div></div>` : "");
    panel.classList.remove("hidden");
  }

  $id("panel-close").addEventListener("click", () => $id("panel").classList.add("hidden"));
  panArea.on("pointertap", () => $id("panel").classList.add("hidden"));

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ── Squirrel name helper (mirror of the engine's names.ts) ───────────────
  const ROLE_NAMES = {
    "project-orchestrator": "Acornius", "project-architect": "Twigby", architect: "Twigby",
    "api-engineer": "Tailor", "ui-engineer": "Pixie", "game-engineer": "Hopper",
    "qa-engineer": "Nutsy", "infrastructure-engineer": "Chip", "devops-engineer": "Scamp",
    "data-engineer": "Grommet", "backend-engineer": "Bramble", "frontend-engineer": "Sassafras",
    "full-stack-engineer": "Buster", "security-engineer": "Rusty", "content-designer": "Fern",
    "village-content-designer": "Fern", writer: "Quill", researcher: "Zigzag", reviewer: "Judge Nut",
  };
  const FALLBACK_NAMES = [
    "Acornius", "Twigby", "Tailor", "Pixie", "Hopper", "Nutsy", "Chip", "Scamp", "Grommet",
    "Bramble", "Buster", "Rusty", "Fern", "Quill", "Zigzag", "Skitter", "Whiskers", "Pebble",
    "Mossy", "Thistle", "Sable", "Hazel", "Rattle", "Dart", "Willow", "Gus", "Mabel", "Ollie",
    "Pip", "Squeak",
  ];
  function squirrelName(agent) {
    const normalized = String(agent ?? "").trim().toLowerCase();
    if (!normalized) return "Scout";
    if (ROLE_NAMES[normalized]) return ROLE_NAMES[normalized];
    return FALLBACK_NAMES[hashString(normalized) % FALLBACK_NAMES.length];
  }

  // ── Acorn handoffs ───────────────────────────────────────────────────────
  function launchAcornHandoff(taskId) {
    const from = state.nodes.get(taskId);
    if (!from) return;
    const targets = state.edges
      .filter((e) => e.kind === "artifact" && e.from === taskId)
      .map((e) => state.nodes.get(e.to))
      .filter(Boolean);
    for (const to of targets) {
      const path = edgePath(from.task, to.task, 70);
      const acorn = new P.Sprite(acornTexture());
      acorn.anchor.set(0.5, 1);
      acorn.position.set(from.task.x, from.task.y);
      acorn.scale.set(0.8);
      acornLayer.addChild(acorn);
      const traveller = { acorn, path, t: 0, speed: rand(1.1, 1.5) };
      animateTravellers.push(traveller);
    }
    // spark along dependency edges too
    const deps = state.edges.filter((e) => e.kind === "dependency" && e.from === taskId);
    for (const edge of deps) {
      const to = state.nodes.get(edge.to);
      if (!to) continue;
      const path = edgePath(from.task, to.task, 70);
      const dot = new P.Sprite(softGlowTexture(6, 0x55c8e6));
      dot.anchor.set(0.5);
      dot.position.set(from.task.x, from.task.y);
      acornLayer.addChild(dot);
      animateTravellers.push({ acorn: dot, path, t: 0, speed: rand(1.2, 1.6), spark: true });
    }
  }

  const animateTravellers = [];

  function updateTravellers(dt) {
    for (let i = animateTravellers.length - 1; i >= 0; i -= 1) {
      const t = animateTravellers[i];
      t.t += dt * t.speed;
      if (t.t >= 1) {
        acornLayer.removeChild(t.acorn);
        t.acorn.destroy();
        animateTravellers.splice(i, 1);
        continue;
      }
      const k = easeOutCubic(t.t);
      const pos = bezier(k, t.path.p0, t.path.p1, t.path.p2, t.path.p3);
      t.acorn.position.set(pos.x, pos.y);
      if (!t.spark) t.acorn.rotation = t.t * Math.PI * 4;
    }
  }

  // ── Event application ────────────────────────────────────────────────────
  function applySnapshot(snapshot) {
    if (!state.manifest && snapshot.manifest) buildScene(snapshot.manifest, snapshot.layout);
    if (snapshot.state) applyState(snapshot.state);
    const st = snapshot.state;
    setStatus(
      `connected · run ${st?.runId ?? "—"} · ${st?.status ?? "preparing…"}`,
      st ? "live" : "warn",
    );
  }

  function applyState(ws) {
    state.startedAt = ws.startedAt || state.startedAt;
    state.status = ws.status;
    if (ws.tasks) {
      for (const record of Object.values(ws.tasks)) {
        const node = state.nodes.get(record.taskId);
        if (node) {
          if (record.status === "complete") node.files = record.outputFiles || [];
          if (record.completedAt && record.status === "complete") {
            node.durationMs = record.startedAt ? Date.parse(record.completedAt) - Date.parse(record.startedAt) : undefined;
          }
          node.artifactId = record.artifactId;
          node.errorMessage = record.errorMessage;
          applyStatusToNode(node, record.status);
        }
      }
      computeCounts();
      updateHud();
      drawEdges();
    }
    setStatus(`connected · run ${ws.runId ?? "—"} · ${ws.status ?? state.status}`, ws.status === "failed" ? "warn" : "live");
    if (ws.status === "complete") showFinale();
    if (ws.status === "failed") showFailure();
    if (ws.status === "paused") showBanner("Paused", "Run is paused. Resume with `workflow-engine -- run`.", "paused");
  }

  function applyAuditEvent(event) {
    const action = event.action;
    const node = event.taskId ? state.nodes.get(event.taskId) : undefined;

    switch (action) {
      case "run.started":
        state.startedAt = event.timestamp || state.startedAt;
        break;
      case "phase.started":
        if (event.phaseId) sproutWhorl(event.phaseId);
        if (event.phaseId) moonlightSweep(event.phaseId);
        break;
      case "task.started":
        if (node) { node.actor.setPose("busy"); node.gauge = 0; }
        break;
      case "context.projected":
        if (node && typeof event.reductionPercent === "number") node.gauge = event.reductionPercent;
        break;
      case "artifact.created":
        if (event.taskId) launchAcornHandoff(event.taskId);
        break;
      case "task.complete":
        if (node) {
          applyStatusToNode(node, "complete");
          node.durationMs = event.durationMs;
          node.files = event.outputFiles || node.files || [];
          effectsLayer.spawn(node.task.x, node.task.y, "leaf", 8);
          computeCounts();
          updateHud();
          drawEdges();
        }
        break;
      case "task.failed":
        if (node) {
          applyStatusToNode(node, "failed");
          node.errorMessage = event.note || "task failed";
          effectsLayer.spawn(node.task.x, node.task.y, "leaf", 4);
          flashFailure();
          computeCounts();
          updateHud();
          drawEdges();
        }
        break;
      case "task.retrying":
        if (node) { node.actor.setPose("busy"); node.actor.root.rotation = 0; }
        break;
      case "task.skipped":
        if (node) { applyStatusToNode(node, "skipped"); computeCounts(); updateHud(); drawEdges(); }
        break;
      case "run.paused":
        showBanner("Paused", "Run is paused.", "paused");
        break;
      case "run.resumed":
        hideBanner();
        break;
      case "run.complete":
        applyState({ status: "complete", tasks: {} });
        break;
      case "run.failed":
        showFailure();
        break;
      default:
        break;
    }
  }

  function moonlightSweep(phaseId) {
    const entry = state.phases.get(phaseId);
    if (!entry) return;
    const band = new P.Graphics();
    band.eventMode = "none";
    const y = entry.phase.y;
    const fromX = state.layout.trunkX - 320;
    const toX = state.layout.trunkX + 320;
    band.moveTo(fromX, y - 60).lineTo(toX, y - 60).lineTo(toX, y + 60).lineTo(fromX, y + 60)
      .closePath().fill({ color: 0xdbe4ff, alpha: 0.22 });
    world.addChild(band);
    const start = performance.now();
    const sweep = { band, fromX, toX, y, start };
    animateSweeps.push(sweep);
  }

  const animateSweeps = [];

  function updateSweeps(dt) {
    const now = performance.now();
    for (let i = animateSweeps.length - 1; i >= 0; i -= 1) {
      const s = animateSweeps[i];
      const t = (now - s.start) / 1400;
      if (t >= 1) {
        world.removeChild(s.band);
        s.band.destroy();
        animateSweeps.splice(i, 1);
        continue;
      }
      const k = easeOutCubic(t);
      const alpha = Math.sin(Math.PI * k) * 0.22;
      s.band.clear();
      const x = lerp(s.fromX, s.toX, k);
      const w = 200;
      s.band.moveTo(x - w, s.y - 60).lineTo(x + w, s.y - 60).lineTo(x + w, s.y + 60).lineTo(x - w, s.y + 60)
        .closePath().fill({ color: 0xdbe4ff, alpha });
    }
  }

  function flashFailure() {
    const tint = $id("failed-tint");
    tint.classList.remove("hidden");
    void tint.offsetWidth; // restart the CSS animation
    tint.style.animation = "none";
    void tint.offsetWidth;
    tint.style.animation = "";
  }

  function showFailure() {
    document.body.classList.add("failed");
    showBanner("The Forge Stumbled", "Some tasks failed. Check the audit log and `replay` the failed tasks.", "failed");
  }

  function showFinale() {
    if (state.finaleShown) return;
    state.finaleShown = true;
    // gather squirrels at the top whorl center
    const layout = state.layout;
    const top = layout.phases[layout.phases.length - 1];
    const targetX = layout.trunkX;
    const targetY = top ? top.y + 20 : 100;
    for (const node of state.nodes.values()) {
      node.actor.state.gather = { x: targetX, y: targetY };
      node.actor.setPose("gather");
    }
    // golden acorn hoisted above the gathering
    const golden = new P.Sprite(acornTexture());
    golden.tint = 0xf5c542;
    golden.anchor.set(0.5, 1);
    golden.position.set(targetX, targetY - 70);
    golden.scale.set(0);
    golden.alpha = 0;
    acornLayer.addChild(golden);
    animateGolden = { sprite: golden, t: 0 };
    showBanner("The Forge is Complete", "All tasks forged. The canopy is in full bloom.", "done");
  }

  let animateGolden = null;

  function showBanner(title, sub, kind) {
    const b = $id("banner");
    b.innerHTML = `${esc(title)}<div class="sub">${esc(sub)}</div>`;
    b.className = kind;
    b.classList.remove("hidden");
  }

  function hideBanner() {
    $id("banner").classList.add("hidden");
  }

  // ── Squirrel animation ───────────────────────────────────────────────────
  function updateSquirrels(dt, now) {
    for (const node of state.nodes.values()) {
      const actor = node.actor;
      const st = actor.state;
      const t = st.t += dt;
      const body = actor.root.children[0];
      const tail = actor.root.children[1];
      const eye = actor.root.children[2];

      // gather (finale)
      if (st.gather) {
        const k = 1 - Math.exp(-dt * 2.2);
        actor.root.position.x = lerp(actor.root.position.x, st.gather.x, k);
        actor.root.position.y = lerp(actor.root.position.y, st.gather.y, k);
        actor.root.rotation = Math.sin(t * 3) * 0.06;
        body.y = Math.sin(t * 6) * 3;
        tail.rotation = Math.sin(t * 5) * 0.15 + 0.3;
        continue;
      }

      switch (st.pose) {
        case "busy": {
          const bob = Math.sin(t * 14) * 3;
          actor.root.position.y = node.task.y + bob;
          actor.root.position.x = node.task.x + Math.sin(t * 11) * 1.5;
          body.y = bob * 0.5;
          body.rotation = Math.sin(t * 12) * 0.04;
          tail.rotation = Math.sin(t * 16) * 0.5 + 0.4;
          eye.scale.set(1 + Math.sin(t * 9) * 0.05);
          break;
        }
        case "complete": {
          const bounce = Math.abs(Math.sin(t * 5));
          actor.root.position.y = node.task.y - bounce * 12;
          body.y = -bounce * 4;
          tail.rotation = Math.sin(t * 4) * 0.2 + 0.4;
          body.rotation = Math.sin(t * 6) * 0.03;
          break;
        }
        case "failed": {
          actor.root.position.y = node.task.y + 6;
          actor.root.rotation = 0.14;
          tail.rotation = -0.2 + Math.sin(t * 2) * 0.05;
          eye.alpha = 0.4 + Math.sin(t * 3) * 0.2;
          break;
        }
        case "skip": {
          actor.root.position.y = node.task.y + 8;
          actor.root.alpha = 0.45;
          tail.rotation = Math.sin(t * 2) * 0.1 + 0.1;
          break;
        }
        default: {
          actor.root.position.y = node.task.y + Math.sin(t * 2) * 2;
          actor.root.rotation = 0;
          body.rotation = 0;
          tail.rotation = Math.sin(t * 2.5) * 0.18 + 0.25;
          actor.root.alpha = 1;
          eye.alpha = 1;
          break;
        }
      }
    }
  }

  // ── Ticker ───────────────────────────────────────────────────────────────
  let elapsedStart = null;

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const now = performance.now();

    // background motion
    for (let i = 0; i < fireflyState.length; i += 1) {
      const f = fireflyState[i];
      f.phase += dt * f.speed * 0.03;
      f.p.x = f.base + Math.sin(f.phase) * f.amp;
      f.p.y += Math.sin(f.phase * 1.7) * dt * 8;
      if (f.p.y > 1240) f.p.y = -20;
      const flicker = 0.4 + 0.6 * Math.abs(Math.sin(f.phase * 0.7 + i));
      f.p.alpha = flicker;
    }
    fireflies.update();
    for (let i = 0; i < fallState.length; i += 1) {
      const f = fallState[i];
      f.p.y += f.drift * dt;
      f.p.x += Math.sin(now / 900 + i * 7) * 0.4;
      f.p.rotation += f.rot * dt;
      if (f.p.y > 1240) { f.p.y = -20; f.p.x = rand(0, 1600); }
    }
    fallingLeaves.update();
    moon.x += dt * 2;
    if (moon.x > screenW() + 200) moon.x = -100;

    // tree growth
    const growthStep = Math.max(1, (state.layout?.trunkBottom - state.layout?.trunkTop ?? 1) * 0.4) * dt;
    if (trunkGrowth.current < trunkGrowth.target) {
      trunkGrowth.current = Math.min(trunkGrowth.current + growthStep, trunkGrowth.target);
      drawTree();
    }
    for (const entry of state.phases.values()) {
      if (entry.sprouted && entry.sproutT < 1) {
        entry.sproutT = Math.min(1, entry.sproutT + dt * 0.9);
        drawWhorlBranch(entry);
      }
    }

    updateSweeps(dt);
    updateTravellers(dt);
    effectsLayer.update(dt);
    updateSquirrels(dt, now);

    if (animateGolden) {
      animateGolden.t += dt;
      const t = animateGolden.t;
      const k = Math.min(1, t / 1.4);
      animateGolden.sprite.scale.set(easeOutCubic(k) * 1.1);
      animateGolden.sprite.alpha = clamp(k * 1.5, 0, 1);
      animateGolden.sprite.y -= dt * 6;
      if (t > 1.6 && !animateGolden.burst) {
        animateGolden.burst = true;
        effectsLayer.spawn(animateGolden.sprite.x, animateGolden.sprite.y, "gold", 18);
      }
    }

    // elapsed clock
    if (state.startedAt) {
      const base = elapsedStart || (elapsedStart = Date.parse(state.startedAt));
      const s = Math.floor((Date.now() - base) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      $id("elapsed").textContent = `${mm}:${ss}`;
    }
  });

  // ── Data wiring ──────────────────────────────────────────────────────────
  let manifestData = null;
  let stateData = null;

  async function fetchSnapshot() {
    try {
      const [m, s, l] = await Promise.all([
        fetch("/api/manifest").then((r) => r.json()),
        fetch("/api/state").then((r) => r.json()),
        fetch("/api/layout").then((r) => r.json()),
      ]);
      manifestData = m;
      stateData = s;
      applySnapshot({ manifest: m, state: s, layout: l });
    } catch {
      // Server may not be ready yet; the EventSource snapshot will re-sync.
      setStatus("waiting for the engine server…", "warn");
    }
  }

  const es = new EventSource("/api/events");
  es.onmessage = () => {};
  es.onopen = () => setStatus("connected · waiting for engine events…", "live");
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      setStatus("disconnected · run finished or server stopped", "dead");
    } else {
      setStatus("connection lost · retrying…", "warn");
    }
  };
  es.addEventListener("snapshot", (e) => {
    try {
      applySnapshot(JSON.parse(e.data));
    } catch (err) {
      setStatus(`render error: ${err.message}`, "warn");
    }
  });
  es.addEventListener("audit", (e) => {
    try {
      applyAuditEvent(JSON.parse(e.data));
    } catch (err) {
      setStatus(`render error: ${err.message}`, "warn");
    }
  });
  es.addEventListener("done", () => {
    es.close();
    document.body.classList.add("ended");
    setStatus("run finished · dashboard closing", "dead");
  });

  fetchSnapshot();

  // Keep the dashboard ticking even if the SSE connection drops (attach mode).
  window.setInterval(async () => {
    if (es.readyState !== EventSource.CLOSED) return;
    try {
      const s = await fetch("/api/state").then((r) => r.json());
      if (s) applyState(s);
    } catch { /* server gone */ }
  }, 2000);
})();
