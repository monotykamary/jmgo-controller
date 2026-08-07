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

export async function loadSavedHost(path = configPath()): Promise<string | undefined> {
  try {
    const config = JSON.parse(await readFile(path, "utf8")) as { host?: unknown };
    return config.host === undefined ? undefined : validateHost(config.host);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new Error(`invalid JMGO config file: ${path}`, { cause: error });
    throw error;
  }
}

export async function saveHost(host: string, path = configPath()): Promise<void> {
  const validated = validateHost(host);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ host: validated }, null, 2)}\n`, {
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

export async function clearSavedHost(path = configPath()): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
