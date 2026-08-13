import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ValidationIssue, ValidationResult } from "./types.ts";

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchPattern(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

function validateWorkforceManifest(workforcePath: string, errors: ValidationIssue[]): Record<string, unknown> | null {
  const path = join(workforcePath, "workforce.json");
  if (!existsSync(path)) {
    errors.push(issue("workforce.json", "Missing workforce.json"));
    return null;
  }

  const data = readJson(path);
  if (!isObject(data)) {
    errors.push(issue("workforce.json", "Manifest must be a JSON object."));
    return null;
  }

  const required = ["specVersion", "id", "name", "version", "agents", "workflows"];
  for (const key of required) {
    if (!(key in data)) errors.push(issue(`workforce.json.${key}`, "Required field is missing."));
  }

  if (typeof data["specVersion"] !== "string" || data["specVersion"] !== "1.0") {
    errors.push(issue("workforce.json.specVersion", "specVersion must be '1.0'."));
  }

  if (typeof data["id"] !== "string" || !matchPattern(data["id"], /^[a-z0-9]+([.-][a-z0-9]+)*$/)) {
    errors.push(issue("workforce.json.id", "id must match reverse-DNS style pattern."));
  }

  if (typeof data["version"] !== "string" || !matchPattern(data["version"], /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)) {
    errors.push(issue("workforce.json.version", "version must be semver."));
  }

  for (const key of ["agents", "workflows", "skills"]) {
    const value = data[key];
    if (value !== undefined && !Array.isArray(value)) {
      errors.push(issue(`workforce.json.${key}`, `${key} must be an array.`));
    }
  }

  return data;
}

function validateAgent(path: string, errors: ValidationIssue[]): void {
  const value = readJson(path);
  if (!isObject(value)) {
    errors.push(issue(path, "Agent definition must be a JSON object."));
    return;
  }

  const required = ["id", "name", "role", "model"];
  for (const key of required) {
    if (!(key in value)) errors.push(issue(`${path}.${key}`, "Required field is missing."));
  }

  if (typeof value["id"] !== "string" || !matchPattern(value["id"], /^[a-z0-9]+(-[a-z0-9]+)*$/)) {
    errors.push(issue(`${path}.id`, "id must be lowercase-hyphenated."));
  }

  if (typeof value["name"] !== "string" || value["name"].trim().length === 0) {
    errors.push(issue(`${path}.name`, "name must be a non-empty string."));
  }

  if (!isObject(value["model"])) {
    errors.push(issue(`${path}.model`, "model must be an object."));
  } else {
    const tier = value["model"]["tier"];
    if (tier !== "small" && tier !== "medium" && tier !== "large") {
      errors.push(issue(`${path}.model.tier`, "model.tier must be one of: small, medium, large."));
    }
  }
}

function validateSkill(path: string, errors: ValidationIssue[]): void {
  const content = readFileSync(path, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    errors.push(issue(path, "SKILL.md must include YAML frontmatter."));
    return;
  }

  const map = new Map<string, string>();
  for (const rawLine of frontmatter[1]!.split(/\r?\n/)) {
    const idx = rawLine.indexOf(":");
    if (idx === -1) continue;
    const key = rawLine.slice(0, idx).trim();
    const value = rawLine.slice(idx + 1).trim();
    if (key) map.set(key, value.replace(/^"|"$/g, ""));
  }

  const name = map.get("name") ?? "";
  const description = map.get("description") ?? "";

  if (!name || !matchPattern(name, /^[a-z0-9]+(-[a-z0-9]+)*$/)) {
    errors.push(issue(`${path}.frontmatter.name`, "name is required and must be lowercase-hyphenated."));
  }
  if (!description) {
    errors.push(issue(`${path}.frontmatter.description`, "description is required."));
  }
}

function validateWorkflow(path: string, errors: ValidationIssue[]): void {
  const value = readJson(path);
  if (!isObject(value)) {
    errors.push(issue(path, "Workflow must be a JSON object."));
    return;
  }

  if (typeof value["id"] !== "string" || !matchPattern(value["id"], /^[a-z0-9]+(-[a-z0-9]+)*$/)) {
    errors.push(issue(`${path}.id`, "Workflow id must be lowercase-hyphenated."));
  }

  if (typeof value["start"] !== "string" || value["start"].length === 0) {
    errors.push(issue(`${path}.start`, "Workflow start node is required."));
  }

  const nodes = value["nodes"];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push(issue(`${path}.nodes`, "Workflow must include at least one node."));
    return;
  }

  for (const [index, node] of nodes.entries()) {
    if (!isObject(node)) {
      errors.push(issue(`${path}.nodes[${index}]`, "Node must be an object."));
      continue;
    }

    const id = node["id"];
    const type = node["type"];
    if (typeof id !== "string" || !id) {
      errors.push(issue(`${path}.nodes[${index}].id`, "Node id is required."));
    }

    if (type !== "agent" && type !== "humanApproval" && type !== "humanInput" && type !== "branch" && type !== "parallel" && type !== "end") {
      errors.push(issue(`${path}.nodes[${index}].type`, "Unsupported node type."));
      continue;
    }

    if (type === "agent") {
      if (typeof node["agent"] !== "string" || typeof node["action"] !== "string") {
        errors.push(issue(`${path}.nodes[${index}]`, "Agent nodes require both 'agent' and 'action'."));
      }
    }

    if ((type === "humanApproval" || type === "humanInput") && typeof node["role"] !== "string") {
      errors.push(issue(`${path}.nodes[${index}].role`, "Human nodes require role."));
    }
  }
}

export function validateWorkforcePackage(workforcePath: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const manifest = validateWorkforceManifest(workforcePath, errors);
  if (!manifest) return { ok: false, errors, warnings };

  const visit = (key: "agents" | "skills" | "workflows", validator: (path: string, errors: ValidationIssue[]) => void) => {
    const entries = manifest[key];
    if (!Array.isArray(entries)) return;
    for (const relativePath of entries) {
      if (typeof relativePath !== "string") {
        errors.push(issue(`workforce.json.${key}`, "Entries must be relative path strings."));
        continue;
      }
      const fullPath = join(workforcePath, relativePath);
      if (!existsSync(fullPath)) {
        errors.push(issue(`workforce.json.${key}`, `Referenced file does not exist: ${relativePath}`));
        continue;
      }
      validator(fullPath, errors);
    }
  };

  visit("agents", validateAgent);
  visit("skills", validateSkill);
  visit("workflows", validateWorkflow);

  if (!existsSync(join(workforcePath, "workforce.json"))) {
    warnings.push(issue("workforce.json", "No workforce manifest found."));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
