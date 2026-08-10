import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { findExecutable, runProcess } from "./process.js";

export const ARTEMIS_PACKAGE = "com.limelight.noirdebug";
export const JMGO_SETTINGS_PACKAGE = "com.jmgo.setting.x";
const ARTEMIS_SHORTCUT_COMPONENT = `${ARTEMIS_PACKAGE}/com.limelight.ShortcutTrampoline`;
const JMGO_SUNSHINE_APPS = [
  "/Applications/Sunshine JMGO Media Clock.app",
  "/Applications/Sunshine JMGO.app",
] as const;

export type SunshineApp = {
  index: number;
  name: string;
};

export type Monitor = {
  id: string;
  name: string;
  primary: boolean;
  resolution?: string;
};

type SystemProfilerDisplay = {
  _name?: unknown;
  _spdisplays_displayID?: unknown;
  _spdisplays_pixels?: unknown;
  _spdisplays_resolution?: unknown;
  spdisplays_main?: unknown;
  spdisplays_online?: unknown;
};

type SystemProfilerGpu = {
  spdisplays_ndrvs?: unknown;
};

type SystemProfilerOutput = {
  SPDisplaysDataType?: unknown;
};

export class ArtemisError extends Error {}

export function parseSystemProfilerDisplays(output: string): Monitor[] {
  let parsed: SystemProfilerOutput;
  try {
    parsed = JSON.parse(output) as SystemProfilerOutput;
  } catch (error) {
    throw new ArtemisError("system_profiler returned invalid JSON", { cause: error });
  }

  if (!Array.isArray(parsed.SPDisplaysDataType)) {
    throw new ArtemisError("system_profiler did not return display data");
  }

  const monitors: Monitor[] = [];
  for (const gpuValue of parsed.SPDisplaysDataType) {
    const gpu = gpuValue as SystemProfilerGpu;
    if (!Array.isArray(gpu.spdisplays_ndrvs)) continue;
    for (const displayValue of gpu.spdisplays_ndrvs) {
      const display = displayValue as SystemProfilerDisplay;
      if (display.spdisplays_online !== undefined && display.spdisplays_online !== "spdisplays_yes") {
        continue;
      }
      if (
        typeof display._spdisplays_displayID !== "string" ||
        !/^\d+$/.test(display._spdisplays_displayID)
      ) {
        continue;
      }
      const name =
        typeof display._name === "string" && display._name.length > 0
          ? display._name
          : `Display ${display._spdisplays_displayID}`;
      const resolution =
        typeof display._spdisplays_pixels === "string"
          ? display._spdisplays_pixels
          : typeof display._spdisplays_resolution === "string"
            ? display._spdisplays_resolution
            : undefined;
      monitors.push({
        id: display._spdisplays_displayID,
        name,
        primary: display.spdisplays_main === "spdisplays_yes",
        ...(resolution ? { resolution } : {}),
      });
    }
  }

  if (monitors.length === 0) throw new ArtemisError("no active macOS monitors found");
  return monitors;
}

export async function listMonitors(): Promise<Monitor[]> {
  if (process.platform !== "darwin") {
    throw new ArtemisError("monitor discovery currently requires macOS");
  }
  const executable = await findExecutable("system_profiler");
  if (!executable) throw new ArtemisError("system_profiler was not found");
  const result = await runProcess(executable, ["SPDisplaysDataType", "-json"]);
  return parseSystemProfilerDisplays(result.stdout.toString());
}

export function resolveMonitor(monitors: readonly Monitor[], selector: string): Monitor {
  if (selector.toLowerCase() === "primary") {
    const primary = monitors.find((monitor) => monitor.primary);
    if (!primary) throw new ArtemisError("no primary monitor was reported");
    return primary;
  }

  const byId = monitors.find((monitor) => monitor.id === selector);
  if (byId) return byId;

  const byName = monitors.filter(
    (monitor) => monitor.name.toLowerCase() === selector.toLowerCase(),
  );
  if (byName.length === 1) return byName[0] as Monitor;
  if (byName.length > 1) {
    throw new ArtemisError(`monitor name is ambiguous: ${selector}; use its numeric ID`);
  }
  throw new ArtemisError(
    `unknown monitor: ${selector}; available IDs: ${monitors.map((monitor) => monitor.id).join(", ")}`,
  );
}

