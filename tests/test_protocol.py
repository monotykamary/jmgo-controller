import json

import pytest

from jmgo_controller.protocol import (
    decode_state,
    encode_varint,
    field_bytes,
    frame,
    key_packet,
    redact_state,
    sanitize_state,
    set_volume_packet,
)


def state_frame(key: str, value: str) -> bytes:
    entry = field_bytes(1, key.encode()) + field_bytes(2, value.encode())
    return frame(field_bytes(3, field_bytes(1, entry)))


def test_navigation_packet_matches_captured_protocol():
    assert key_packet(25, True).hex() == "0812060a0408191001"
    assert key_packet(25, False).hex() == "0812060a0408191000"


def test_large_custom_keycode_uses_protobuf_varint():
    assert key_packet(707, True).hex() == "0912070a0508c3051001"


def test_set_volume_matches_captured_protocol():
    assert set_volume_packet(20).hex() == (
        "321230222e0a0a726571657374696e666f1220"
        "7b22726571223a22736574566f6c756d65222c22706172616d223a223230227d"
    )


def test_set_volume_rejects_out_of_range_values():
    with pytest.raises(ValueError):
        set_volume_packet(101)


def test_decode_and_redact_state():
    config = {"deviceName": "JMGO", "sn": "secret", "bluetooth_address": "aa:bb"}
    state = decode_state(state_frame("volume", "14") + state_frame("sysconfig", json.dumps(config)))
    assert state["volume"] == "14"
    assert redact_state(state)["sysconfig"] == {
        "deviceName": "JMGO",
        "sn": "<redacted>",
        "bluetooth_address": "<redacted>",
    }


def test_status_strips_bidirectional_format_characters():
    assert sanitize_state({"storage": "\u200e32.00\u200f GB"}) == {"storage": "32.00 GB"}


def test_varint_boundary():
    assert encode_varint(127) == b"\x7f"
    assert encode_varint(128) == b"\x80\x01"
