import { createConnection, type Socket } from "node:net";
import {
  decodeState,
  frame,
  keyPacket,
  redactState,
  sanitizeState,
  setVolumePacket,
  splitFrames,
  type ProjectorState,
} from "./protocol.js";

export const keyCodes = {
  back: 4,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  ok: 23,
  "volume-up": 24,
  "volume-down": 25,
  menu: 82,
  settings: 605,
  home: 706,
  power: 707,
  "power-menu": 2011,
} as const;

export type RemoteKey = keyof typeof keyCodes;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class Remote {
  constructor(
    readonly host: string,
    readonly port = 9005,
    readonly timeoutMs = 3_000,
  ) {}

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const onError = (error: Error) => reject(error);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error("connection timed out")));
    });
  }

  async press(key: RemoteKey): Promise<void> {
    const socket = await this.connect();
    try {
      socket.write(keyPacket(keyCodes[key], true));
      await delay(120);
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.end(keyPacket(keyCodes[key], false), resolve);
      });
    } finally {
      socket.destroy();
    }
  }

  async setVolume(volume: number): Promise<void> {
    const socket = await this.connect();
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.end(setVolumePacket(volume), resolve);
    });
  }

  async readState(waitMs = 1_000, includeIdentifiers = false): Promise<ProjectorState> {
    const socket = await this.connect();
    const chunks: Buffer[] = [];
    const data = await new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(Buffer.concat(chunks));
      };
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.once("end", finish);
      socket.once("error", reject);
      socket.setTimeout(waitMs, finish);
    });
    const state = decodeState(data);
    return (includeIdentifiers ? sanitizeState(state) : redactState(state)) as ProjectorState;
  }

  async *watch(includeIdentifiers = false): AsyncGenerator<ProjectorState> {
    const socket = await this.connect();
    socket.setTimeout(0);
    let buffer = Buffer.alloc(0);
    try {
      for await (const chunk of socket) {
        buffer = Buffer.concat([buffer, chunk as Buffer]);
        const split = splitFrames(buffer);
        buffer = Buffer.from(split.remainder);
        for (const payload of split.frames) {
          const framed = frame(payload);
          const state = decodeState(framed);
          yield (includeIdentifiers ? sanitizeState(state) : redactState(state)) as ProjectorState;
        }
      }
    } finally {
      socket.destroy();
    }
  }
}
