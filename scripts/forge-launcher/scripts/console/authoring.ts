import fs from "node:fs";
import path from "node:path";
import { inventoryForRunner, readAuthoringInventory, refreshAuthoringInventory, type AuthoringRunner, type InventoryProbe } from "../authoring-inventory.ts";
import { detectHarnessRoot, registryPath } from "./paths.ts";

export function selectedAuthoringRunner(repoRoot?: string, requested?: unknown): AuthoringRunner {
  const runner = requested ?? process.env.FORGE_RUN_WITH
    ?? (repoRoot && detectHarnessRoot(repoRoot) === ".github" ? "copilot" : "opencode");
  if (runner !== "copilot" && runner !== "opencode" && runner !== "stub") {
    throw new Error("Authoring runner must be copilot or opencode.");
  }
  return runner;
}

export function authoringInventoryCache(): string {
  return path.join(path.dirname(registryPath()), "authoring-models");
}

export async function consoleAuthoringInventory(
  repoRoot: string | undefined,
  requested: unknown,
  refresh = false,
  probe?: InventoryProbe,
) {
  const runner = selectedAuthoringRunner(repoRoot, requested);
  const location = repoRoot ?? authoringInventoryCache();
  if (refresh) fs.mkdirSync(location, { recursive: true });
  const inventory = refresh
    ? await refreshAuthoringInventory(location, runner, probe)
    : readAuthoringInventory(location);
  const models = inventoryForRunner(inventory, runner);
  const timestamps = models.map((model) => model.last_verified).filter((date): date is string => Boolean(date));
  return {
    runner,
    models,
    last_verified: timestamps.length ? timestamps.sort()[0] : undefined,
  };
}
