import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayError, verifyApkSigners, type ProcessRunner } from "../src/play.js";

function runnerFor(digests: string[]): ProcessRunner {
  let index = 0;
  return async () => {
    const digest = digests[index++];
    const prefix = index % 2 === 0 ? "V3.0 Signer:" : "Signer #1";
    return {
      code: 0,
      stderr: Buffer.alloc(0),
      stdout: Buffer.from(`${prefix} certificate SHA-256 digest: ${digest}`),
    };
  };
}

test("matching split signers are accepted", async () => {
  assert.equal(
    await verifyApkSigners(["base.apk", "split.apk"], "apksigner", runnerFor(["aa:bb", "AABB"])),
    "aabb",
  );
});

test("mismatched split signers are rejected", async () => {
  await assert.rejects(
    verifyApkSigners(["base.apk", "split.apk"], "apksigner", runnerFor(["aaaa", "bbbb"])),
    PlayError,
  );
});
