import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  clearSavedHost,
  clearSavedSunshineApp,
  loadSavedHost,
  loadSavedSunshineApp,
  saveHost,
  saveSunshineApp,
} from "../src/config.js";

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

test("saved Sunshine app lifecycle shares one private config file with the host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jmgo-config-test-"));
  const path = join(directory, "nested", "config.json");
  try {
    assert.equal(await loadSavedSunshineApp(path), undefined);
    await saveHost("192.168.1.50", path);
    await saveSunshineApp("Desktop", path);
    assert.equal(await loadSavedSunshineApp(path), "Desktop");
    assert.equal(await loadSavedHost(path), "192.168.1.50");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      host: "192.168.1.50",
      sunshineApp: "Desktop",
    });
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);

    await clearSavedSunshineApp(path);
    assert.equal(await loadSavedSunshineApp(path), undefined);
    assert.equal(await loadSavedHost(path), "192.168.1.50");

    await saveSunshineApp("  Steam Big Picture  ", path);
    assert.equal(await loadSavedSunshineApp(path), "Steam Big Picture");
    await clearSavedHost(path);
    assert.equal(await loadSavedHost(path), undefined);
    assert.equal(await loadSavedSunshineApp(path), "Steam Big Picture");

    await clearSavedSunshineApp(path);
    assert.equal(await loadSavedSunshineApp(path), undefined);
    await assert.rejects(stat(path), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved Sunshine app rejects invalid names", async () => {
  const unused = join(tmpdir(), "unused-jmgo-config");
  await assert.rejects(saveSunshineApp("   ", unused), /saved Sunshine app is invalid/);
  await assert.rejects(saveSunshineApp("bad\nname", unused), /saved Sunshine app is invalid/);
  await assert.rejects(saveSunshineApp(42 as unknown as string, unused), /saved Sunshine app is invalid/);
});
