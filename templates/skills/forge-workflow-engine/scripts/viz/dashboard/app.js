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

/**
 * Asks the Console to navigate. The board is an iframe, so a link to another
 * view has to be handed to the parent rather than followed in place — otherwise
 * the reader is trapped in a frame with no route to Tasks or Logs.
 */
function requestNavigate(hash) {
  try { parent.postMessage({ type: "forge:navigate", href: hash }, "*"); } catch { /* cross-origin */ }
}

// The renderer is set once the Pixi app initializes; texture factories below
// use it to bake procedural Graphics into reusable textures.
let RENDERER = null;

function toTexture(target) {
  return RENDERER.generateTexture({ target });
}

/** Shared text-style factory: bakes text at 2x resolution so it stays crisp
 * when the camera zooms in (PixiJS rasterizes Text into a texture once). */
function textStyle(overrides) {
  return Object.assign({
    fontFamily: "system-ui, sans-serif",
    resolution: 2,
  }, overrides);
}

/** Procedural textures are baked once, so draw them at 2x and render the
 * sprite at half scale - keeps dots/glows crisp when the camera zooms in. */
function circleTexture(radius, color, alpha = 1) {
  const g = new P.Graphics();
  const r = radius * 2;
  g.circle(r, r, r).fill({ color, alpha });
  return toTexture(g);
}

