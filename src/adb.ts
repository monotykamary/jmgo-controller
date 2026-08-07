import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { findExecutable, runProcess } from "./process.js";

export class AdbError extends Error {}

const packagePattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

function assertPackageName(packageName: string): void {
  if (!packagePattern.test(packageName)) throw new AdbError(`invalid package: ${packageName}`);
}

export class Adb {
  readonly serial: string;

  private constructor(
    readonly host: string,
    readonly executable: string,
    readonly port = 5555,
  ) {
    this.serial = `${host}:${port}`;
  }

  static async create(host: string, port = 5555): Promise<Adb> {
    const executable = await findExecutable("adb");
    if (!executable) {
      throw new AdbError(
        "adb was not found; install Android Platform Tools " +
          "(macOS: brew install --cask android-platform-tools)",
      );
    }
    return new Adb(host, executable, port);
  }

  private async run(args: string[]): Promise<string> {
    const result = await runProcess(this.executable, ["-s", this.serial, ...args]);
    return result.stdout.toString().trim();
  }

  async connect(): Promise<void> {
    const result = await runProcess(this.executable, ["connect", this.serial], {
      allowFailure: true,
    });
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (result.code !== 0 || output.includes("unable") || output.includes("failed")) {
      throw new AdbError(output.trim());
    }
  }

  async shell(command: string): Promise<string> {
    await this.connect();
    return this.run(["shell", command]);
  }

  async info(): Promise<Record<string, string>> {
    const properties = [
      ["model", "ro.product.model"],
      ["android", "ro.build.version.release"],
      ["sdk", "ro.build.version.sdk"],
      ["abis", "ro.product.cpu.abilist"],
    ] as const;
    return Object.fromEntries(
      await Promise.all(
        properties.map(async ([name, property]) => [name, await this.shell(`getprop ${property}`)]),
      ),
    );
  }

  currentApp(): Promise<string> {
    return this.shell("dumpsys activity activities | grep -m 1 mResumedActivity");
  }

  audio(): Promise<string> {
    return this.shell("dumpsys audio | grep -E -m 8 'STREAM_MUSIC|Current:|Devices:'");
  }

  async packages(query?: string): Promise<string[]> {
    const packages = (await this.shell("pm list packages"))
      .split("\n")
      .map((line) => line.replace(/^package:/, ""))
      .filter(Boolean);
    const filtered = query
      ? packages.filter((name) => name.toLowerCase().includes(query.toLowerCase()))
      : packages;
    return filtered.sort();
  }

  async install(files: string[], replaceExisting = true): Promise<string> {
    if (files.length === 0) throw new AdbError("at least one APK is required");
    for (const file of files) await access(file);
    await this.connect();
    const command = files.length > 1 ? "install-multiple" : "install";
    return this.run([command, ...(replaceExisting ? ["-r"] : []), ...files.map((file) => resolve(file))]);
  }

  async uninstall(packageName: string, keepData = false): Promise<string> {
    assertPackageName(packageName);
    await this.connect();
    return this.run(["uninstall", ...(keepData ? ["-k"] : []), packageName]);
  }

  launch(packageName: string): Promise<string> {
    assertPackageName(packageName);
    return this.shell(`monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
  }

  async screenshot(destination: string): Promise<string> {
    await this.connect();
    const output = resolve(destination);
    await mkdir(resolve(output, ".."), { recursive: true });
    const result = await runProcess(this.executable, [
      "-s",
      this.serial,
      "exec-out",
      "screencap",
      "-p",
    ]);
    await writeFile(output, result.stdout);
    return output;
  }
}
