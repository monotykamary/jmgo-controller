import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const ignoredDirectories = new Set([".git", ".pi", ".test-dist", "dist", "node_modules"]);
const blockedExtensions = new Set([
  ".aab",
  ".apk",
  ".apkm",
  ".apks",
  ".jpeg",
  ".jpg",
  ".jks",
  ".keystore",
  ".obb",
  ".p12",
  ".png",
  ".xapk",
]);
const blockedNames = [
  /^\.env(?:\.|$)/,
  /^auth-.*\.json$/,
  /^config\.json$/,
  /^sunshine\.conf$/,
  /^sunshine_state\.json$/,
];
const blockedText = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?[^\s"'${}<>]{8,}/i,
  /(?:ghp|github_pat|sk_live|AIza)[A-Za-z0-9_-]{16,}/,
  /(?:uniqueid|serial(?:Number)?)=[A-Za-z0-9_-]{8,}/i,
];

const failures = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    const name = entry.name;
    const display = relative(root.pathname, path);
    if (blockedExtensions.has(extname(name).toLowerCase()) || blockedNames.some((pattern) => pattern.test(name))) {
      failures.push(`${display}: blocked artifact type`);
      continue;
    }
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    for (const pattern of blockedText) {
      if (pattern.test(text)) failures.push(`${display}: matches sensitive-data pattern ${pattern.source}`);
    }
  }
}

await visit(root.pathname);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("sensitive-data check passed");
}
