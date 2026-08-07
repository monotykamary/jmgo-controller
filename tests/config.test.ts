import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clearSavedHost, loadSavedHost, saveHost } from "../src/config.js";

test("saved host lifecycle uses a private config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-config-test-"));
  const path = join(directory, "nested", "config.json");
  try {
    assert.equal(await loadSavedHost(path), undefined);
    await saveHost("192.168.1.50", path);
    assert.equal(await loadSavedHost(path), "192.168.1.50");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { host: "192.168.1.50" });
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    await clearSavedHost(path);
    assert.equal(await loadSavedHost(path), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved host rejects whitespace", async () => {
  await assert.rejects(saveHost("not a host", join(tmpdir(), "unused-jmgo-config")));
});
