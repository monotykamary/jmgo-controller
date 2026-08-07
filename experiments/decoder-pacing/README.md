# JMGO decoder-pacing sandbox

This headless experiment reconstructs the periodic output stalls measured from the JMGO S901's proprietary `OMX.MS.AVC.Decoder` and compares presentation strategies without connecting to the projector or changing Sunshine.

## Measurement source

The fixture `jmgo-h264-720p60.json` records the 12-second controlled-motion SurfaceFlinger sample collected on 2026-08-07:

- 1280x720 at a requested 60 FPS
- Sunshine `2026.726.710` and `h264_videotoolbox`
- Moonlight using `OMX.MS.AVC.Decoder`
- 675 frames, 57.082 average FPS
- zero network, SurfaceFlinger, late-acquire, or desired-present drops
- recurring 94-114 ms presentation gaps

SurfaceFlinger exposes a histogram rather than ordered frame timestamps. The simulator therefore treats those long-gap bins as periodic decoder stalls, models a six-millisecond vendor output scheduling quantum from the observed 6/12/18/24 ms clusters, and emits queued frames faster while the decoder catches up. A measured calibration factor converts the histogram gap durations into decoder pause durations so the default reconstruction reproduces the observed 114 ms maximum arrival gap.

This is a behavioral reconstruction, not emulation of the MStar decoder firmware.

## Run

```bash
pnpm simulate:pacing
pnpm simulate:pacing -- --json
pnpm simulate:pacing -- --duration 60 --seed 901
pnpm simulate:pacing -- --stall-scale 0.75
pnpm simulate:pacing -- --sweep
```

The compared strategies are:

- `lowest-latency`: keep only the newest decoded frame.
- `moonlight-balanced`: Moonlight's two-slot queue with one frame of effective jitter buffering.
- `buffer-3`: start after three decoded frames are available.
- `buffer-6`: start after six decoded frames are available.

The useful outputs are repeated vsyncs, longest visible freeze, dropped source frames, and latency percentiles. A transport or decoder optimization can be approximated with `--stall-scale`; for example, `0.75` asks what happens if lower bitrate or lower processing overhead shortens decoder stalls by 25%. `--sweep` reports the full sensitivity curve and must not be interpreted as a direct bitrate-to-stall formula.

## Limits

- The original frame ordering is unavailable, so stall ordering is deterministically reconstructed from the measured bins.
- It cannot model undocumented hardware queues, firmware scheduling, or AudioFlinger coupling.
- It predicts pacing trade-offs; it does not prove that a specific Sunshine option will shorten decoder stalls.
- Any later hardware experiment should still change one variable at a time and collect fresh SurfaceFlinger timestamps.
