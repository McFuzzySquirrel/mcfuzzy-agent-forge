import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { api } from "./console/dashboard/api.js";
import { renderProjects, unmountProjects } from "./console/dashboard/views/projects.js";
import { store } from "./console/dashboard/state.js";
import type { ProjectsIndex, RemoveProjectsResult, Summary } from "./console/dashboard/types.js";

// Minimal DOM surface used by this view, keeping the launcher tests dependency-free.
class Element {
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  className = "";
  dataset: Record<string, string> = {};
  disabled = false;
  checked = false;
  indeterminate = false;
  value = "";
  private text = "";

  constructor(readonly tagName: string) {}

  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  appendChild(child: Element): Element { this.children.push(child); return child; }
  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
    if (key === "disabled") this.disabled = true;
    if (key === "value") this.value = value;
  }
  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  fire(event = "click"): void {
    if (this.disabled) return;
    if (event === "change") this.checked = !this.checked;
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
  querySelectorAll(selector: string): Element[] {
    const matches = (element: Element) => selector.split(",").some((part) => {
      const match = part.trim().match(/^([\w-]+)?(?:\[([\w-]+)(?:=([^\]]+))?\])?$/);
      if (!match) throw new Error(`Unsupported test selector: ${part}`);
      return (!match[1] || element.tagName === match[1])
        && (!match[2] || (match[3] ? element.attributes.get(match[2]) === match[3] : element.attributes.has(match[2])));
    });
    return this.children.flatMap((child) => [
      ...(matches(child) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
}

function fixture(t: TestContext) {
  const container = new Element("main");
  const body = new Element("body");
  const confirmations: string[] = [];
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  let timer = 0;
  const location = { hash: "#/projects" };
  const window = {
    addEventListener: (_event: string, _listener: () => void) => {},
    confirm: (message: string) => { confirmations.push(message); return true; },
    setInterval: (callback: () => void) => { intervals.set(++timer, callback); return timer; },
    clearInterval: (id?: number) => { if (id !== undefined) intervals.delete(id); },
    setTimeout: (callback: () => void) => { timeouts.set(++timer, callback); return timer; },
    clearTimeout: (id?: number) => { if (id !== undefined) timeouts.delete(id); },
  };
  const globals = {
    document: {
      body,
      createElement: (tag: string) => new Element(tag),
      createTextNode: (text: string) => { const node = new Element("#text"); node.textContent = text; return node; },
      querySelector: (selector: string) => selector === "#view" ? container : null,
    },
    window,
    location,
    EventSource: class {
      addEventListener(): void {}
    },
  };
  const restore: (() => void)[] = [];
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.after(() => {
    unmountProjects();
    for (const reset of restore) reset();
  });
  const byLabel = (label: string) => {
    const found = container.querySelectorAll("input, button").find((element) => element.attributes.get("aria-label") === label);
    assert.ok(found, `Missing accessible control: ${label}`);
    return found;
  };
  const button = (text: string) => {
    const found = container.querySelectorAll("button").find((element) => element.textContent === text);
    assert.ok(found, `Missing button: ${text}`);
    return found;
  };
  return { container, body, window, location, confirmations, intervals, timeouts, byLabel, button,
    render: () => renderProjects(container as unknown as HTMLElement) };
}

function index(): ProjectsIndex {
  return {
    current: "C:\\private\\alpha",
    projects: [
      { name: "Alpha", path: "C:\\private\\alpha", stage: "ready", lastOpenedAt: "2026-09-28T12:34:56.000Z" },
      { name: "Beta", path: "C:\\private\\beta", stage: "running" },
      { name: "Gamma", path: "C:\\private\\gamma", stage: "failed" },
    ],
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("projects render names, states and local date/time with same-column selection and no paths", async (t) => {
  const ui = fixture(t);
  t.mock.method(api, "projects", async () => index());
  ui.render();
  assert.equal(ui.byLabel("Select all projects").disabled, true);
  await flush();
  assert.match(ui.container.textContent, /Alpha \(current\).*ready/);
  assert.match(ui.container.textContent, /Beta.*running.*Never opened/);
  assert.ok(ui.container.textContent.includes(new Date(index().projects[0].lastOpenedAt!).toLocaleString()));
  assert.ok(!ui.container.textContent.includes("C:\\"));
  const table = ui.container.querySelector("table")!;
  const header = table.querySelector("thead")!.querySelector("tr")!;
  assert.ok(header.children[0].querySelector("input"));
  for (const row of table.querySelector("tbody")!.children) assert.ok(row.children[0].querySelector("input"));
  assert.equal(ui.button("Remove selected (0)").disabled, true);
  ui.byLabel("Select Alpha").fire("change");
  assert.equal(ui.byLabel("Select all projects").indeterminate, true);
  assert.equal(ui.button("Remove selected (1)").disabled, false);
  ui.byLabel("Select all projects").fire("change");
  assert.equal(ui.byLabel("Select all projects").checked, true);
  assert.equal(ui.byLabel("Select all projects").indeterminate, false);
  assert.equal(ui.byLabel("Select Beta").checked, true);
  ui.byLabel("Select all projects").fire("change");
  assert.equal(ui.byLabel("Select Alpha").checked, false);
  assert.equal(ui.button("Remove selected (0)").disabled, true);
});

test("bulk removal retains individual partial outcomes, clears removed selections and refreshes current project", async (t) => {
  const ui = fixture(t);
  let current = index();
  t.mock.method(api, "projects", async () => current);
  const removal = deferred<RemoveProjectsResult>();
  const remove = t.mock.method(api, "removeProjects", () => removal.promise);
  ui.render();
  await flush();
  ui.byLabel("Select all projects").fire("change");
  ui.button("Remove selected (3)").fire();
  assert.deepEqual(remove.mock.calls[0].arguments, [current.projects.map((project) => project.path)]);
  assert.match(ui.confirmations[0], /registry entries, Console job history, and verified external Forge job results only/);
  assert.match(ui.confirmations[0], /No files inside project folders will be changed or deleted/);
  assert.ok(!ui.confirmations[0].includes("C:\\"));
  assert.equal(ui.byLabel("Select all projects").disabled, true);
  assert.equal(ui.byLabel("Open Alpha").disabled, true);
  assert.equal(ui.button("Add folder").disabled, true);
  const results = current.projects.map((project, i) => ({
    path: project.path, name: project.name,
    status: (["removed", "blocked", "failed"] as const)[i],
    message: i === 1 ? "A Console job is still running." : `Details contain private path ${project.path}`,
  }));
  current = { current: null, projects: current.projects.slice(1) };
  removal.resolve({ results, current: null });
  await flush();
  assert.match(ui.container.textContent, /Alpha: Removed/);
  assert.match(ui.container.textContent, /Beta: Blocked/);
  assert.match(ui.container.textContent, /A Console job is still running/);
  assert.match(ui.container.textContent, /Gamma: Failed/);
  assert.ok(!ui.container.textContent.includes("private"));
  assert.ok(!ui.container.textContent.includes("(current)"));
  assert.equal(ui.container.querySelector("tbody")!.children.length, 2);
  assert.equal(ui.byLabel("Select Beta").checked, true);
  assert.equal(ui.byLabel("Select Gamma").checked, true);
  assert.equal(ui.button("Remove selected (2)").disabled, false);

  t.mock.method(api, "addRepo", async () => ({ ok: true }));
  ui.container.querySelector("input[type=text]")!.value = "C:\\private\\beta";
  ui.button("Add folder").fire();
  await flush();
  assert.match(ui.container.textContent, /Alpha: Removed.*Beta: Blocked.*Gamma: Failed/);
});

test("per-row removal supports cancellation, persistent request failures, retries and empty list", async (t) => {
  const ui = fixture(t);
  let current = { current: index().current, projects: index().projects.slice(0, 1) };
  t.mock.method(api, "projects", async () => current);
  const remove = t.mock.method(api, "removeProjects", async (_paths: string[]): Promise<RemoveProjectsResult> => { throw new Error("C:\\private\\alpha is unavailable"); });
  ui.render();
  await flush();
  ui.window.confirm = () => false;
  ui.byLabel("Remove Alpha from Forge").fire();
  assert.equal(remove.mock.callCount(), 0);
  ui.window.confirm = () => true;
  ui.byLabel("Select Alpha").fire("change");
  ui.byLabel("Remove Alpha from Forge").fire();
  await flush();
  assert.match(ui.container.textContent, /Alpha: Failed/);
  assert.ok(!ui.container.textContent.includes("C:\\"));
  assert.equal(ui.byLabel("Select Alpha").checked, true);
  assert.equal(ui.button("Remove selected (1)").disabled, false);

  remove.mock.mockImplementation(async (paths: string[]) => {
    assert.deepEqual(paths, [index().projects[0].path]);
    current = { current: null, projects: [] };
    return { current: null, results: [{ ...index().projects[0], status: "removed" as const, message: "Removed" }] };
  });
  ui.byLabel("Remove Alpha from Forge").fire();
  await flush();
  assert.match(ui.container.textContent, /Alpha: Removed/);
  assert.doesNotMatch(ui.container.textContent, /Alpha: Failed/);
  assert.match(ui.container.textContent, /Nothing here yet/);
  assert.equal(ui.byLabel("Select all projects").checked, false);
  assert.equal(ui.byLabel("Select all projects").indeterminate, false);
  assert.equal(ui.byLabel("Select all projects").disabled, true);
  assert.equal(ui.button("Remove selected (0)").disabled, true);
});

test("open errors are handled and late responses cannot navigate or replace a new mount", async (t) => {
  const ui = fixture(t);
  const projects = t.mock.method(api, "projects", async () => index());
  const select = t.mock.method(api, "selectRepo", async (): Promise<{ ok: boolean }> => { throw new Error("network down"); });
  ui.render();
  await flush();
  ui.byLabel("Open Beta").fire();
  await flush();
  assert.match(ui.container.textContent, /Could not open Beta/);
  assert.equal(ui.byLabel("Open Beta").disabled, false);
  const opening = deferred<{ ok: boolean }>();
  select.mock.mockImplementation(() => opening.promise);
  ui.byLabel("Open Beta").fire();
  unmountProjects();
  opening.resolve({ ok: true });
  await flush();
  assert.equal(ui.location.hash, "#/projects");

  const loading = deferred<ProjectsIndex>();
  projects.mock.mockImplementation(() => loading.promise);
  ui.render();
  projects.mock.mockImplementation(async () => ({ current: null, projects: [] }));
  ui.render();
  await flush();
  loading.resolve(index());
  await flush();
  assert.match(ui.container.textContent, /Nothing here yet/);
  assert.doesNotMatch(ui.container.textContent, /Alpha/);
});

test("bootstrap still refreshes projects and unmount clears timers and ignores pending removal", async (t) => {
  const ui = fixture(t);
  t.mock.method(api, "projects", async () => index());
  const bootstrap = t.mock.method(api, "bootstrap", async () => ({ ok: true, message: "Started" }));
  ui.render();
  await flush();
  ui.container.querySelectorAll("input[type=text]")[1].value = "C:\\private\\alpha";
  ui.button("Bootstrap repository").fire();
  await flush();
  assert.equal(bootstrap.mock.callCount(), 1);
  assert.equal(ui.intervals.size, 1);
  const pending = deferred<RemoveProjectsResult>();
  t.mock.method(api, "removeProjects", () => pending.promise);
  ui.byLabel("Remove Alpha from Forge").fire();
  const before = ui.container.textContent;
  unmountProjects();
  assert.equal(ui.intervals.size, 0);
  pending.resolve({ current: null, results: [{ ...index().projects[0], status: "removed", message: "Removed" }] });
  await flush();
  assert.equal(ui.container.textContent, before);
});

test("project removal API posts paths, preserves HTTP 200 partial outcomes and rejects malformed input errors", async (t) => {
  fixture(t);
  const response: RemoveProjectsResult = {
    current: null,
    results: [{ path: "C:\\repo", name: "Repo", status: "blocked", message: "Running" }],
  };
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(response)));
  assert.deepEqual(await api.removeProjects(["C:\\repo"]), response);
  const [url, init] = fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(url, "/api/projects/remove");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body as string), { paths: ["C:\\repo"] });
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.ok("X-Forge-Token" in (init.headers as Record<string, string>));
  fetch.mock.mockImplementation(async () =>
    new Response(JSON.stringify({ message: "paths must be a nonempty array" }), { status: 400, statusText: "Bad Request" }));
  await assert.rejects(api.removeProjects([]), /400 Bad Request: paths must be a nonempty array/);
});

test("router preserves pending current-project removal when the null SSE snapshot arrives before HTTP", async (t) => {
  const ui = fixture(t);
  let current = index();
  const projects = t.mock.method(api, "projects", async () => current);
  t.mock.method(api, "summary", async () => ({ repoRoot: current.current } as Summary));
  const removal = deferred<RemoveProjectsResult>();
  t.mock.method(api, "removeProjects", () => removal.promise);
  await import("./console/dashboard/main.js");
  await flush();
  ui.byLabel("Select Alpha").fire("change");
  ui.button("Remove selected (1)").fire();
  const requestCount = projects.mock.callCount();

  current = { current: null, projects: current.projects.slice(1) };
  store.applySnapshot({ summary: null, manifest: null, state: null, layout: null });
  await flush();
  assert.equal(projects.mock.callCount(), requestCount, "SSE must not refresh while removal is pending");
  assert.equal(ui.button("Remove selected (1)").disabled, true);
  assert.equal(ui.byLabel("Select Alpha").checked, true);
  assert.equal(ui.location.hash, "#/projects");

  removal.resolve({
    current: null,
    results: [{ ...index().projects[0], status: "removed", message: "Project removed from Forge." }],
  });
  await flush();
  assert.match(ui.container.textContent, /Alpha: Removed/);
  assert.equal(ui.container.querySelector("tbody")!.children.length, 2);
  assert.equal(ui.button("Remove selected (0)").disabled, true);

  current = { ...current, current: current.projects[0].path };
  store.setSummary({ repoRoot: current.current } as Summary);
  await flush();
  assert.match(ui.container.textContent, /Beta \(current\)/);
  assert.match(ui.container.textContent, /Alpha: Removed/, "later project switches should preserve removal outcomes");
});
