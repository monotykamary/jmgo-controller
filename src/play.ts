import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Adb } from "./adb.js";
import { findExecutable, runProcess, type ProcessResult } from "./process.js";

export class PlayError extends Error {}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options?: { inherit?: boolean; allowFailure?: boolean },
) => Promise<ProcessResult>;

const digestPattern = /Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F:]+)/;
const packagePattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

export async function verifyApkSigners(
  files: string[],
  apksigner: string,
  runner: ProcessRunner = runProcess,
): Promise<string> {
  const digests = new Set<string>();
  for (const file of files) {
    const result = await runner(apksigner, ["verify", "--print-certs", file]);
    const match = digestPattern.exec(result.stdout.toString());
    if (!match?.[1]) throw new PlayError(`could not read signer certificate from ${file}`);
    digests.add(match[1].replaceAll(":", "").toLowerCase());
  }
  if (digests.size !== 1) {
    throw new PlayError("refusing installation: APK splits have different signing certificates");
  }
  return [...digests][0] as string;
}

async function findApks(directory: string, packageName: string): Promise<string[]> {
  const matches: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...(await findApks(path, packageName)));
    else if (entry.name.startsWith(`${packageName}-`) && entry.name.endsWith(".apk")) {
      matches.push(path);
    }
  }
  return matches.sort();
}

export async function installFromPlay(
  adb: Adb,
  packageName: string,
  options: {
    architecture?: string;
    languages?: string;
    keepDownloads?: string;
  } = {},
): Promise<{ output: string; signerSha256: string }> {
  if (!packagePattern.test(packageName)) throw new PlayError(`invalid package: ${packageName}`);
  const gplaydl = await findExecutable("gplaydl");
  if (!gplaydl) throw new PlayError("gplaydl was not found; install with: pipx install gplaydl");
  const apksigner = await findExecutable("apksigner");
  if (!apksigner) throw new PlayError("apksigner was not found; install Android SDK Build Tools");

  const temporary = !options.keepDownloads;
  const directory = options.keepDownloads
    ? resolve(options.keepDownloads)
    : await mkdtemp(join(tmpdir(), "jmgo-play-"));
  await mkdir(directory, { recursive: true });
  if (temporary) await chmod(directory, 0o700);

  try {
    const args = [
      "download",
      packageName,
      "--arch",
      options.architecture ?? "tv",
      "--output",
      directory,
      "--no-extras",
    ];
    if (options.languages) args.push("--languages", options.languages);
    await runProcess(gplaydl, args, { inherit: true });
    const files = await findApks(directory, packageName);
    if (files.length === 0) throw new PlayError("gplaydl produced no APK files");
    const signerSha256 = await verifyApkSigners(files, apksigner);
    const output = await adb.install(files);
    return { output, signerSha256 };
  } finally {
    if (temporary) await rm(directory, { recursive: true, force: true });
  }
}
