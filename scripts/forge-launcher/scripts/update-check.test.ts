import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cacheFresh,
  checkForUpdate,
  currentVersion,
  distTagFor,
  isNewer,
  readCache,
  registryUrl,
  shouldCheck,
  writeCache,
  type UpdateCache,
} from "./update-check.ts";

async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function tmpCacheFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fl-updcheck-")), "update-check.json");
}

function mockFetcher(version: string | null, error = false): typeof fetch {
  return (async () => {
    if (error) throw new Error("offline");
    return {
      ok: version !== null,
      json: async () => (version === null ? {} : { version }),
    } as Response;
  }) as unknown as typeof fetch;
}

function countingFetcher(counter: { calls: number }): typeof fetch {
  return (async () => {
    counter.calls += 1;
    throw new Error("should not fetch");
  }) as unknown as typeof fetch;
}

test("distTagFor picks beta for prereleases and latest for releases", async () => {
  await withEnv({ FORGE_UPDATE_CHECK_TAG: undefined }, () => {
    assert.equal(distTagFor("1.0.0-beta.2"), "beta");
    assert.equal(distTagFor("1.0.0"), "latest");
  });
});

test("distTagFor honors FORGE_UPDATE_CHECK_TAG", async () => {
  await withEnv({ FORGE_UPDATE_CHECK_TAG: "next" }, () => {
    assert.equal(distTagFor("1.0.0"), "next");
  });
});

test("isNewer orders semver including prereleases", () => {
  assert.equal(isNewer("1.0.0-beta.2", "1.0.0-beta.3"), true);
  assert.equal(isNewer("1.0.0-beta.2", "1.0.0"), true);
  assert.equal(isNewer("1.0.0", "1.0.0-beta.2"), false);
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "0.9.9"), false);
  assert.equal(isNewer("garbage", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "garbage"), false);
});

test("registryUrl uses the configured registry and strips a trailing slash", async () => {
  await withEnv({ npm_config_registry: undefined }, () => {
    assert.equal(registryUrl("beta"), "https://registry.npmjs.org/forge-launcher/beta");
  });
  await withEnv({ npm_config_registry: "http://localhost:4873/" }, () => {
    assert.equal(registryUrl("beta"), "http://localhost:4873/forge-launcher/beta");
  });
});

test("cacheFresh is true within the TTL and false after", () => {
  const now = Date.now();
  const fresh: UpdateCache = { checkedAt: new Date(now - 60_000).toISOString(), latest: "1.0.0" };
  const stale: UpdateCache = {
    checkedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    latest: "1.0.0",
  };
  assert.equal(cacheFresh(fresh, now), true);
  assert.equal(cacheFresh(stale, now), false);
  assert.equal(cacheFresh(null, now), false);
  assert.equal(cacheFresh({ checkedAt: "not-a-date", latest: "1.0.0" }, now), false);
});

test("shouldCheck respects env and CI", async () => {
  await withEnv({ FORGE_SKIP_UPDATE_CHECK: undefined, CI: undefined }, () => {
    assert.equal(shouldCheck(), true);
  });
  await withEnv({ FORGE_SKIP_UPDATE_CHECK: "1", CI: undefined }, () => {
    assert.equal(shouldCheck(), false);
  });
  await withEnv({ FORGE_SKIP_UPDATE_CHECK: undefined, CI: "true" }, () => {
    assert.equal(shouldCheck(), false);
  });
});

test("checkForUpdate reports a newer version and caches it", async () => {
  await withEnv({ FORGE_SKIP_UPDATE_CHECK: undefined, CI: undefined }, async () => {
    const file = tmpCacheFile();
    const info = await checkForUpdate({ fetcher: mockFetcher("9.9.9"), cacheFile: file });
    assert.ok(info);
    assert.equal(info!.latest, "9.9.9");
    assert.equal(info!.current, currentVersion());
    assert.equal(info!.tag, "beta");
    assert.equal(readCache(file)?.latest, "9.9.9");
  });
});

test("checkForUpdate returns null on 404 and offline, and caches up-to-date results", async () => {
  await withEnv({ FORGE_SKIP_UPDATE_CHECK: undefined, CI: undefined }, async () => {
    assert.equal(await checkForUpdate({ fetcher: mockFetcher(null), cacheFile: tmpCacheFile() }), null);
    assert.equal(await checkForUpdate({ fetcher: mockFetcher(null, true), cacheFile: tmpCacheFile() }), null);

    const file = tmpCacheFile();
    const info = await checkForUpdate({ fetcher: mockFetcher(currentVersion()), cacheFile: file });
    assert.equal(info, null);
    assert.equal(readCache(file)?.latest, currentVersion());
  });
});

test("checkForUpdate skips when skip is set", async () => {
  const counter = { calls: 0 };
  const info = await checkForUpdate({ skip: true, fetcher: countingFetcher(counter), cacheFile: tmpCacheFile() });
  assert.equal(info, null);
  assert.equal(counter.calls, 0);
});

test("checkForUpdate honors a fresh cache without hitting the network", async () => {
  const file = tmpCacheFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ checkedAt: new Date().toISOString(), latest: "9.9.9" }),
  );
  const counter = { calls: 0 };
  const info = await checkForUpdate({ fetcher: countingFetcher(counter), cacheFile: file });
  assert.ok(info);
  assert.equal(info!.latest, "9.9.9");
  assert.equal(counter.calls, 0);
});

test("checkForUpdate returns null from a fresh cache when up to date", async () => {
  const file = tmpCacheFile();
  fs.writeFileSync(
    file,
    JSON.stringify({ checkedAt: new Date().toISOString(), latest: currentVersion() }),
  );
  const counter = { calls: 0 };
  const info = await checkForUpdate({ fetcher: countingFetcher(counter), cacheFile: file });
  assert.equal(info, null);
  assert.equal(counter.calls, 0);
});
