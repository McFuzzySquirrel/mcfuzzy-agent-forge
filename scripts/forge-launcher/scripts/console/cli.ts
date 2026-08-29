import { startConsoleServer } from "./server.ts";

const USAGE = `forge-launcher console - Forge Console (local web UI)

Usage:
  forge-launcher console [--repo <path>] [--port <n>] [--no-open]

Options:
  --repo <path>   Open this forge repo (default: none; shows the project picker).
  --port <n>      Preferred port (default: 4300; next free port is used if busy).
  --no-open       Do not auto-open the browser.
`;

export async function consoleCli(args: string[]): Promise<number> {
  let repo: string | undefined;
  let port: number | undefined;
  let noOpen = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--repo") repo = args[++i];
    else if (a === "--port") port = Number(args[++i]);
    else if (a === "--no-open") noOpen = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      return 0;
    }
  }

  const server = await startConsoleServer({
    repoRoot: repo,
    port: port && Number.isInteger(port) && port > 0 ? port : undefined,
    open: !noOpen,
    allowExternalOpen: true,
  });

  console.log(`Forge Console: ${server.url}  (Ctrl+C to stop)`);
  await new Promise<void>(() => {
    process.on("SIGINT", () => {
      server.stop().then(() => process.exit(0));
    });
  });
  return 0;
}
