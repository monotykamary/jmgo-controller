from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterator
from typing import Any


class ProtocolError(ValueError):
    """Raised when a JMGO packet cannot be decoded."""


def encode_varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varints must be non-negative")
    output = bytearray()
    while value > 0x7F:
        output.append((value & 0x7F) | 0x80)
        value >>= 7
    output.append(value)
    return bytes(output)


def decode_varint(data: bytes, offset: int = 0) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data) and shift < 70:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise ProtocolError("invalid or incomplete varint")


def field_varint(number: int, value: int) -> bytes:
    return encode_varint(number << 3) + encode_varint(value)


def field_bytes(number: int, value: bytes) -> bytes:
    return encode_varint((number << 3) | 2) + encode_varint(len(value)) + value


def frame(payload: bytes) -> bytes:
    return encode_varint(len(payload)) + payload


def key_packet(keycode: int, pressed: bool) -> bytes:
    event = field_varint(1, keycode) + field_varint(2, int(pressed))
    wrapped_event = field_bytes(1, event)
    return frame(field_bytes(2, wrapped_event))


def set_volume_packet(volume: int) -> bytes:
    if not 0 <= volume <= 100:
        raise ValueError("volume must be between 0 and 100")
    request = json.dumps({"req": "setVolume", "param": str(volume)}, separators=(",", ":")).encode()
    request_info = field_bytes(1, b"reqestinfo") + field_bytes(2, request)
    return frame(field_bytes(2, field_bytes(4, request_info)))


def iter_frames(data: bytes) -> Iterator[bytes]:
    offset = 0
    while offset < len(data):
        length, payload_start = decode_varint(data, offset)
        payload_end = payload_start + length
        if payload_end > len(data):
            raise ProtocolError("incomplete frame")
        yield data[payload_start:payload_end]
        offset = payload_end


def parse_fields(data: bytes) -> list[tuple[int, int, int | bytes]]:
    fields: list[tuple[int, int, int | bytes]] = []
    offset = 0
    while offset < len(data):
        tag, offset = decode_varint(data, offset)
        number, wire_type = tag >> 3, tag & 7
        if wire_type == 0:
            value, offset = decode_varint(data, offset)
        elif wire_type == 2:
            length, offset = decode_varint(data, offset)
            end = offset + length
            if end > len(data):
                raise ProtocolError("incomplete length-delimited field")
            value = data[offset:end]
            offset = end
        else:
            raise ProtocolError(f"unsupported protobuf wire type {wire_type}")
        fields.append((number, wire_type, value))
    return fields


def _only_bytes_field(data: bytes, number: int) -> bytes:
    for field_number, wire_type, value in parse_fields(data):
        if field_number == number and wire_type == 2 and isinstance(value, bytes):
            return value
    raise ProtocolError(f"missing field {number}")


def decode_state_frame(payload: bytes) -> tuple[str, Any]:
    envelope = _only_bytes_field(payload, 3)
    entry_wrapper = _only_bytes_field(envelope, 1)
    key = _only_bytes_field(entry_wrapper, 1).decode("utf-8")
    raw_value = _only_bytes_field(entry_wrapper, 2).decode("utf-8")
    if key == "sysconfig":
        return key, json.loads(raw_value)
    return key, raw_value


def decode_state(data: bytes) -> dict[str, Any]:
    state: dict[str, Any] = {}
    for payload in iter_frames(data):
        try:
            key, value = decode_state_frame(payload)
        except (ProtocolError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        state[key] = value
    return state


def sanitize_state(value: Any) -> Any:
    if isinstance(value, str):
        return "".join(character for character in value if unicodedata.category(character) != "Cf")
    if isinstance(value, dict):
        return {key: sanitize_state(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_state(item) for item in value]
    return value


def redact_state(state: dict[str, Any]) -> dict[str, Any]:
    result = sanitize_state(state)
    config = result.get("sysconfig")
    if isinstance(config, dict):
        config = dict(config)
        for key in ("sn", "bluetooth_address"):
            if key in config:
                config[key] = "<redacted>"
        result["sysconfig"] = config
    return result
