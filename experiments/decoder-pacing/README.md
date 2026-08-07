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
pnpm simulate:pacing -- --scheduler-scale 0.75
pnpm simulate:pacing -- --load-scale 0.48
pnpm simulate:pacing -- --sweep
pnpm simulate:pacing -- --load-sweep
```

The compared strategies are:

- `lowest-latency`: keep only the newest decoded frame.
- `moonlight-balanced`: Moonlight's two-slot queue with one frame of effective jitter buffering.
- `buffer-3`: start after three decoded frames are available.
- `buffer-6`: start after six decoded frames are available.

The useful outputs are repeated vsyncs, longest visible freeze, dropped source frames, and latency percentiles. The model deliberately separates two effects:

- `--scheduler-scale` changes the fixed periodic pause attributed to JMGO vendor scheduling.
- `--load-scale` changes ordinary and catch-up decode service time, approximating lower bitrate or packet-processing load while leaving the scheduler pause intact.

`--sweep` varies scheduler pauses; `--load-sweep` varies decoder load. The legacy `--stall-scale` option remains an alias for `--scheduler-scale`. Neither scale is a direct bitrate formula.

In the calibrated default, `--load-scale 0.48` leaves the 114 ms maximum gap unchanged because the fixed scheduler pause dominates and decode service already completes within one vendor scheduling quantum. This makes the earlier assumption that a 52% transport reduction produces a 52% shorter stall explicitly optimistic. Host tuning may still help real hardware, but the scheduler-aware model does not credit it until a new measurement shows that coupling.

## Limits

- The original frame ordering is unavailable, so stall ordering is deterministically reconstructed from the measured bins.
- It cannot model undocumented hardware queues, firmware scheduling, or AudioFlinger coupling.
- Fixed scheduler pauses and load-dependent service are separated, but their real coupling is unknown.
- It predicts pacing trade-offs; it does not prove that a specific Sunshine option will shorten decoder stalls.
- Any later hardware experiment should still change one variable at a time and collect fresh SurfaceFlinger timestamps.
