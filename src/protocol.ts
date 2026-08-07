export class ProtocolError extends Error {}

export type ProjectorState = Record<string, unknown>;

type ProtobufField = {
  number: number;
  wireType: number;
  value: number | Buffer;
};

export function encodeVarint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("varints must be non-negative safe integers");
  }
  const output: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    output.push(byte);
  } while (value > 0);
  return Buffer.from(output);
}

export function decodeVarint(data: Buffer, start = 0): [number, number] {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  while (offset < data.length && multiplier <= 2 ** 63) {
    const byte = data[offset++];
    if (byte === undefined) break;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new ProtocolError("varint exceeds safe integer range");
      return [value, offset];
    }
    multiplier *= 128;
  }
  throw new ProtocolError("invalid or incomplete varint");
}

export function fieldVarint(number: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(number << 3), encodeVarint(value)]);
}

export function fieldBytes(number: number, value: Buffer): Buffer {
  return Buffer.concat([encodeVarint((number << 3) | 2), encodeVarint(value.length), value]);
}

export function frame(payload: Buffer): Buffer {
  return Buffer.concat([encodeVarint(payload.length), payload]);
}

export function keyPacket(keycode: number, pressed: boolean): Buffer {
  const event = Buffer.concat([fieldVarint(1, keycode), fieldVarint(2, Number(pressed))]);
  return frame(fieldBytes(2, fieldBytes(1, event)));
}

export function setVolumePacket(volume: number): Buffer {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw new RangeError("volume must be an integer between 0 and 100");
  }
  const request = Buffer.from(JSON.stringify({ req: "setVolume", param: String(volume) }));
  const requestInfo = Buffer.concat([
    fieldBytes(1, Buffer.from("reqestinfo")),
    fieldBytes(2, request),
  ]);
  return frame(fieldBytes(2, fieldBytes(4, requestInfo)));
}

export function splitFrames(data: Buffer): { frames: Buffer[]; remainder: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    let length: number;
    let payloadStart: number;
    try {
      [length, payloadStart] = decodeVarint(data, offset);
    } catch (error) {
      if (error instanceof ProtocolError) break;
      throw error;
    }
    const payloadEnd = payloadStart + length;
    if (payloadEnd > data.length) break;
    frames.push(data.subarray(payloadStart, payloadEnd));
    offset = payloadEnd;
  }
  return { frames, remainder: data.subarray(offset) };
}

function parseFields(data: Buffer): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < data.length) {
    const [tag, afterTag] = decodeVarint(data, offset);
    offset = afterTag;
    const number = tag >> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      const [value, next] = decodeVarint(data, offset);
      fields.push({ number, wireType, value });
      offset = next;
    } else if (wireType === 2) {
      const [length, contentStart] = decodeVarint(data, offset);
      const end = contentStart + length;
      if (end > data.length) throw new ProtocolError("incomplete length-delimited field");
      fields.push({ number, wireType, value: data.subarray(contentStart, end) });
      offset = end;
    } else {
      throw new ProtocolError(`unsupported protobuf wire type ${wireType}`);
    }
  }
  return fields;
}

function bytesField(data: Buffer, number: number): Buffer {
  const field = parseFields(data).find(
    (candidate) => candidate.number === number && candidate.wireType === 2,
  );
  if (!field || !Buffer.isBuffer(field.value)) throw new ProtocolError(`missing field ${number}`);
  return field.value;
}

export function decodeStateFrame(payload: Buffer): [string, unknown] {
  const envelope = bytesField(payload, 3);
  const entry = bytesField(envelope, 1);
  const key = bytesField(entry, 1).toString("utf8");
  const rawValue = bytesField(entry, 2).toString("utf8");
  return [key, key === "sysconfig" ? JSON.parse(rawValue) : rawValue];
}

export function decodeState(data: Buffer): ProjectorState {
  const state: ProjectorState = {};
  for (const payload of splitFrames(data).frames) {
    try {
      const [key, value] = decodeStateFrame(payload);
      state[key] = value;
    } catch (error) {
      if (!(error instanceof ProtocolError) && !(error instanceof SyntaxError)) throw error;
    }
  }
  return state;
}

export function sanitizeState(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\p{Cf}/gu, "");
  if (Array.isArray(value)) return value.map(sanitizeState);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeState(item)]),
    );
  }
  return value;
}

export function redactState(state: ProjectorState): ProjectorState {
  const result = sanitizeState(state) as ProjectorState;
  const config = result.sysconfig;
  if (config && typeof config === "object" && !Array.isArray(config)) {
    result.sysconfig = { ...config, sn: "<redacted>", bluetooth_address: "<redacted>" };
  }
  return result;
}
