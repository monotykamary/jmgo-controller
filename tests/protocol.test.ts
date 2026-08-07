import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeState,
  encodeVarint,
  fieldBytes,
  frame,
  keyPacket,
  redactState,
  sanitizeState,
  setVolumePacket,
} from "../src/protocol.js";

function stateFrame(key: string, value: string): Buffer {
  const entry = Buffer.concat([
    fieldBytes(1, Buffer.from(key)),
    fieldBytes(2, Buffer.from(value)),
  ]);
  return frame(fieldBytes(3, fieldBytes(1, entry)));
}

test("navigation packets match captured protocol", () => {
  assert.equal(keyPacket(25, true).toString("hex"), "0812060a0408191001");
  assert.equal(keyPacket(25, false).toString("hex"), "0812060a0408191000");
});

test("large custom keycodes use protobuf varints", () => {
  assert.equal(keyPacket(707, true).toString("hex"), "0912070a0508c3051001");
});

test("set volume packet matches captured protocol", () => {
  assert.equal(
    setVolumePacket(20).toString("hex"),
    "321230222e0a0a726571657374696e666f12207b22726571223a22736574566f6c756d65222c22706172616d223a223230227d",
  );
});

test("volume rejects values outside 0 through 100", () => {
  assert.throws(() => setVolumePacket(101), RangeError);
});

test("state decoding and identifier redaction", () => {
  const config = JSON.stringify({ deviceName: "JMGO", sn: "secret", bluetooth_address: "aa" });
  const state = decodeState(Buffer.concat([stateFrame("volume", "14"), stateFrame("sysconfig", config)]));
  assert.equal(state.volume, "14");
  assert.deepEqual((redactState(state).sysconfig as Record<string, string>), {
    deviceName: "JMGO",
    sn: "<redacted>",
    bluetooth_address: "<redacted>",
  });
});

test("status strings remove bidirectional format characters", () => {
  assert.deepEqual(sanitizeState({ storage: "\u200e32.00\u200f GB" }), { storage: "32.00 GB" });
});

test("varint boundary encoding", () => {
  assert.deepEqual(encodeVarint(127), Buffer.from([0x7f]));
  assert.deepEqual(encodeVarint(128), Buffer.from([0x80, 0x01]));
});
