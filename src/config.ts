import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export function configPath(): string {
  if (process.env.JMGO_CONFIG_FILE) return process.env.JMGO_CONFIG_FILE;
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "jmgo-controller", "config.json");
}

function validateHost(host: unknown): string {
  if (typeof host !== "string" || host.length === 0 || /\s/.test(host)) {
    throw new Error("saved projector host is invalid");
  }
  return host;
}

function validateSunshineApp(app: unknown): string {
  if (typeof app !== "string" || app.trim().length === 0 || /[\u0000-\u001f\u007f]/.test(app)) {
    throw new Error("saved Sunshine app is invalid");
  }
  return app.trim();
}

async function loadConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error(`invalid JMGO config file: ${path}`, { cause: error });
    throw error;
  }
}

async function writeConfig(config: Record<string, unknown>, path: string): Promise<void> {
  if (Object.keys(config).length === 0) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
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

async function setConfigKey(key: string, value: string, path: string): Promise<void> {
  await writeConfig({ ...(await loadConfig(path)), [key]: value }, path);
}

async function clearConfigKey(key: string, path: string): Promise<void> {
  const config = await loadConfig(path);
  delete config[key];
  await writeConfig(config, path);
}

export async function loadSavedHost(path = configPath()): Promise<string | undefined> {
  const host = (await loadConfig(path)).host;
  return host === undefined ? undefined : validateHost(host);
}

export async function saveHost(host: string, path = configPath()): Promise<void> {
  await setConfigKey("host", validateHost(host), path);
}

export async function clearSavedHost(path = configPath()): Promise<void> {
  await clearConfigKey("host", path);
}

export async function loadSavedSunshineApp(path = configPath()): Promise<string | undefined> {
  const app = (await loadConfig(path)).sunshineApp;
  return app === undefined ? undefined : validateSunshineApp(app);
}

export async function saveSunshineApp(app: string, path = configPath()): Promise<void> {
  await setConfigKey("sunshineApp", validateSunshineApp(app), path);
}

export async function clearSavedSunshineApp(path = configPath()): Promise<void> {
  await clearConfigKey("sunshineApp", path);
}
