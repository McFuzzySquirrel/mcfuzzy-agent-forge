/* global Pixi */
"use strict";

// ─── The Forge Board — live workflow kanban ───────────────────────────────────
// Live PixiJS dashboard for the forge-workflow-engine. Connects to the viz
// server over SSE (/api/events) with an initial snapshot (/api/manifest +
// /api/state + /api/layout) and renders the build as a kanban board: one band
// per phase, tasks as cards flowing left-to-right through To Do / In Progress /
// Done / Failed, colored by their owning agent, with dependency and artifact
// edges between cards.

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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function lerp(a, b, t) { return a + (b - a) * t; }

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function $id(id) { return document.getElementById(id); }

/** Updates the HUD status line so connection state is always visible. */
function setStatus(text, kind) {
  const meta = $id("meta");
  if (!meta) return;
  meta.textContent = text;
  meta.className = kind || "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// The renderer is set once the Pixi app initializes; texture factories below
// use it to bake procedural Graphics into reusable textures.
let RENDERER = null;

function toTexture(target) {
  return RENDERER.generateTexture({ target });
}

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

// ─── Kanban constants ─────────────────────────────────────────────────────────

const STATUS_COLORS = {
  pending: 0x8b96b8,
  running: 0x6fd0ff,
  complete: 0x5ed36a,
  failed: 0xff6b6b,
  skipped: 0x7f88a8,
};

const STATUS_LABEL = {
  pending: "pending", running: "running", complete: "complete", failed: "failed", skipped: "skipped",
};

const EDGE_COLORS = { dependency: 0x7f9bd8, artifact: 0xf5c542 };

// Board geometry (mirrors layout.ts DEFAULTS so a stale server layout can be
// re-derived from the manifest alone).
const GEOM = {
  labelWidth: 170,
  padX: 18,
  padY: 12,
  bandGap: 20,
  topMargin: 84,
  headerSpace: 40,
  cardH: 62,
  cardGap: 16,
  bottomPad: 8,
};

/** Deterministic hue per agent. */
function agentHue(agent) {
  return agent ? hashString(agent) % 360 : 210;
}

/** Deterministic color per agent (name-tag ring + border). */
function agentColor(agent) {
  return hslToHex(agentHue(agent), 55, 62);
}

/** Readable name-tag label for an agent id ("qa-engineer" → "Qa Engineer"). */
function agentLabel(agent) {
  const s = String(agent ?? "").trim();
  if (!s) return "unassigned";
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Draws a stylized agent face into a Graphics (centered on 0,0): a colored
 * avatar ring, a skin-toned head with a hair cap, eyes, and a mouth that
 * reacts to the task's status.
 */
function drawFace(g, hue, status) {
  g.clear();
  const ring = hslToHex(hue, 55, 58);
  const skin = hslToHex(hue, 45, 78);
  const hair = hslToHex(hue, 55, 34);
  const dark = 0x221a17;

  g.circle(0, 0, 18).fill({ color: 0x0c1120, alpha: 0.9 }).stroke({ width: 2.5, color: ring });
  g.circle(0, 0, 13).fill({ color: skin });
  // Hair cap (top half).
  g.arc(0, 0, 12.5, Math.PI, 0).lineTo(-12.5, 0).lineTo(0, 0).closePath().fill({ color: hair });
  // Eyes.
  g.circle(-5, 4.5, 1.7).fill({ color: dark });
  g.circle(5, 4.5, 1.7).fill({ color: dark });

  // Mouth reacts to status.
  if (status === "complete") {
    g.arc(0, 9, 4, Math.PI, 0).stroke({ width: 1.6, color: dark, cap: "round" });
  } else if (status === "failed") {
    g.arc(0, 9, 4, 0, Math.PI).stroke({ width: 1.6, color: dark, cap: "round" });
  } else if (status === "running") {
    g.circle(0, 10, 2).fill({ color: dark });
  } else {
    g.moveTo(-3, 9).lineTo(3, 9).stroke({ width: 1.6, color: dark, cap: "round" });
  }
}

function truncate(text, maxChars) {
  const t = String(text ?? "");
  return t.length > maxChars ? `${t.slice(0, Math.max(1, maxChars - 1))}…` : t;
}

// ─── The dashboard app ────────────────────────────────────────────────────────

(async function main() {
  const app = new P.Application();
  await app.init({
    resizeTo: window,
    background: 0x0c1120,
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
  const background = new P.Graphics();
  const boardGfx = new P.Graphics();
  const labelLayer = new P.Container();
  const edgeGfx = new P.Graphics();
  const edgeLayer = new P.Container();
  const cardLayer = new P.Container();
  const effectLayer = new P.Container();

  const world = new P.Container();
  world.addChild(boardGfx, labelLayer, edgeLayer, cardLayer, effectLayer);

  // Only cards, the board, and the background are interactive; decorative
  // layers (labels/edges/effects) never block pointer events.
  labelLayer.eventMode = "none";
  edgeLayer.eventMode = "none";
  effectLayer.eventMode = "none";

  background.eventMode = "static";
  background.cursor = "grab";
  boardGfx.eventMode = "static";
  boardGfx.cursor = "grab";

  app.stage.eventMode = "static";
  app.stage.addChild(background, world);

  // ── Camera pan / zoom ────────────────────────────────────────────────────
  let dragging = false;
  let dragStart = new P.Point();
  let worldStart = new P.Point();
  let scale = 1;

  function resize() {
    background.clear();
    const w = screenW();
    const h = screenH();
    const grad = new P.FillGradient({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x0c1120 },
        { offset: 1, color: 0x141a2e },
      ],
    });
    background.rect(0, 0, w, h).fill(grad);
  }

  function startPan(e) {
    dragging = true;
    background.cursor = "grabbing";
    boardGfx.cursor = "grabbing";
    dragStart.set(e.global.x, e.global.y);
    worldStart.set(world.x, world.y);
  }
  background.on("pointerdown", startPan);
  boardGfx.on("pointerdown", startPan);
  app.stage.on("pointerup", () => { dragging = false; background.cursor = "grab"; boardGfx.cursor = "grab"; });
  app.stage.on("pointerupoutside", () => { dragging = false; background.cursor = "grab"; boardGfx.cursor = "grab"; });
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

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    manifest: null,
    layout: null,
    cards: new Map(),    // taskId -> card entry
    ordered: [],         // cards in manifest order (for stable stacking)
    edges: [],
    columns: new Map(),  // columnKey -> { x, width, label }
    phases: new Map(),   // phaseId -> { id, title, index, y, height }
    cardW: 0,
    width: 1280,
    height: 800,
    hovered: null,
    currentPhase: null,
    startedAt: null,
    status: "idle",
    counts: { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 },
    total: 0,
  };

  // ── Geometry (columns + bands) from layout or manifest ───────────────────
  function kanbanFromManifest(manifest) {
    const w = 1280;
    const avail = w - GEOM.labelWidth - GEOM.padX * 2;
    const colW = avail / 4;
    const keys = ["pending", "running", "complete", "failed"];
    const labels = { pending: "To Do", running: "In Progress", complete: "Done", failed: "Failed" };
    const columns = keys.map((key, i) => ({
      key, label: labels[key],
      x: GEOM.labelWidth + GEOM.padX + i * colW,
      width: colW,
    }));
    let bandY = GEOM.topMargin;
    const phases = manifest.phases.map((p) => {
      const h = GEOM.headerSpace + p.tasks.length * (GEOM.cardH + GEOM.cardGap) + GEOM.bottomPad;
      const ph = { id: p.id, title: p.title, index: 0, y: bandY, height: h };
      bandY += h + GEOM.bandGap;
      return ph;
    });
    phases.forEach((p, i) => { p.index = i; });
    const tasks = [];
    manifest.phases.forEach((p, pi) => {
      p.tasks.forEach((t, ti) => {
        tasks.push({
          id: t.id, title: t.title, ownerAgent: t.ownerAgent,
          phaseId: p.id, phaseIndex: pi, indexInPhase: ti,
          produces: t.produces, inputs: t.inputs ?? [], dependencies: t.dependencies,
        });
      });
    });
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const edges = [];
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (tasksById.has(depId)) edges.push({ from: depId, to: task.id, kind: "dependency" });
      }
      for (const inputType of task.inputs) {
        const producer = tasks.find((t) => t.produces === inputType);
        if (producer && producer.id !== task.id) {
          edges.push({ from: producer.id, to: task.id, kind: "artifact" });
        }
      }
    }
    const height = (phases.length
      ? phases[phases.length - 1].y + phases[phases.length - 1].height
      : GEOM.topMargin) + 40;
    return { width: w, height, columns, phases, tasks, edges };
  }

  function resolveLayout(manifest, layout) {
    if (layout && Array.isArray(layout.columns) && layout.columns.length === 4) return layout;
    return kanbanFromManifest(manifest);
  }

  // ── Board drawing ─────────────────────────────────────────────────────────
  const headerTexts = [];
  const phaseNameTexts = new Map(); // phaseId -> P.Text (label fill updated on active)

  function buildLabels() {
    clearLabels();
    for (const col of state.columns.values()) {
      const t = new P.Text({
        text: col.label,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fontWeight: "800",
          fill: 0xe8ecf5,
          letterSpacing: 0.04,
        },
      });
      t.anchor.set(0.5, 0.5);
      t.position.set(col.x + col.width / 2, 26);
      labelLayer.addChild(t);
      headerTexts.push(t);
    }
    for (const phase of state.phases.values()) {
      const label = new P.Container();
      const name = new P.Text({
        text: truncate(phase.title || phase.id, 20),
        style: { fontFamily: "system-ui, sans-serif", fontSize: 13, fontWeight: "700", fill: 0xc7cde0 },
      });
      name.position.set(0, 0);
      const idx = new P.Text({
        text: `Phase ${phase.index + 1}`,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fill: 0x8b96b8 },
      });
      idx.position.set(0, 18);
      label.addChild(name, idx);
      label.position.set(12, phase.y + 14);
      labelLayer.addChild(label);
      phaseNameTexts.set(phase.id, name);
    }
  }

  function clearLabels() {
    for (const t of headerTexts) t.destroy();
    headerTexts.length = 0;
    for (const t of phaseNameTexts.values()) t.destroy();
    phaseNameTexts.clear();
    labelLayer.removeChildren().forEach((c) => c.destroy());
  }

  /** Redraws the board graphics (column separators + phase bands + labels). */
  function drawBoard() {
    boardGfx.clear();
    const bottom = state.height;

    // Faint vertical separators between columns.
    for (const col of state.columns.values()) {
      boardGfx.moveTo(col.x - 0.5, GEOM.topMargin - 26).lineTo(col.x - 0.5, bottom)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.05 });
    }

    // Phase bands.
    for (const phase of state.phases.values()) {
      const active = phase.id === state.currentPhase;
      const x0 = GEOM.labelWidth;
      const w = state.width - GEOM.labelWidth;
      boardGfx.roundRect(x0, phase.y, w, phase.height, 10)
        .fill({ color: active ? 0x5ed36a : 0xffffff, alpha: active ? 0.05 : 0.025 })
        .stroke({ width: 1, color: active ? 0x5ed36a : 0xffffff, alpha: active ? 0.35 : 0.06 });

      const nameText = phaseNameTexts.get(phase.id);
      if (nameText) nameText.style.fill = active ? 0x9be3a6 : 0xc7cde0;
    }
  }

  // ── Cards (name tags) ─────────────────────────────────────────────────────
  function createCard(task) {
    const cardW = state.cardW;
    const bg = new P.Graphics();
    const ribbon = new P.Graphics();
    const avatar = new P.Graphics();
    avatar.position.set(30, GEOM.cardH / 2);
    const nameText = new P.Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "700", fill: 0xeef1f9 },
    });
    nameText.position.set(52, 6);
    const title = new P.Text({
      text: "",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 9.5, fontWeight: "500", fill: 0xb6c0dc },
    });
    title.position.set(52, 21);
    const idText = new P.Text({
      text: "",
      style: { fontFamily: "ui-monospace, monospace", fontSize: 8.5, fill: 0x7f88a8 },
    });
    idText.position.set(52, 35);
    const dot = new P.Sprite(circleTexture(5, 0xffffff));
    dot.anchor.set(0.5);
    const badgeLayer = new P.Container();

    const root = new P.Container();
    root.eventMode = "static";
    root.cursor = "pointer";
    root.hitArea = new P.Rectangle(0, 0, cardW, GEOM.cardH);
    root.addChild(bg, ribbon, avatar, nameText, title, idText, dot, badgeLayer);

    const entry = {
      root, bg, ribbon, avatar, nameText, title, idText, dot, badgeLayer,
      task, status: "pending", artifactId: null, ctxPct: null,
      targetX: 0, targetY: 0,
    };

    root.on("pointertap", (e) => {
      e.stopPropagation();
      showPanel(entry);
    });
    root.on("pointerover", () => { setHover(task.id); showTooltip(entry); });
    root.on("pointerout", () => { setHover(null); hideTooltip(); });

    return entry;
  }

  /** Fits the card title to the available width, trimming with an ellipsis. */
  function fitTitle(entry, maxW) {
    const t = entry.title;
    const full = entry.task.title;
    // Conservative first pass from a char-width estimate (measured width can lag
    // on the very first paint), then refine by the actual rendered width.
    const perChar = 6.4;
    const budget = Math.floor((maxW - 10) / perChar);
    t.text = full.length > budget ? `${full.slice(0, Math.max(1, budget - 1))}…` : full;
    if (t.width <= maxW) return;
    let text = t.text.endsWith("…") ? t.text.slice(0, -1) : t.text;
    let guard = 0;
    while (text.length > 1 && t.width > maxW && guard < 200) {
      text = text.slice(0, -1);
      t.text = `${text}…`;
      guard += 1;
    }
  }

  function paintCard(entry) {
    const color = STATUS_COLORS[entry.status];
    const cardW = state.cardW;
    const hue = agentHue(entry.task.ownerAgent);
    const running = entry.status === "running";

    entry.bg.clear();
    entry.bg.roundRect(0, 0, cardW, GEOM.cardH, 8)
      .fill({ color, alpha: running ? 0.14 : 0.08 })
      .stroke({ width: 1.5, color: agentColor(entry.task.ownerAgent), alpha: 0.85 });
    // Name-tag header ribbon (status color).
    entry.ribbon.clear();
    entry.ribbon.roundRect(0, 0, cardW, 3, 2)
      .fill({ color, alpha: running ? 0.95 : 0.7 });

    drawFace(entry.avatar, hue, entry.status);

    const nameMax = cardW - 52 - 66;
    entry.nameText.text = truncate(agentLabel(entry.task.ownerAgent), Math.max(8, Math.floor(nameMax / 6.5)));
    fitTitle(entry, cardW - 58);
    entry.idText.text = entry.task.id;
    entry.dot.tint = color;
    entry.dot.position.set(cardW - 12, 12);
    entry.root.alpha = entry.status === "skipped" ? 0.55 : 1;

    // Badges (context projection, artifact).
    entry.badgeLayer.removeChildren().forEach((c) => c.destroy());
    let bx = cardW - 12;
    if (entry.ctxPct !== null) {
      const t = new P.Text({
        text: `ctx −${entry.ctxPct}%`,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 9, fill: 0xa9d1f7 },
      });
      t.anchor.set(1, 0);
      t.position.set(bx, 26);
      entry.badgeLayer.addChild(t);
      bx -= t.width + 6;
    }
    if (entry.artifactId) {
      const t = new P.Text({
        text: `⛁ ${entry.artifactId}`,
        style: { fontFamily: "system-ui, sans-serif", fontSize: 9, fill: 0xf5c542 },
      });
      t.anchor.set(1, 0);
      t.position.set(bx, 26);
      entry.badgeLayer.addChild(t);
    }
  }

  function columnKeyFor(status) {
    return status === "skipped" ? "complete" : status;
  }

  /** Recompute each card's target position from (phase, status column, stack). */
  function layoutCards() {
    const stack = new Map();
    for (const entry of state.ordered) {
      const colKey = columnKeyFor(entry.status);
      const key = `${entry.task.phaseId}:${colKey}`;
      const idx = stack.get(key) ?? 0;
      stack.set(key, idx + 1);
      const col = state.columns.get(colKey);
      const phase = state.phases.get(entry.task.phaseId);
      if (!col || !phase) continue;
      entry.targetX = col.x + GEOM.padX;
      entry.targetY = phase.y + GEOM.headerSpace + idx * (GEOM.cardH + GEOM.cardGap);
    }
  }

  // ── Edges ────────────────────────────────────────────────────────────────
  function cardAnchor(entry, side) {
    return {
      x: entry.root.x + (side === "right" ? state.cardW : 0),
      y: entry.root.y + GEOM.cardH / 2,
    };
  }

  function drawEdges() {
    edgeGfx.clear();
    for (const edge of state.edges) {
      const from = state.cards.get(edge.from);
      const to = state.cards.get(edge.to);
      if (!from || !to) continue;
      const a = cardAnchor(from, "right");
      const b = cardAnchor(to, "left");
      const touched = state.hovered === edge.from || state.hovered === edge.to;
      const alpha = touched ? 0.75 : 0.16;
      const width = touched ? 2.4 : 1.2;
      const dx = Math.max(46, Math.abs(b.x - a.x) * 0.5);
      const c1 = { x: a.x + dx, y: a.y };
      const c2 = { x: b.x - dx, y: b.y };
      const color = EDGE_COLORS[edge.kind];
      edgeGfx.moveTo(a.x, a.y).bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y)
        .stroke({ width, cap: "round", color, alpha });
      // arrowhead at the target
      const ang = Math.atan2(b.y - c2.y, b.x - c2.x);
      const s = 6;
      edgeGfx.moveTo(b.x, b.y)
        .lineTo(b.x - Math.cos(ang - 0.5) * s, b.y - Math.sin(ang - 0.5) * s)
        .lineTo(b.x - Math.cos(ang + 0.5) * s, b.y - Math.sin(ang + 0.5) * s)
        .closePath().fill({ color, alpha: touched ? 0.9 : 0.35 });
    }
  }

  function setHover(taskId) {
    state.hovered = taskId;
    drawEdges();
  }

  // ── Artifact handoff dots ─────────────────────────────────────────────────
  const animateTravellers = [];

  function launchArtifactHandoff(taskId) {
    const from = state.cards.get(taskId);
    if (!from) return;
    for (const edge of state.edges) {
      if (edge.kind !== "artifact" || edge.from !== taskId) continue;
      const to = state.cards.get(edge.to);
      if (!to) continue;
      const dot = new P.Sprite(softGlowTexture(6, 0xf5c542));
      dot.anchor.set(0.5);
      dot.eventMode = "none";
      dot.position.set(from.root.x + state.cardW, from.root.y + GEOM.cardH / 2);
      effectLayer.addChild(dot);
      animateTravellers.push({
        sprite: dot,
        a: cardAnchor(from, "right"),
        b: cardAnchor(to, "left"),
        t: 0, speed: 1.4,
      });
    }
  }

  function updateTravellers(dt) {
    for (let i = animateTravellers.length - 1; i >= 0; i -= 1) {
      const t = animateTravellers[i];
      t.t += dt * t.speed;
      if (t.t >= 1) {
        effectLayer.removeChild(t.sprite);
        t.sprite.destroy();
        animateTravellers.splice(i, 1);
        continue;
      }
      const k = easeOutCubic(t.t);
      t.sprite.position.set(lerp(t.a.x, t.b.x, k), lerp(t.a.y, t.b.y, k));
    }
  }

  // ── Scene build ──────────────────────────────────────────────────────────
  function buildScene(manifest, layout) {
    const resolved = resolveLayout(manifest, layout);
    state.manifest = manifest;
    state.layout = resolved;
    state.width = resolved.width;
    state.height = resolved.height;

    // Idempotent rebuild on reconnect/restart.
    for (const entry of state.cards.values()) {
      cardLayer.removeChild(entry.root);
      entry.root.destroy();
    }
    state.cards.clear();
    state.ordered = [];
    state.edges.length = 0;
    state.columns.clear();
    state.phases.clear();
    clearLabels();

    const colKeys = ["pending", "running", "complete", "failed"];
    const colLabels = { pending: "To Do", running: "In Progress", complete: "Done", failed: "Failed" };
    for (const col of resolved.columns) {
      state.columns.set(col.key, { x: col.x, width: col.width, label: col.label || colLabels[col.key] || col.key });
    }
    for (const phase of resolved.phases) {
      state.phases.set(phase.id, { id: phase.id, title: phase.title, index: phase.index, y: phase.y, height: phase.height });
    }

    state.cardW = Math.max(120, (state.columns.get("pending")?.width ?? 260) - GEOM.padX * 2);

    for (const task of resolved.tasks) {
      const entry = createCard(task);
      state.cards.set(task.id, entry);
      state.ordered.push(entry);
      cardLayer.addChild(entry.root);
    }
    for (const edge of resolved.edges) state.edges.push(edge);

    state.total = state.ordered.length;
    buildLabels();
    drawBoard();
    layoutCards();
    for (const entry of state.ordered) {
      entry.root.position.set(entry.targetX, entry.targetY);
      paintCard(entry);
    }
    drawEdges();
    fitCamera();
  }

  function fitCamera() {
    if (state.height <= 0) return;
    const pad = 70;
    const bw = state.width + pad * 2;
    const bh = state.height + pad * 2;
    scale = clamp(Math.min(screenW() / bw, screenH() / bh), 0.25, 1.2);
    world.scale.set(scale);
    world.position.set(
      screenW() / 2 - (state.width / 2) * scale,
      screenH() / 2 - (state.height / 2) * scale,
    );
  }

  // ── Status application ────────────────────────────────────────────────────
  function applyStatusToCard(entry, status) {
    entry.status = status;
    if (status === "complete") entry.files = entry.files || [];
    paintCard(entry);
    layoutCards();
    computeCounts();
    updateHud();
    drawEdges();
  }

  function computeCounts() {
    const counts = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 };
    for (const entry of state.ordered) counts[entry.status] += 1;
    state.counts = counts;
  }

  function updateHud() {
    const { counts, total } = state;
    const done = counts.complete + counts.skipped;
    $id("done-count").textContent = `${done} / ${total}`;
    $id("progress-fill").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
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
    for (const entry of state.ordered) {
      if (!entry.task.ownerAgent) continue;
      if (!byAgent.has(entry.task.ownerAgent)) {
        byAgent.set(entry.task.ownerAgent, agentColor(entry.task.ownerAgent));
      }
    }
    const chips = [];
    for (const [agent, color] of byAgent) {
      chips.push(
        `<span class="chip"><span class="dot" style="background:#${color.toString(16).padStart(6, "0")}"></span>${esc(agent)}</span>`,
      );
    }
    legend.innerHTML = chips.join("");
  }

  // ── Tooltip / panel ───────────────────────────────────────────────────────
  function statusHtml(status) {
    return `<span class="status-label status-${status}">${STATUS_LABEL[status]}</span>`;
  }

  function showTooltip(entry) {
    const tt = $id("tooltip");
    const task = entry.task;
    tt.innerHTML =
      `<div class="tt-title">${esc(task.title)}</div>` +
      `<div class="tt-sub">${esc(task.id)}${task.ownerAgent ? " · " + esc(task.ownerAgent) : ""}</div>` +
      `<div class="tt-status">${statusHtml(entry.status)}</div>` +
      (entry.artifactId ? `<div class="tt-sub">artifact: ${esc(entry.artifactId)}</div>` : "");
    tt.classList.remove("hidden");
    tt.dataset.task = task.id;
  }

  function hideTooltip() {
    $id("tooltip").classList.add("hidden");
  }

  function showPanel(entry) {
    const task = entry.task;
    const files = entry.files || [];
    const panel = $id("panel");
    $id("panel-body").innerHTML =
      `<h3>${esc(task.ownerAgent || "unassigned")} — ${esc(task.title)}</h3>` +
      `<div class="kv"><span class="k">Task</span><span>${esc(task.id)}</span></div>` +
      `<div class="kv"><span class="k">Phase</span><span>${esc(task.phaseId)}</span></div>` +
      `<div class="kv"><span class="k">Agent</span><span>${task.ownerAgent ? esc(task.ownerAgent) : "unassigned"}</span></div>` +
      `<div class="kv"><span class="k">Status</span><span>${statusHtml(entry.status)}</span></div>` +
      (entry.durationMs ? `<div class="kv"><span class="k">Duration</span><span>${Math.round(entry.durationMs / 1000)}s</span></div>` : "") +
      (entry.errorMessage ? `<div class="kv"><span class="k">Error</span><span style="color:#ff8f8f">${esc(entry.errorMessage)}</span></div>` : "") +
      (entry.artifactId ? `<div class="kv"><span class="k">Artifact</span><span>${esc(entry.artifactId)}</span></div>` : "") +
      (task.inputs?.length ? `<div class="kv"><span class="k">Inputs</span><span>${task.inputs.map(esc).join(", ")}</span></div>` : "") +
      (files.length ? `<div class="files">Files:<div>${files.map((f) => esc(f)).join("<div>")}</div></div>` : "");
    panel.classList.remove("hidden");
  }

  $id("panel-close").addEventListener("click", () => $id("panel").classList.add("hidden"));
  background.on("pointertap", () => $id("panel").classList.add("hidden"));
  boardGfx.on("pointertap", () => $id("panel").classList.add("hidden"));

  // ── Overlays / banners ────────────────────────────────────────────────────
  function showBanner(title, sub, kind) {
    const b = $id("banner");
    b.innerHTML = `${esc(title)}<div class="sub">${esc(sub)}</div>`;
    b.className = kind;
    b.classList.remove("hidden");
  }

  function hideBanner() {
    $id("banner").classList.add("hidden");
  }

  function flashFailure() {
    const tint = $id("failed-tint");
    tint.classList.remove("hidden");
    void tint.offsetWidth;
    tint.style.animation = "none";
    void tint.offsetWidth;
    tint.style.animation = "";
  }

  function showFailure() {
    document.body.classList.add("failed");
    showBanner("Run Failed", "Some tasks failed. Check the audit log and `replay` the failed tasks.", "failed");
  }

  function showComplete() {
    showBanner("Run Complete", "All tasks finished.", "done");
  }

  // ── Event application ─────────────────────────────────────────────────────
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
    if (ws.currentPhase && state.phases.has(ws.currentPhase)) {
      state.currentPhase = ws.currentPhase;
      drawBoard();
    }
    if (ws.tasks) {
      for (const record of Object.values(ws.tasks)) {
        const entry = state.cards.get(record.taskId);
        if (!entry) continue;
        if (record.status === "complete") entry.files = record.outputFiles || [];
        if (record.completedAt && record.status === "complete") {
          entry.durationMs = record.startedAt
            ? Date.parse(record.completedAt) - Date.parse(record.startedAt)
            : undefined;
        }
        if (record.artifactId) entry.artifactId = record.artifactId;
        entry.errorMessage = record.errorMessage;
        if (entry.status !== record.status) applyStatusToCard(entry, record.status);
      }
    }
    setStatus(`connected · run ${ws.runId ?? "—"} · ${ws.status ?? state.status}`, ws.status === "failed" ? "warn" : "live");
    if (ws.status === "complete") showComplete();
    if (ws.status === "failed") showFailure();
    if (ws.status === "paused") showBanner("Paused", "Run is paused. Resume with `workflow-engine -- run`.", "paused");
  }

  function applyAuditEvent(event) {
    const action = event.action;
    const entry = event.taskId ? state.cards.get(event.taskId) : undefined;

    switch (action) {
      case "run.started":
        state.startedAt = event.timestamp || state.startedAt;
        break;
      case "phase.started":
        if (event.phaseId && state.phases.has(event.phaseId)) {
          state.currentPhase = event.phaseId;
          drawBoard();
        }
        break;
      case "task.started":
        if (entry && entry.status !== "running") applyStatusToCard(entry, "running");
        break;
      case "context.projected":
        if (entry && typeof event.reductionPercent === "number") {
          entry.ctxPct = event.reductionPercent;
          paintCard(entry);
        }
        break;
      case "artifact.created":
        if (event.taskId) {
          if (entry) { entry.artifactId = event.artifactId || entry.artifactId; paintCard(entry); }
          launchArtifactHandoff(event.taskId);
        }
        break;
      case "task.complete":
        if (entry) {
          entry.durationMs = event.durationMs;
          entry.files = event.outputFiles || entry.files || [];
          applyStatusToCard(entry, "complete");
        }
        break;
      case "task.failed":
        if (entry) {
          entry.errorMessage = event.note || "task failed";
          applyStatusToCard(entry, "failed");
          flashFailure();
        }
        break;
      case "task.retrying":
        if (entry && entry.status === "running") { entry.root.alpha = 0.6; }
        break;
      case "task.skipped":
        if (entry) applyStatusToCard(entry, "skipped");
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

  // ── Ticker ────────────────────────────────────────────────────────────────
  let elapsedStart = null;

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const now = performance.now();

    // Cards glide to their column/stack position.
    let moving = false;
    for (const entry of state.ordered) {
      const k = 1 - Math.exp(-dt * 8);
      const nx = lerp(entry.root.x, entry.targetX, k);
      const ny = lerp(entry.root.y, entry.targetY, k);
      if (Math.abs(nx - entry.targetX) > 0.5 || Math.abs(ny - entry.targetY) > 0.5) moving = true;
      entry.root.position.set(nx, ny);
      if (entry.status === "running") {
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(now / 300));
        entry.ribbon.alpha = pulse;
      } else {
        entry.ribbon.alpha = 1;
      }
    }

    updateTravellers(dt);
    if (moving) drawEdges();

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
  async function fetchSnapshot() {
    try {
      const [m, s, l] = await Promise.all([
        fetch("/api/manifest").then((r) => r.json()),
        fetch("/api/state").then((r) => r.json()),
        fetch("/api/layout").then((r) => r.json()),
      ]);
      applySnapshot({ manifest: m, state: s, layout: l });
    } catch {
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
