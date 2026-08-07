import { networkInterfaces } from "node:os";
import { createConnection } from "node:net";

function localIpv4(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  throw new Error("could not determine a local IPv4 address");
}

function ipv4ToNumber(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`invalid IPv4 address: ${address}`);
  }
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0;
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function networkHosts(cidr?: string): string[] {
  const target = cidr ?? `${localIpv4()}/24`;
  const [address, prefixText] = target.split("/");
  if (!address || !prefixText) throw new Error(`invalid CIDR: ${target}`);
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 20 || prefix > 30) {
    throw new Error("network prefix must be between /20 and /30");
  }
  const ip = ipv4ToNumber(address);
  const size = 2 ** (32 - prefix);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const base = (ip & mask) >>> 0;
  return Array.from({ length: size - 2 }, (_, index) => numberToIpv4(base + index + 1));
}

function hasPort(host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: 9005 });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export async function discover(cidr?: string, timeoutMs = 200): Promise<string[]> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeout must be positive");
  const hosts = networkHosts(cidr);
  const found: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++];
      if (host && (await hasPort(host, timeoutMs))) found.push(host);
    }
  };
  await Promise.all(Array.from({ length: Math.min(64, hosts.length) }, worker));
  return found.sort((left, right) => ipv4ToNumber(left) - ipv4ToNumber(right));
}