export function parseSunshineApps(output: string): SunshineApp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new ArtemisError("Sunshine returned invalid apps JSON", { cause: error });
  }

  const entries =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { apps?: unknown }).apps
      : parsed;
  if (!Array.isArray(entries)) throw new ArtemisError("Sunshine apps JSON has no apps array");

  const apps: SunshineApp[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || name.trim().length === 0) continue;
    apps.push({ index: apps.length + 1, name: name.trim() });
  }
  if (apps.length === 0) throw new ArtemisError("no Sunshine applications are configured");
  const duplicate = apps.find(
    (app, index) =>
      apps.findIndex((candidate) => candidate.name.toLowerCase() === app.name.toLowerCase()) !== index,
  );
  if (duplicate) {
    throw new ArtemisError(`duplicate Sunshine app name: ${duplicate.name}; rename one entry`);
  }
  return apps;
}

export function resolveSunshineApp(
  apps: readonly SunshineApp[],
  selector: string,
): SunshineApp {
  const normalized = selector.trim().toLowerCase();
  const byName = apps.filter((app) => app.name.toLowerCase() === normalized);
  if (byName.length === 1) return byName[0] as SunshineApp;
  if (byName.length > 1) {
    throw new ArtemisError(`Sunshine app name is ambiguous: ${selector}; rename duplicate entries`);
  }

  if (/^[1-9]\d*$/.test(selector.trim())) {
    const byIndex = apps.find((app) => app.index === Number(selector));
    if (byIndex) return byIndex;
  }
  throw new ArtemisError(
    `unknown Sunshine app: ${selector}; available indexes: ${apps.map((app) => app.index).join(", ")}`,
  );
}

export function sunshineAppsPath(): string {
  if (process.env.SUNSHINE_APPS_FILE) return process.env.SUNSHINE_APPS_FILE;
  return join(homedir(), ".config", "sunshine", "apps.json");
}

export async function listSunshineApps(path = sunshineAppsPath()): Promise<SunshineApp[]> {
  try {
    return parseSunshineApps(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ArtemisError("Sunshine apps.json was not found; configure Sunshine applications first");
    }
    throw error;
  }
}

export async function readSunshineHostName(
  path = sunshineConfigPath(),
  fallback = hostname(),
): Promise<string> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  const matches = [...contents.matchAll(/^\s*sunshine_name\s*=\s*(.*?)\s*$/gm)];
  let configured = matches.at(-1)?.[1]?.trim();
  if (
    configured &&
    configured.length >= 2 &&
    ((configured.startsWith('"') && configured.endsWith('"')) ||
      (configured.startsWith("'") && configured.endsWith("'")))
  ) {
    configured = configured.slice(1, -1).trim();
  }
  return configured || fallback;
}

