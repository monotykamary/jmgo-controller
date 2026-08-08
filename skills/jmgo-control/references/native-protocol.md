# JMGO native LAN protocol notes

The tested JMGO S901 exposes a proprietary remote endpoint on TCP 9005. It is independent of ADB and remains useful when Android debugging is unavailable.

## Proven operations

- Read state frames, including volume and firmware fields.
- Send directional, OK, back, home, settings, power, and volume key packets.
- Set absolute volume from 0 through 100.
- Watch state changes continuously.

The TypeScript implementation encodes protobuf-style varints, including key codes larger than one byte. Captured navigation and volume packets have regression fixtures under `tests/protocol.test.ts`.

## Safety and privacy

State can include stable serial numbers and Bluetooth addresses. Default decoding sanitizes bidirectional Unicode controls and redacts stable identifiers. Use `--include-identifiers` only for a direct diagnostic and never paste that output into committed fixtures.

Power semantics vary by firmware. Probe navigation and volume first. A successful socket write proves packet delivery, not necessarily the physical effect; use state watch, ADB foreground activity, audio state, or direct user observation for feedback.

## Discovery

Discovery scans a bounded local CIDR and probes the native service. `jmgo discover set` saves exactly one result in a mode-0600 configuration. If multiple projectors answer, require an explicit `jmgo host set HOST` rather than guessing.
