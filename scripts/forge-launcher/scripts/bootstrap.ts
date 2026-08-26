import fs from "node:fs";
import path from "node:path";
import { ok, out, warn } from "./format.ts";
import { prompt, promptYesNo, prompts } from "./prompts.ts";
import { resolveResources } from "./resources.ts";

export type Harness = "agents" | "github" | "claude" | "opencode";

export const HARNESS_ROOTS: Record<Harness, string> = {
  agents: ".agents",
  github: ".github",
  claude: ".claude",
  opencode: ".opencode",
};

export interface BootstrapOptions {
  targetDir: string;
  harness?: Harness;
  force?: boolean;
  nonInteractive?: boolean;
  /** When set, all progress output is appended here instead of stdout. */
  logFile?: string;
}

function makeLogger(logFile?: string) {
  if (!logFile) {
    return {
      out: (l: string) => out(l),
      ok: (l: string) => ok(l),
      warn: (l: string) => warn(l),
      end: () => {},
    };
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const stream = fs.createWriteStream(logFile, { flags: "a" });
  return {
    out: (l: string) => stream.write(l + "\n"),
    ok: (l: string) => stream.write(`✔  ${l}\n`),
    warn: (l: string) => stream.write(`⚠  ${l}\n`),
    end: () => stream.end(),
  };
}

/** Recursively copies a tree, excluding node_modules and dist, applying an optional rewrite. */
function copyTree(srcDir: string, destDir: string, rewrite?: { from: string; to: string }): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest, rewrite);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
      if (rewrite && entry.name.endsWith(".md")) {
        let text = fs.readFileSync(dest, "utf8");
        text = text.split(rewrite.from).join(rewrite.to);
        fs.writeFileSync(dest, text);
      }
    }
  }
}

function ensureGitignore(targetDir: string): void {
  const gi = path.join(targetDir, ".gitignore");
  const entries = ["node_modules/", "docs/engine-run.log"];
  let content = "";
  if (fs.existsSync(gi)) content = fs.readFileSync(gi, "utf8");
  if (content && !content.endsWith("\n")) content += "\n";
  const missing = entries.filter((e) => !content.split("\n").includes(e));
  if (missing.length) {
    content += missing.join("\n") + "\n";
    fs.writeFileSync(gi, content);
    out(`  Updated:  ${gi} (${missing.join(", ")})`);
  } else {
    out(`  OK:       ${gi} already ignores node_modules/ and engine-run.log`);
  }
}

export async function bootstrap(opts: BootstrapOptions): Promise<number> {
  const harness = opts.harness ?? "agents";
  const root = HARNESS_ROOTS[harness];
  const force = opts.force ?? false;

  const targetDir = path.resolve(opts.targetDir);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Error: Target directory does not exist: ${targetDir}`);
  }

  const { templatesDir, docsDir, usingBundled } = resolveResources();
  const log = makeLogger(opts.logFile);

  try {
    if (usingBundled) log.out("  (using bundled resources)");

    log.out("");
    log.out(`Target:  ${targetDir}`);
    log.out(`Harness: ${harness} (${root})`);
    log.out("");

    const agentsDir = path.join(targetDir, root, "agents");
    const skillsDir = path.join(targetDir, root, "skills");
    const docsTarget = path.join(targetDir, "docs");

    const rewrite = harness === "agents" ? undefined : { from: ".agents/", to: `${root}/` };

    // --- Agents ---
    log.out(`Agents (${agentsDir}):`);
    const agentTemplates = fs.existsSync(path.join(templatesDir, "agents"))
      ? fs.readdirSync(path.join(templatesDir, "agents")).filter((f) => f.endsWith(".md"))
      : [];
    for (const agent of agentTemplates) {
      const dest = path.join(agentsDir, agent);
      if (fs.existsSync(dest) && !force) {
        const answer = await promptYesNo(`  Overwrite existing ${agent}?`, "n");
        if (answer === "n") continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let text = fs.readFileSync(path.join(templatesDir, "agents", agent), "utf8");
      if (rewrite) text = text.split(rewrite.from).join(rewrite.to);
      fs.writeFileSync(dest, text);
      log.ok(`Copied:  ${dest}`);
    }

    // --- Skills ---
    log.out("");
    log.out(`Skills (${skillsDir}):`);
    const skillDirs = fs.existsSync(path.join(templatesDir, "skills"))
      ? fs.readdirSync(path.join(templatesDir, "skills"), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort()
      : [];
    for (const skillName of skillDirs) {
      const srcDir = path.join(templatesDir, "skills", skillName);
      const destDir = path.join(skillsDir, skillName);
      if (fs.existsSync(destDir) && !force) {
        const answer = await promptYesNo(`  Overwrite existing skill directory '${skillName}'?`, "n");
        if (answer === "n") {
          log.out(`  Skipped: ${skillName}/`);
          continue;
        }
      }
      fs.rmSync(destDir, { recursive: true, force: true });
      copyTree(srcDir, destDir, rewrite);
      log.ok(`Copied:  ${skillName}/`);
    }

    // --- Prompt playbook ---
    log.out("");
    log.out(`Docs (${docsTarget}):`);
    const playbookSrc = path.join(docsDir, "prompt-playbook.md");
    if (fs.existsSync(playbookSrc)) {
      const dest = path.join(docsTarget, "prompt-playbook.md");
      if (fs.existsSync(dest) && !force) {
        const answer = await promptYesNo("  Overwrite existing prompt-playbook.md?", "n");
        if (answer !== "n") {
          fs.mkdirSync(docsTarget, { recursive: true });
          fs.copyFileSync(playbookSrc, dest);
          log.ok(`Copied:  ${dest}`);
        }
      } else {
        fs.mkdirSync(docsTarget, { recursive: true });
        fs.copyFileSync(playbookSrc, dest);
        log.ok(`Copied:  ${dest}`);
      }
    }

    // --- Gitignore hygiene ---
    log.out("");
    log.out(`Gitignore (${path.join(targetDir, ".gitignore")}):`);
    ensureGitignore(targetDir);

    log.out("");
    log.out("Bootstrap complete.");
    log.out(`Commit ${root}/agents/ (.md), ${root}/skills/, and docs/ to your repository.`);
    return 0;
  } finally {
    log.end();
  }
}

export async function bootstrapCli(args: string[]): Promise<number> {
  let targetDir = "";
  let harness: Harness = "agents";
  let force = false;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--force") force = true;
    else if (a === "--harness") {
      const v = args[++i];
      if (!v || !(v in HARNESS_ROOTS)) {
        throw new Error(`Error: Unknown harness '${v}'. Valid: agents, github, claude, opencode`);
      }
      harness = v as Harness;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option: ${a}`);
    } else if (!targetDir) {
      targetDir = a;
    }
  }
  if (!targetDir) {
    if (prompts.nonInteractive) {
      throw new Error("bootstrap: TARGET_DIR is required in non-interactive mode");
    }
    targetDir = await prompt("Target repository path [.]", ".");
  }
  return bootstrap({ targetDir: targetDir || ".", harness, force, nonInteractive: prompts.nonInteractive });
}