function quoteAndroidShellArgument(value: string, label: string): string {
  if (value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ArtemisError(`${label} contains unsupported characters`);
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function buildArtemisAppLaunchCommand(appName: string, computerName: string): string {
  return [
    "am start -n",
    quoteAndroidShellArgument(ARTEMIS_SHORTCUT_COMPONENT, "Artemis component"),
    "--es Name",
    quoteAndroidShellArgument(computerName, "Sunshine host name"),
    "--es AppName",
    quoteAndroidShellArgument(appName, "Sunshine app name"),
  ].join(" ");
}

export function sunshineConfigPath(): string {
  if (process.env.SUNSHINE_CONFIG_FILE) return process.env.SUNSHINE_CONFIG_FILE;
  return join(homedir(), ".config", "sunshine", "sunshine.conf");
}

function updateSunshineConfigValue(contents: string, key: string, value: string): string {
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  const output: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (pattern.test(line)) {
      if (!replaced) output.push(`${key} = ${value}`);
      replaced = true;
    } else if (line.length > 0 || output.length > 0) {
      output.push(line);
    }
  }
  if (!replaced) {
    while (output.at(-1) === "") output.pop();
    output.push(`${key} = ${value}`);
  }
  while (output.at(-1) === "") output.pop();
  return `${output.join("\n")}\n`;
}

export function updateSunshineMonitorConfig(contents: string, monitorId: string): string {
  if (!/^\d+$/.test(monitorId)) throw new ArtemisError(`invalid monitor ID: ${monitorId}`);
  return updateSunshineConfigValue(contents, "output_name", monitorId);
}

export function updateSunshineMinimumFpsConfig(contents: string, fps: number): string {
  if (!Number.isInteger(fps) || fps < 0 || fps > 240) {
    throw new ArtemisError(`invalid Sunshine minimum FPS: ${fps}`);
  }
  return updateSunshineConfigValue(contents, "minimum_fps_target", String(fps));
}

export async function readSunshineMonitor(path = sunshineConfigPath()): Promise<string | undefined> {
  try {
    const contents = await readFile(path, "utf8");
    const matches = [...contents.matchAll(/^\s*output_name\s*=\s*(\S+)\s*$/gm)];
    return matches.at(-1)?.[1];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function saveSunshineConfig(
  update: (contents: string) => string,
  path: string,
): Promise<void> {
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, update(contents), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function saveSunshineMonitor(
  monitorId: string,
  path = sunshineConfigPath(),
): Promise<void> {
  await saveSunshineConfig((contents) => updateSunshineMonitorConfig(contents, monitorId), path);
}

export async function saveSunshineMinimumFps(
  fps: number,
  path = sunshineConfigPath(),
): Promise<void> {
  await saveSunshineConfig((contents) => updateSunshineMinimumFpsConfig(contents, fps), path);
}

async function sunshineRunning(pgrep: string): Promise<boolean> {
  const result = await runProcess(pgrep, ["-x", "Sunshine"], { allowFailure: true });
  return result.code === 0;
}

export async function sunshineApplicationTarget(
  configured = process.env.JMGO_SUNSHINE_APP?.trim(),
  candidates: readonly string[] = JMGO_SUNSHINE_APPS,
): Promise<string> {
  if (configured) return configured;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next compatible side-by-side installation.
    }
  }
  return "Sunshine";
}

export function sunshineOpenArgs(application: string): string[] {
  return application.includes("/") ? ["-n", application] : ["-a", application];
}

export async function restartSunshine(timeoutMs = 8_000): Promise<void> {
  if (process.platform !== "darwin") {
    throw new ArtemisError("automatic Sunshine restart currently requires macOS; use --no-restart");
  }
  const [open, pgrep, pkill, application] = await Promise.all([
    findExecutable("open"),
    findExecutable("pgrep"),
    findExecutable("pkill"),
    sunshineApplicationTarget(),
  ]);
  if (!open || !pgrep || !pkill) {
    throw new ArtemisError("open, pgrep, and pkill are required to restart Sunshine");
  }

  await runProcess(pkill, ["-TERM", "-x", "Sunshine"], { allowFailure: true });
  let deadline = Date.now() + timeoutMs;
  while ((await sunshineRunning(pgrep)) && Date.now() < deadline) await delay(100);
  if (await sunshineRunning(pgrep)) throw new ArtemisError("Sunshine did not stop in time");

  await runProcess(open, sunshineOpenArgs(application));
  deadline = Date.now() + timeoutMs;
  while (!(await sunshineRunning(pgrep)) && Date.now() < deadline) await delay(100);
  if (!(await sunshineRunning(pgrep))) throw new ArtemisError("Sunshine did not start in time");
  await delay(3_000);
}