function softGlowTexture(radius, color) {
  const g = new P.Graphics();
  const steps = 8;
  const r2 = radius * 2;
  for (let i = 0; i < steps; i += 1) {
    const r = r2 * (1 - i / steps);
    const a = (1 - i / steps) ** 2 * 0.35;
    g.circle(r2, r2, r).fill({ color, alpha: a });
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
    g.moveTo(-4, 9).quadraticCurveTo(0, 12.5, 4, 9).stroke({ width: 1.6, color: dark, cap: "round" });
  } else if (status === "failed") {
    g.moveTo(-4, 9).quadraticCurveTo(0, 5, 4, 9).stroke({ width: 1.6, color: dark, cap: "round" });
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
  cardLayer.sortableChildren = true; // expanded cards float above their neighbors
  const effectLayer = new P.Container();
  // Gantt mode draws into its own layers rather than mutating the kanban ones, so
  // switching modes never has to rebuild or tear down the other view's scene.
  const ganttLayer = new P.Container();
  const ganttBarLayer = new P.Container();
  ganttLayer.addChild(ganttBarLayer);

  const world = new P.Container();
  world.addChild(boardGfx, labelLayer, edgeLayer, cardLayer, effectLayer, ganttLayer);

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
    // Max zoom 2.0 matches the 2x text/texture baking; beyond that content
    // upscales and goes soft.
    const newScale = clamp(scale * factor, 0.25, 2.0);
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
  const params = new URLSearchParams(location.search);
  const STATUS_FILTER = new Set((params.get("status") || "").split(",").filter(Boolean));
  const state = {
    /** "kanban" or "gantt". The Console owns this and passes it as a query param. */
    mode: params.get("mode") === "gantt" ? "gantt" : "kanban",
    manifest: null,
    layout: null,
    /** `/api/layout` payload: `{ kanban, gantt }` from the engine's viz modules. */
    serverLayout: null,
    gantt: null,          // the active GanttLayout, when in Gantt mode
    ganttBars: new Map(), // taskId -> { root, targetX, targetW, gfx, label }
    ganttNeedLayout: false,
    ganttFetchTimer: null,
    reducedMotion: typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches,
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
    /** ISO time of the last event applied, used to report staleness on disconnect. */
    lastEventAt: null,
    startedAt: null,
    completedDurationMs: 0,
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

  /**
   * Picks the kanban layout out of whatever `/api/layout` returned.
   *
   * Accepts both shapes on purpose: the bare kanban layout (a standalone `--viz`
   * server, or a Console from before the endpoint was implemented) and the
   * `{ kanban, gantt }` wrapper the Console now serves. Falling back to deriving
   * the board from the manifest alone keeps an older or failing server usable.
   */
  function resolveLayout(manifest, layout) {
    const candidate = layout && layout.kanban ? layout.kanban : layout;
    if (candidate && Array.isArray(candidate.columns) && candidate.columns.length === 4) return candidate;
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
        style: textStyle({
          fontSize: 14,
          fontWeight: "800",
          fill: 0xe8ecf5,
          letterSpacing: 0.04,
        }),
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
        style: textStyle({ fontSize: 13, fontWeight: "700", fill: 0xc7cde0 }),
      });
      name.position.set(0, 0);
      const idx = new P.Text({
        text: `Phase ${phase.index + 1}`,
        style: textStyle({ fontSize: 10, fill: 0x8b96b8 }),
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
      style: textStyle({ fontSize: 11, fontWeight: "700", fill: 0xeef1f9 }),
    });
    nameText.position.set(52, 6);
    const title = new P.Text({
      text: "",
      style: textStyle({ fontSize: 9.5, fontWeight: "500", fill: 0xb6c0dc }),
    });
    title.position.set(52, 21);
    const idText = new P.Text({
      text: "",
      style: textStyle({ fontFamily: "ui-monospace, monospace", fontSize: 8.5, fill: 0x7f88a8 }),
    });
    idText.position.set(52, 35);
    const dot = new P.Sprite(circleTexture(5, 0xffffff));
    dot.anchor.set(0.5);
    dot.scale.set(0.5);
    const badgeLayer = new P.Container();
    // Expanded-detail layer, appended last so it draws above the name-tag
    // content. paintCard never touches it; expansion fills it on demand.
    const detailLayer = new P.Container();
    detailLayer.eventMode = "none";

    const root = new P.Container();
    root.eventMode = "static";
    root.cursor = "pointer";
    root.hitArea = new P.Rectangle(0, 0, cardW, GEOM.cardH);
    root.addChild(bg, ribbon, avatar, nameText, title, idText, dot, badgeLayer, detailLayer);

    const entry = {
      root, bg, ribbon, avatar, nameText, title, idText, dot, badgeLayer, detailLayer,
      task, status: "pending", artifactId: null, ctxPct: null,
      targetX: 0, targetY: 0,
      expanded: false, detailH: 0, curH: 0, curW: 0, detailTexts: [],
    };

    root.on("pointertap", (e) => {
      e.stopPropagation();
      if (entry.expanded) collapseCard(entry); else expandCard(entry);
    });
    root.on("pointerover", (event) => {
      setHover(task.id);
      if (!entry.expanded) showTooltip(entry, event);
    });
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
    const cardW = entryW(entry);
    const hue = agentHue(entry.task.ownerAgent);
    const running = entry.status === "running";
    // Expanded cards grow (height animated via entry.curH) and use an opaque
    // backdrop so overlapping neighbors don't bleed through.
    const h = GEOM.cardH + entry.curH;
    const expanded = entry.expanded || entry.curH > 0.5;

    entry.bg.clear();
    entry.bg.roundRect(0, 0, cardW, h, 8)
      .fill({ color: expanded ? 0x0c1224 : color, alpha: expanded ? 1 : (running ? 0.14 : 0.08) })
      .stroke({ width: 1.5, color: agentColor(entry.task.ownerAgent), alpha: expanded ? 1 : 0.85 });
    // Name-tag header ribbon (status color).
    entry.ribbon.clear();
    entry.ribbon.roundRect(0, 0, cardW, 3, 2)
      .fill({ color, alpha: running ? 0.95 : 0.7 });

    drawFace(entry.avatar, hue, entry.status);

    const nameMax = cardW - 52 - 66;
    entry.nameText.text = truncate(agentLabel(entry.task.ownerAgent), Math.max(8, Math.floor(nameMax / 6.5)));
    fitTitle(entry, cardW - 58);
    entry.idText.text = truncate(entry.task.id, Math.max(4, Math.floor((cardW - 66) / 5.5)));
    entry.dot.tint = color;
    entry.dot.position.set(cardW - 12, 12);
    entry.root.alpha = entry.status === "skipped" ? 0.55 : 1;

    // Badges (context projection, artifact). Right-aligned on their own row
    // below the id text, truncated so they never cover the name/title/id.
    entry.badgeLayer.removeChildren().forEach((c) => c.destroy());
    const badgeRowY = 47;
    const badgeMaxW = cardW - 70; // keep clear of the avatar + text column (x < 58)
    const makeBadge = (text, fill) => new P.Text({ text, style: textStyle({ fontSize: 9, fill }) });

    let ctxBadge = null;
    if (entry.ctxPct !== null) ctxBadge = makeBadge(`ctx −${entry.ctxPct}%`, 0xa9d1f7);

    let artBadge = null;
    if (entry.artifactId) {
      const budget = badgeMaxW - (ctxBadge ? ctxBadge.width + 6 : 0);
      const maxChars = Math.max(6, Math.floor(budget / 5.2));
      artBadge = makeBadge(truncate(`⛁ ${entry.artifactId}`, maxChars), 0xf5c542);
    }

    let bx = cardW - 12;
    if (artBadge) {
      artBadge.anchor.set(1, 0);
      artBadge.position.set(bx, badgeRowY);
      entry.badgeLayer.addChild(artBadge);
      bx -= artBadge.width + 6;
    }
    if (ctxBadge) {
      ctxBadge.anchor.set(1, 0);
      ctxBadge.position.set(bx, badgeRowY);
      entry.badgeLayer.addChild(ctxBadge);
    }
  }

  // ── Expanded cards ─────────────────────────────────────────────────────────
  const DETAIL_FONT = 10;
  const DETAIL_PAD_X = 12;
  const DETAIL_LABEL_W = 110; // label column width; values sit to the right of it
  const DETAIL_ROW_GAP = 3;
  const DETAIL_BOTTOM_PAD = 12;
  const DETAIL_ROW_H = 17; // fixed row step (measurement-safe, roomy)
  const EXPAND_W = 150; // extra width when a card is expanded (detail spills right)

  /** Card width, animated between collapsed (cardW) and expanded (cardW + EXPAND_W). */
  function entryW(entry) {
    return state.cardW + entry.curW;
  }

  let expandedEntry = null;

  /** Finds the full manifest task (rich detail) by id. */
  function manifestTaskFor(id) {
    if (!state.manifest) return null;
    for (const phase of state.manifest.phases) {
      for (const t of phase.tasks) if (t.id === id) return t;
    }
    return null;
  }

  /** Rebuilds the detail rows of an expanded card; returns the extension
   *  height below the name-tag area. */
  function buildDetail(entry) {
    const task = manifestTaskFor(entry.task.id) || entry.task;
    const layer = entry.detailLayer;
    layer.removeChildren().forEach((c) => c.destroy());
    entry.detailTexts.length = 0;

    const w = entryW(entry);
    let y = GEOM.cardH + 8;
    const valueMax = Math.max(20, Math.floor((w - DETAIL_PAD_X * 2 - DETAIL_LABEL_W) / 6));
    const long = (v) => truncate(String(v ?? ""), valueMax);

    const push = (text, style, x = DETAIL_PAD_X) => {
      const t = new P.Text({ text, style });
      t.position.set(x, y);
      layer.addChild(t);
      entry.detailTexts.push(t);
      return t;
    };

    const row = (label, value, fill) => {
      push(label, textStyle({ fontSize: DETAIL_FONT, fontWeight: "600", fill: 0x7f88a8 }));
      push(value, textStyle({ fontSize: DETAIL_FONT, fill: fill || 0xdbe4ff }), DETAIL_PAD_X + DETAIL_LABEL_W);
      y += DETAIL_ROW_H;
    };

    // Full task title, word-wrapped (the name-tag only shows a truncated one).
    const title = new P.Text({
      text: task.title || task.id || "",
      style: textStyle({
        fontSize: DETAIL_FONT,
        fontWeight: "700",
        fill: 0xe8ecf5,
        wordWrap: true,
        wordWrapWidth: w - DETAIL_PAD_X * 2,
        lineHeight: 14,
      }),
    });
    title.position.set(DETAIL_PAD_X, y);
    layer.addChild(title);
    entry.detailTexts.push(title);
    y += (title.height > 0 ? title.height : 14) + 6;

    if (task.description) {
      const l = push("Description", textStyle({ fontSize: DETAIL_FONT, fontWeight: "600", fill: 0x7f88a8 }));
      const body = new P.Text({
        text: truncate(task.description, 240),
        style: textStyle({
          fontSize: DETAIL_FONT,
          fill: 0xb6c0dc,
          wordWrap: true,
          wordWrapWidth: w - DETAIL_PAD_X * 2,
          lineHeight: 14,
        }),
      });
      body.position.set(DETAIL_PAD_X, y + l.height + 2);
      layer.addChild(body);
      entry.detailTexts.push(body);
      y += l.height + 2 + (body.height > 0 ? body.height : 42) + 6;
    }

    row("Status", STATUS_LABEL[entry.status] || entry.status, STATUS_COLORS[entry.status] || 0xdbe4ff);
    row("Owner", agentLabel(entry.task.ownerAgent));
    row("Phase", String(entry.task.phaseId ?? ""));
    if (entry.durationMs) row("Duration", `${Math.round(entry.durationMs / 1000)}s`);
    if (task.timeoutMs) row("Timeout", `${Math.round(task.timeoutMs / 1000)}s`);
    if (entry.artifactId) row("Artifact", String(entry.artifactId));
    if (entry.errorMessage) row("Error", long(entry.errorMessage), 0xff8f8f);
    if (task.inputs && task.inputs.length) row("Inputs", long(task.inputs.join(", ")));
    if (task.dependencies && task.dependencies.length) row("Dependencies", long(task.dependencies.join(", ")));
    if (task.expectedOutputs && task.expectedOutputs.length) row("Outputs", long(task.expectedOutputs.join(", ")));
    if (task.validationCommands && task.validationCommands.length) row("Validation", long(task.validationCommands.join("; ")));

    return y - (GEOM.cardH + 8) + DETAIL_BOTTOM_PAD;
  }

  function expandCard(entry) {
    if (expandedEntry && expandedEntry !== entry) collapseCard(expandedEntry);
    expandedEntry = entry;
    entry.expanded = true;
    entry.root.zIndex = 1;
    // Snap the width to the expanded value immediately so detail lays out at the
    // wide size; the ticker keeps it there (and animates it back down on close).
    entry.curW = EXPAND_W;
    entry.detailH = buildDetail(entry);
    if (entry.curH === 0) entry.curH = 1;
    entry.root.hitArea = new P.Rectangle(0, 0, entryW(entry), GEOM.cardH + entry.detailH);
    hideTooltip();
    paintCard(entry);
  }

  function collapseCard(entry) {
    entry.expanded = false;
    entry.root.zIndex = 0;
    entry.root.hitArea = new P.Rectangle(0, 0, state.cardW, GEOM.cardH);
    if (expandedEntry === entry) expandedEntry = null;
    hideTooltip();
    paintCard(entry);
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
      x: entry.root.x + (side === "right" ? entryW(entry) : 0),
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
      dot.scale.set(0.5);
      dot.eventMode = "none";
      dot.position.set(from.root.x + entryW(from), from.root.y + GEOM.cardH / 2);
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
    expandedEntry = null;
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
    applyStatusFilter();
    drawEdges();
    fitCamera();
  }

  /**
   * Dims tasks whose status is filtered out rather than removing them.
   *
   * Removing cards would reflow the board and hide the shape of the build — the
   * filtered-out columns are exactly the context needed to judge the ones you
   * kept. Applied to both modes so the two agree about what is in view.
   */
  function applyStatusFilter() {
    const filtering = STATUS_FILTER.size > 0;
    for (const entry of state.ordered) {
      const visible = !filtering || STATUS_FILTER.has(entry.status);
      entry.root.visible = visible;
      if (entry.status === "skipped") entry.root.alpha = 0.55;
      else if (!visible) entry.root.alpha = 0.18;
      else entry.root.alpha = 1;
    }
    if (state.gantt) {
      for (const entry of state.ganttBars.values()) {
        entry.root.visible = !filtering || STATUS_FILTER.has(entry.bar.status);
      }
      // Re-tint the bars to match, since the bar fill encodes the same state.
      if (state.serverLayout && state.serverLayout.gantt) drawGanttLayout(state.serverLayout.gantt);
    }
    if (filtering) {
      const shown = state.ordered.filter((entry) => STATUS_FILTER.has(entry.status)).length;
      setStatus(`filtered to ${STATUS_FILTER.size} status${STATUS_FILTER.size === 1 ? "" : "es"} · ${shown}/${state.total} tasks`, "live");
    }
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
    if (entry.expanded) buildDetail(entry);
    layoutCards();
    computeCounts();
    computeCompletedDurationMs();
    updateHud();
    drawEdges();
    renderTable();
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
    renderFailedList();
    buildLegend();
  }

  /**
   * A persistent list of what failed, each entry linking out to Tasks.
   *
   * Failure used to be signalled only by a one-off red screen tint, which leaves
   * nothing to act on once it fades: the reader has to remember which task broke
   * and go find it. This is the "what do I do now" list.
   */
  function renderFailedList() {
    const host = $id("failed-list");
    if (!host) return;
    const failed = state.ordered.filter((entry) => entry.status === "failed");
    host.textContent = "";
    if (failed.length === 0) {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    const title = document.createElement("div");
    title.className = "failed-title";
    title.textContent = `${failed.length} failed`;
    host.appendChild(title);
    for (const entry of failed) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "failed-row";
      row.textContent = `${entry.task.id} · ${truncate(entry.task.title, 34)}`;
      row.title = entry.errorMessage || "Open this task in Tasks";
      row.addEventListener("click", () => requestNavigate(`#/tasks?task=${encodeURIComponent(entry.task.id)}`));
      host.appendChild(row);
    }
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

  function computeCompletedDurationMs() {
    let total = 0;
    for (const entry of state.ordered) {
      if (entry.status !== "complete") continue;
      if (typeof entry.durationMs !== "number" || Number.isNaN(entry.durationMs) || entry.durationMs < 0) continue;
      total += entry.durationMs;
    }
    state.completedDurationMs = total;
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  function statusHtml(status) {
    return `<span class="status-label status-${status}">${STATUS_LABEL[status]}</span>`;
  }

  function showTooltip(entry, event) {
    const task = entry.task;
    showDetailTooltip(
      { x: event.global.x, y: event.global.y },
      `<div class="tt-title">${esc(task.title)}</div>`
        + `<div class="tt-sub">${esc(task.id)}${task.ownerAgent ? " · " + esc(task.ownerAgent) : ""}</div>`
        + `<div class="tt-status">${statusHtml(entry.status)}</div>`
        + (entry.artifactId ? `<div class="tt-sub">artifact: ${esc(entry.artifactId)}</div>` : ""),
      task.id,
    );
  }

  /**
   * Renders tooltip content beside a point, with a navigation strip.
   *
   * A canvas holds no links, so "open this task in Tasks" previously had nowhere
   * to live and the only way out of the board was the fallback text. The tooltip
   * itself is `pointer-events: none` so it never blocks the board, so the strip
   * opts back in — otherwise its buttons would be unclickable.
   */
  function showDetailTooltip(at, html, taskId) {
    const tt = $id("tooltip");
    tt.textContent = "";
    const body = document.createElement("div");
    body.innerHTML = html;
    tt.appendChild(body);
    const strip = document.createElement("div");
    strip.className = "tt-actions";
    for (const [label, hash] of [
      ["Open in Tasks", `#/tasks?task=${encodeURIComponent(taskId)}`],
      ["Logs", "#/logs"],
      ["Artifacts", "#/artifacts"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => { hideTooltip(); requestNavigate(hash); });
      strip.appendChild(button);
    }
    tt.appendChild(strip);
    tt.classList.remove("hidden");
    tt.dataset.task = taskId;
    positionTooltip(at.x, at.y, tt);
  }

  /**
   * Places the tooltip beside a point, flipping and clamping so it never leaves
   * the window. The element is `position: fixed` with no intrinsic offset, so
   * without this it rendered at its static position instead of near the pointer.
   */
  function positionTooltip(x, y, tt) {
    const pad = 12;
    const box = tt.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + box.width > window.innerWidth - pad) left = Math.max(pad, x - box.width - pad);
    if (top + box.height > window.innerHeight - pad) top = Math.max(pad, y - box.height - pad);
    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
  }

  function hideTooltip() {
    $id("tooltip").classList.add("hidden");
  }

  // Clicking a card expands it in place; clicking the board/background or
  // pressing Escape collapses the expanded card again.
  background.on("pointertap", () => { if (expandedEntry) collapseCard(expandedEntry); });
  boardGfx.on("pointertap", () => { if (expandedEntry) collapseCard(expandedEntry); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expandedEntry) collapseCard(expandedEntry);
  });

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
    if (snapshot.layout && snapshot.layout.gantt) state.serverLayout = snapshot.layout;
    if (state.mode === "gantt" && state.serverLayout && state.serverLayout.gantt) {
      drawGanttLayout(state.serverLayout.gantt);
    }
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
        // Keep the task's own timestamps on the card entry. The Gantt reads them
        // from the run state, but the card's table view and expanded detail need
        // them too, and the engine only persists them once per task.
        if (record.startedAt) entry.startedAt = record.startedAt;
        if (record.completedAt) entry.completedAt = record.completedAt;
        if (record.completedAt && record.status === "complete") {
          entry.durationMs = record.startedAt
            ? Date.parse(record.completedAt) - Date.parse(record.startedAt)
            : undefined;
        }
        if (record.artifactId) entry.artifactId = record.artifactId;
        entry.errorMessage = record.errorMessage;
        if (entry.status !== record.status) applyStatusToCard(entry, record.status);
        else if (record.status === "complete") {
          computeCompletedDurationMs();
          updateHud();
        }
      }
    }
    setStatus(`connected · run ${ws.runId ?? "—"} · ${ws.status ?? state.status}`, ws.status === "failed" ? "warn" : "live");
    if (ws.status === "complete") showComplete();
    if (ws.status === "failed") showFailure();
    if (ws.status === "paused") showBanner("Paused", "Run is paused. Resume with `workflow-engine -- run`.", "paused");
  }

  // Audit actions that change what the schedule looks like. Each one invalidates
  // the Gantt forecast, which is recomputed server-side and re-fetched debounced.
  const SCHEDULE_ACTIONS = new Set([
    "run.started", "phase.started", "task.started", "task.complete",
    "task.failed", "task.skipped", "run.complete", "run.failed",
  ]);

  function applyAuditEvent(event) {
    const action = event.action;
    const entry = event.taskId ? state.cards.get(event.taskId) : undefined;
    if (SCHEDULE_ACTIONS.has(action) && state.mode === "gantt") scheduleGanttLayout();

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
        if (entry) {
          if (event.timestamp) entry.startedAt = event.timestamp;
          if (entry.status !== "running") applyStatusToCard(entry, "running");
        }
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
          if (event.timestamp) entry.completedAt = event.timestamp;
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
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const now = performance.now();

    // Cards glide to their column/stack position.
    let moving = false;
    for (const entry of state.ordered) {
      // Expanded-card height + width animation (open/close) + detail fade.
      const targetH = entry.expanded ? entry.detailH : 0;
      const targetW = entry.expanded ? EXPAND_W : 0;
      const ek = 1 - Math.exp(-dt * 12);
      entry.curH = lerp(entry.curH, targetH, ek);
      entry.curW = lerp(entry.curW, targetW, ek);
      if (Math.abs(entry.curH - targetH) < 0.5) entry.curH = targetH;
      if (Math.abs(entry.curW - targetW) < 0.5) entry.curW = targetW;
      if (!entry.expanded && entry.curH < 0.5) entry.detailH = 0;
      if (entry.expanded || entry.curH > 0 || entry.curW > 0) {
        // Repaint the card so the opaque backdrop and the name-tag (title fit,
        // dot, badges) track the animating height and width, then fade the
        // detail layer with the height.
        const hMoving = Math.abs(entry.curH - targetH) > 0.5;
        const wMoving = Math.abs(entry.curW - targetW) > 0.5;
        if (hMoving || wMoving) paintCard(entry);
        if (entry.detailH > 0) {
          entry.detailLayer.alpha = clamp(entry.curH / entry.detailH, 0, 1);
          if (hMoving) {
            entry.root.hitArea = new P.Rectangle(0, 0, entryW(entry), GEOM.cardH + entry.curH);
          }
        }
      }

      const k = 1 - Math.exp(-dt * 8);
      const nx = lerp(entry.root.x, entry.targetX, k);
      const ny = lerp(entry.root.y, entry.targetY, k);
      if (Math.abs(nx - entry.targetX) > 0.5 || Math.abs(ny - entry.targetY) > 0.5) moving = true;
      entry.root.position.set(nx, ny);
      if (entry.status === "running" && !state.reducedMotion) {
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(now / 300));
        entry.ribbon.alpha = pulse;
      } else {
        entry.ribbon.alpha = 1;
      }
    }

    updateTravellers(dt);
    if (moving) drawEdges();
    // The "now" marker has to advance every frame or a Gantt would look frozen
    // between task events. It is cheap (one line) and skipped entirely in kanban.
    if (state.mode === "gantt") updateNowMarker();

    const s = Math.floor(state.completedDurationMs / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    $id("elapsed").textContent = `${mm}:${ss}`;
  });

  // ── Gantt mode ─────────────────────────────────────────────────────────────
  //
  // The bar geometry is a pure function of the manifest and run state, computed
  // by the engine's `viz/gantt.ts` and served on `/api/layout`. Nothing here
  // re-implements scheduling: the board only draws what the engine decided, which
  // is what keeps the forecast agreeing with what the engine will actually run.

  const ganttGrid = new P.Graphics();
  const ganttBarsGfx = new P.Graphics();
  const ganttTextLayer = new P.Container();
  const ganttNowGfx = new P.Graphics();
  ganttLayer.addChild(ganttGrid, ganttBarsGfx, ganttTextLayer, ganttNowGfx);
  ganttLayer.eventMode = "none";
  ganttTextLayer.eventMode = "none";
  ganttNowGfx.eventMode = "none";

  const GANTT = { layoutDebounceMs: 250, minSpanMs: 60_000 };

  /**
   * Projects a timestamp onto the plot. The engine's `gantt.ts` ships the domain
   * (axis extents and plot geometry) as plain numbers, because a function on the
   * payload would be dropped by JSON.stringify and arrive as `undefined`. The
   * projection itself is a rendering concern, so it lives here.
   */
  function xFor(layout, ms) {
    const span = Math.max(layout.axis.max - layout.axis.min, GANTT.minSpanMs);
    return layout.plot.left + ((ms - layout.axis.min) / span) * layout.plot.width;
  }

  const ESTIMATE_LABEL = {
    actual: "measured",
    audit: "from this task's own attempts",
    owner: "from this agent's other tasks",
    default: "default estimate",
  };

  function estimateSourceText(bar) {
    return ESTIMATE_LABEL[bar.estimateSource] ?? "estimated";
  }

  function formatClock(ms) {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  /** Diamonds mark zero-length review gates, which are not durations. */
  function drawMilestone(g, x, y, size, color) {
    g.moveTo(x, y - size).lineTo(x + size, y).lineTo(x, y + size).lineTo(x - size, y).closePath()
      .fill({ color, alpha: 0.95 }).stroke({ width: 1.2, color: 0xffffff, alpha: 0.5 });
  }

  function drawGanttLayout(layout) {
    state.gantt = layout;
    ganttGrid.clear();
    ganttBarsGfx.clear();
    ganttNowGfx.clear();
    for (const child of ganttTextLayer.removeChildren()) child.destroy();
    for (const entry of state.ganttBars.values()) entry.root.destroy();
    state.ganttBars.clear();
    if (!layout || !layout.bars) return;

    const { axis, plot } = layout;
    // The axis gutter comes from the layout, so tick labels and the first phase
    // rollup cannot collide however the geometry is tuned.
    const top = layout.axisHeight;
    const project = (ms) => xFor(layout, ms);

    // Day rules first, so bars draw over them.
    for (const tick of axis.ticks) {
      const x = project(tick.at);
      ganttGrid.moveTo(x, top - 6).lineTo(x, layout.height).stroke({
        width: tick.dayBoundary ? 1 : 1,
        color: tick.dayBoundary ? 0xffffff : 0xffffff,
        alpha: tick.dayBoundary ? 0.16 : 0.06,
      });
      const label = new P.Text({
        text: tick.label,
        style: textStyle({ fontSize: 10, fill: tick.dayBoundary ? 0xc7cde0 : 0x8b96b8 }),
      });
      label.anchor.set(0.5, 0);
      label.position.set(x, top - 20);
      ganttTextLayer.addChild(label);
    }

    for (const row of layout.rows) {
      if (row.kind === "phase") {
        ganttGrid.rect(plot.left - 8, row.y, plot.width + 16, row.height)
          .fill({ color: 0xffffff, alpha: row.id === state.currentPhase ? 0.07 : 0.03 });
        // Phase name in the rail. Without it the rollup bars are anonymous spans
        // and the reader has to infer grouping from the row order alone.
        const label = new P.Text({
          text: truncate(row.label, 30),
          style: textStyle({
            fontSize: 11,
            fontWeight: "700",
            fill: row.id === state.currentPhase ? 0x9be3a6 : 0xc7cde0,
          }),
        });
        label.anchor.set(1, 0.5);
        label.position.set(plot.left - 14, row.y + row.height / 2);
        ganttTextLayer.addChild(label);
      }
    }

    // Phase rollups, then the task bars on top.
    for (const rollup of layout.phaseBars) {
      const row = layout.rows[rollup.row];
      if (!row) continue;
      const x = project(rollup.startMs);
      const w = Math.max(2, project(rollup.endMs) - x);
      ganttBarsGfx.roundRect(x, row.y + row.height / 2 - 5, w, 10, 5)
        .fill({ color: rollup.critical ? 0xf5c542 : 0x8b96b8, alpha: 0.22 })
        .stroke({ width: 1, color: rollup.critical ? 0xf5c542 : 0x8b96b8, alpha: 0.5 });
    }

    for (const bar of layout.bars) {
      const row = layout.rows[bar.row];
      if (!row) continue;
      const color = STATUS_COLORS[bar.status] ?? STATUS_COLORS.pending;
      const agent = agentColor(bar.ownerAgent);
      const cy = row.y + row.height / 2;
      const barH = Math.min(16, row.height - 8);

      if (bar.milestone) {
        drawMilestone(ganttBarsGfx, project(bar.endMs), cy, 7, color);
      } else {
        const x = project(bar.startMs);
        // A forecast is a guess, so it is drawn as an outline; only measured work
        // is filled. That distinction is the whole point of showing both.
        const w = Math.max(3, project(bar.endMs) - x);
        if (bar.kind === "planned") {
          ganttBarsGfx.roundRect(x, cy - barH / 2, w, barH, 4)
            .fill({ color, alpha: 0.1 })
            .stroke({ width: 1, color, alpha: 0.75 });
          for (let hatch = x + 4; hatch < x + w - 2; hatch += 6) {
            ganttBarsGfx.moveTo(hatch, cy + barH / 2 - 2).lineTo(hatch + 4, cy - barH / 2 + 2)
              .stroke({ width: 1, color, alpha: 0.3 });
          }
        } else {
          ganttBarsGfx.roundRect(x, cy - barH / 2, w, barH, 4)
            .fill({ color, alpha: bar.status === "running" ? 0.9 : 0.75 })
            .stroke({ width: bar.critical ? 2 : 1, color: bar.critical ? 0xf5c542 : agent, alpha: 1 });
        }
      }

      // Left rail: task identity, matching the kanban's name-tag convention.
      const label = new P.Text({
        text: truncate(row.label, 34),
        style: textStyle({
          fontSize: row.kind === "phase" ? 11 : 10,
          fontWeight: row.kind === "phase" ? "700" : "500",
          fill: row.kind === "phase" ? 0xc7cde0 : 0xb6c0dc,
        }),
      });
      label.anchor.set(1, 0.5);
      label.position.set(plot.left - 14, cy);
      ganttTextLayer.addChild(label);

      // Hit target + tooltip, so a bar carries the same detail a card does.
      const target = new P.Container();
      target.eventMode = "static";
      target.cursor = "pointer";
      const hit = new P.Graphics();
      hit.rect(project(bar.startMs) - 3, row.y, Math.max(8, project(bar.endMs) - project(bar.startMs) + 6), row.height)
        .fill({ color: 0xffffff, alpha: 0.001 });
      target.addChild(hit);
      target.on("pointerover", () => showGanttTooltip(bar, target));
      target.on("pointerout", () => hideTooltip());
      target.visible = !STATUS_FILTER.size || STATUS_FILTER.has(bar.status);
      ganttLayer.addChild(target);
      state.ganttBars.set(bar.taskId, { root: target, bar });
    }

    state.width = layout.width;
    state.height = layout.height;
    fitCamera();
    updateNowMarker();
  }

  function showGanttTooltip(bar, node) {
    const start = formatClock(bar.startMs);
    const end = formatClock(bar.endMs);
    const lines = [
      `<div class="tt-title">${esc(bar.taskId)}</div>`,
      `<div class="tt-sub">${esc(agentLabel(bar.ownerAgent))}</div>`,
      `<div class="tt-status">${statusHtml(bar.status)}</div>`,
      `<div class="tt-sub">${esc(start)} → ${esc(end)} · ${esc(formatDuration(bar.durationMs))}</div>`,
      `<div class="tt-sub">${bar.kind === "planned" ? "forecast" : "measured"} · ${esc(estimateSourceText(bar))}</div>`,
    ];
    if (bar.milestone) lines.push(`<div class="tt-sub">human review gate</div>`);
    if (bar.critical) lines.push(`<div class="tt-sub" style="color:#f5c542">on the critical path</div>`);
    // `toGlobal` resolves the canvas transform, so the point lands in the same
    // screen space the fixed-position tooltip expects.
    showDetailTooltip(node.toGlobal({ x: 0, y: 0 }), lines.join(""), bar.taskId);
  }

  /** Redraws the "now" marker. Runs every frame; only the geometry changes. */
  function updateNowMarker() {
    const layout = state.gantt;
    ganttNowGfx.clear();
    if (!layout || state.mode !== "gantt") return;
    const now = Date.now();
    if (now < layout.axis.min || now > layout.axis.max) return;
    const x = xFor(layout, now);
    ganttNowGfx.moveTo(x, GANTT.axisTop - 6).lineTo(x, layout.height)
      .stroke({ width: 1.5, color: 0xff8f8f, alpha: 0.55 });
  }

  /**
   * Re-fetches the layout after a structural change. Debounced, because a run
   * emits several events per task and each request re-runs the whole schedule.
   */
  function scheduleGanttLayout() {
    if (state.ganttFetchTimer !== null) return;
    state.ganttFetchTimer = window.setTimeout(() => {
      state.ganttFetchTimer = null;
      void fetch("/api/layout").then((response) => response.json()).then((layout) => {
        state.serverLayout = layout;
        if (state.mode === "gantt" && layout && layout.gantt) drawGanttLayout(layout.gantt);
      }).catch(() => { /* the board keeps its last layout */ });
    }, GANTT.layoutDebounceMs);
  }

  function applyMode() {
    const kanban = state.mode === "kanban";
    boardGfx.visible = kanban;
    labelLayer.visible = kanban;
    edgeLayer.visible = kanban;
    cardLayer.visible = kanban;
    effectLayer.visible = kanban;
    ganttLayer.visible = !kanban;
    // The kanban owns card expansion; a mode switch must not leave a card open
    // behind a different view.
    if (!kanban && expandedEntry) collapseCard(expandedEntry);
    if (!kanban) {
      const gantt = state.serverLayout && state.serverLayout.gantt;
      if (gantt) drawGanttLayout(gantt);
      else { state.width = 1280; state.height = 800; fitCamera(); }
    } else {
      state.width = state.layout ? state.layout.width : 1280;
      state.height = state.layout ? state.layout.height : 800;
      fitCamera();
    }
    const modeHost = $id("mode-switch");
    if (modeHost) {
      applyModeButtons();
    }
    // Reflected on <body> so a screenshot tool or test can assert which mode
    // actually rendered, rather than inferring it from the canvas.
    document.body.dataset.boardMode = state.mode;
    setStatus(`${state.mode} · ${state.status === "idle" ? "" : state.status}`.trim(), "live");
  }

  function wireModeSwitch() {
    const host = $id("mode-switch");
    if (!host) return;
    // Embedded in the Console, the chrome above the frame already offers the
    // same switch and keeps it in step. Two controls for one setting reads as a
    // bug when they ever disagree, so the in-frame copy is only kept for the
    // standalone `--viz` server, where it is the only one.
    if (window.self !== window.top) {
      host.remove();
      applyModeButtons();
      return;
    }
    for (const button of host.querySelectorAll("[data-mode]")) {
      button.addEventListener("click", () => {
        state.mode = button.dataset.mode === "gantt" ? "gantt" : "kanban";
        applyMode();
        // The Console chrome mirrors the selection so the two stay in step.
        try { parent.postMessage({ type: "forge:board-mode", mode: state.mode }, "*"); } catch { /* cross-origin */ }
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const modes = ["kanban", "gantt"];
        const next = modes[(modes.indexOf(state.mode) + (event.key === "ArrowRight" ? 1 : modes.length - 1)) % modes.length];
        state.mode = next;
        applyMode();
        const target = host.querySelector(`[data-mode="${next}"]`);
        if (target) target.focus();
        try { parent.postMessage({ type: "forge:board-mode", mode: next }, "*"); } catch { /* cross-origin */ }
      });
    }
    applyModeButtons();
  }

  /** Reflects the current mode on whatever mode controls are present. */
  function applyModeButtons() {
    const host = $id("mode-switch");
    if (!host) return;
    for (const button of host.querySelectorAll("[data-mode]")) {
      const active = button.dataset.mode === state.mode;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.classList.toggle("active", active);
    }
  }

  // ── Accessible table view ───────────────────────────────────────────────────
  //
  // The board is a canvas, so it has no text for a screen reader or a keyboard
  // user to reach. This renders the same layout as a real table: it is a view of
  // the engine's data, not an independent copy of the numbers.

  let tableVisible = false;

  function formatStamp(ms) {
    if (!Number.isFinite(ms)) return "—";
    const date = new Date(ms);
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function renderTable() {
    if (!tableVisible) return;
    const body = $id("table-body");
    if (!body) return;
    const rows = [];
    const tasks = state.manifest
      ? state.manifest.phases.flatMap((phase) => phase.tasks.map((task) => ({ task, phase })))
      : [];

    if (state.gantt && state.gantt.bars) {
      const byId = new Map(state.gantt.bars.map((bar) => [bar.taskId, bar]));
      const label = new Map(state.gantt.rows.map((row) => [row.id, row.label]));
      for (const bar of state.gantt.bars) {
        rows.push(el("tr", null, [
          el("th", { scope: "row" }, label.get(bar.taskId) ?? bar.taskId),
          el("td", null, agentLabel(bar.ownerAgent)),
          el("td", null, statusCell(bar.status)),
          el("td", null, bar.critical ? "critical path" : bar.kind === "planned" ? "planned" : "measured"),
          el("td", { className: "mono" }, formatStamp(bar.startMs)),
          el("td", { className: "mono" }, bar.milestone ? "review gate" : formatStamp(bar.endMs)),
          el("td", { className: "mono" }, bar.milestone ? "—" : formatDuration(bar.durationMs)),
          el("td", { className: "mono" }, bar.kind === "planned" ? `forecast · ${estimateSourceText(bar)}` : "measured"),
        ]));
      }
      // A manifest task with no bar (no state and no forecast) still belongs in
      // the table, or the view would silently hide work.
      for (const { task, phase } of tasks) {
        if (byId.has(task.id)) continue;
        rows.push(el("tr", null, [
          el("th", { scope: "row" }, `${task.id} · ${task.title}`),
          el("td", null, agentLabel(task.ownerAgent)),
          el("td", null, statusCell("pending")),
          el("td", null, phase.title ?? phase.id),
          el("td", { className: "mono" }, "—"),
          el("td", { className: "mono" }, "—"),
          el("td", { className: "mono" }, "—"),
          el("td", { className: "mono" }, (task.dependencies ?? []).join(", ") || "—"),
        ]));
      }
    } else {
      for (const entry of state.ordered) {
        const task = entry.task;
        rows.push(el("tr", null, [
          el("th", { scope: "row" }, `${task.id} · ${task.title}`),
          el("td", null, agentLabel(task.ownerAgent)),
          el("td", null, statusCell(entry.status)),
          el("td", null, task.phaseId ?? "—"),
          el("td", { className: "mono" }, entry.startedAt ? formatStamp(Date.parse(entry.startedAt)) : "—"),
          el("td", { className: "mono" }, entry.completedAt ? formatStamp(Date.parse(entry.completedAt)) : "—"),
          el("td", { className: "mono" }, entry.durationMs ? formatDuration(entry.durationMs) : "—"),
          el("td", { className: "mono" }, (task.dependencies ?? []).join(", ") || "—"),
        ]));
      }
    }
    body.replaceChildren(...rows);
  }

  /** A status badge as a real element, so the table shows a label, not markup. */
function statusCell(status) {
    const label = STATUS_LABEL[status] ?? status;
    const span = document.createElement("span");
    span.className = `status-label status-${status}`;
    span.textContent = label;
    return span;
  }

  /**
   * Minimal element builder for the table view. Arrays of children must be
   * spread: `append(array)` stringifies them, which silently renders
   * "[object HTMLTableCellElement]" as the cell's text instead of nesting them.
   */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value !== null && value !== undefined) node.setAttribute(key, String(value));
      }
    }
    if (children !== undefined && children !== null) {
      for (const child of Array.isArray(children) ? children : [children]) {
        if (child !== null && child !== undefined) node.append(child);
      }
    }
    return node;
  }

  function applyTableVisibility() {
    const view = $id("table-view");
    const toggle = $id("table-toggle");
    if (view) view.classList.toggle("hidden", !tableVisible);
    if (toggle) {
      toggle.setAttribute("aria-pressed", tableVisible ? "true" : "false");
      toggle.classList.toggle("active", tableVisible);
    }
    document.body.classList.toggle("table-open", tableVisible);
    renderTable();
  }

  function wireTableToggle() {
    const toggle = $id("table-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      tableVisible = !tableVisible;
      applyTableVisibility();
      if (tableVisible) {
        const close = $id("table-close");
        if (close) close.focus();
      }
    });
  }

  // ── Data wiring ──────────────────────────────────────────────────────────
  async function fetchSnapshot() {
    // Distinguish "the server is unreachable" from "this project has nothing to
    // show yet". They look identical to the user otherwise, and the fix for one
    // is not the fix for the other.
    let m = null;
    try {
      m = await fetch("/api/manifest").then((r) => r.json());
    } catch {
      setStatus("cannot reach the Console server · retrying…", "warn");
      return;
    }
    const [s, l] = await Promise.all([
      fetch("/api/state").then((r) => r.json()).catch(() => null),
      fetch("/api/layout").then((r) => r.json()).catch(() => null),
    ]);
    state.serverLayout = l;
    if (!m) {
      hideBanner();
      showBanner("No execution manifest yet", "Compile one from the Overview pipeline panel to see the build on this board.", "paused");
      setStatus("no execution manifest", "warn");
      return;
    }
    applySnapshot({ manifest: m, state: s, layout: l });
    if (!s) showBanner("Ready to build", "No run yet. Start one from the Overview Controls panel.", "paused");
  }

  const es = new EventSource("/api/events");
  es.onmessage = () => {};
  es.onopen = () => setStatus("connected · waiting for engine events…", "live");
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      // Say how stale the picture is. "disconnected" alone leaves the reader
      // guessing whether the build stopped or the view simply froze.
      const age = state.startedAt
        ? ` · last state ${Math.round((Date.now() - Date.parse(state.lastEventAt ?? state.startedAt)) / 1000)}s ago`
        : "";
      setStatus(`disconnected · run finished or server stopped${age}`, "dead");
      showBanner("Disconnected", "This board stopped receiving events. The Console may have been closed; reopen it to resume.", "paused");
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

  wireModeSwitch();
  wireTableToggle();
  applyMode();
  applyTableVisibility();
  fetchSnapshot();

  // Keep the dashboard ticking even if the SSE connection drops (attach mode).
  window.setInterval(async () => {
    if (es.readyState !== EventSource.CLOSED) return;
    try {
      const s = await fetch("/api/state").then((r) => r.json());
      if (s) applyState(s);
    } catch { /* server gone */ }
  }, 2000);

  // Keeps the table view in step with the board it mirrors.
  window.setInterval(() => {
    state.lastEventAt = new Date().toISOString();
    renderTable();
  }, 4000);
})();
