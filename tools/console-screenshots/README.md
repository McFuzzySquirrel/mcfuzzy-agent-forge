# console-screenshots

Developer tool that regenerates the Forge Console screenshots and the
[visual tour](../../docs/forge-console-screenshots.md) from a deterministic
fixture. It is not published or part of any package build.

It:

1. builds the launcher (`dist/cli.js` + `resources/console/client`),
2. writes a fixed fixture repository under `/tmp/ledgerly` with a seeded
   `FORGE_HOME` project registry,
3. starts `forge-launcher console` against that fixture,
4. drives the installed Chrome with `puppeteer-core`,
5. writes the responsive captures, the numbered tour images, 640px thumbnails,
   and the walkthrough GIF.

No model or external authoring runs: every timestamp and artifact in the fixture
is fixed, so captures are stable across runs.

## Usage

```bash
npm install     # first time; installs puppeteer-core (no bundled browser download)
npm run capture # builds the launcher, then captures
npm run capture -- --headed   # watch the run (useful if headless WebGL is blank)
npm run typecheck
```

## Requirements

- `google-chrome` on `PATH`, or `CHROME_PATH` pointing at a Chrome/Chromium binary.
- `ffmpeg` on `PATH` (thumbnails and the GIF).
- Node 18+.

## What it writes

| Output | Location |
| --- | --- |
| Responsive captures | `docs/images/forge-console/current/*.png` |
| Walkthrough GIF | `docs/images/forge-console/current/console-walkthrough.gif` |
| Numbered tour images | `docs/images/forge-console/01..14-*.png` |
| Thumbnails (640px) | `docs/images/forge-console/thumb/*.png` |

## Notes

- Chrome is driven with `--enable-unsafe-swiftshader` so the PixiJS **Board**
  renders under headless. If it ever comes out blank, re-run with `--headed`.
- The **Overview** capture is full-page (viewport resized to the content height)
  so the **Controls** panel, including the **Log harness activity** toggle, is
  visible.
- The `tools/console-screenshots/` source is not covered by the launcher's
  `tsconfig`, so `puppeteer-core` never ships in `dist`.
