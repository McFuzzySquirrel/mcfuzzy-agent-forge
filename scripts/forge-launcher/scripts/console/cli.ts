import { startConsoleServer } from "./server.ts";

const USAGE = `forge-launcher console - Forge Console (local web UI)

Usage:
  forge-launcher console [--repo <path>] [--port <n>] [--external-origin <https-origin>] [--no-open]

Options:
  --repo <path>   Open this forge repo (default: none; shows the project picker).
  --port <n>      Preferred port (default: 4300; next free port is used if busy).
  --external-origin <url>
                  HTTPS origin exposed by a trusted reverse proxy (for example Tailscale Serve).
  --no-open       Do not auto-open the browser.
`;

export async function consoleCli(args: string[]): Promise<number> {
  let repo: string | undefined;
  let port: number | undefined;
  let externalOrigin: string | undefined;
  let noOpen = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--repo") repo = args[++i];
    else if (a === "--port") port = Number(args[++i]);
    else if (a === "--external-origin") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--external-origin requires an HTTPS origin.");
      externalOrigin = value;
    }
    else if (a === "--no-open") noOpen = true;
    else if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE);
      return 0;
    }
  }

  const server = await startConsoleServer({
    repoRoot: repo,
    port: port && Number.isInteger(port) && port > 0 ? port : undefined,
    externalOrigin,
    open: !noOpen,
    allowExternalOpen: true,
  });

  console.log(`Forge Console: ${server.externalUrl ?? server.url}  (Ctrl+C to stop)`);
  await new Promise<void>(() => {
    process.on("SIGINT", () => {
      server.stop().then(() => process.exit(0));
    });
  });
  return 0;
}
