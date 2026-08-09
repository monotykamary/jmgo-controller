import { pathToFileURL } from "node:url";

export const audioRouteProfile = Object.freeze({
  durationMs: 300_000,
  feedbackIntervalMs: 80,
  packetDurationMs: 5,
  queueCapacityFrames: 256,
  queueDrainFrames: 220,
  baselineQueueLeadMs: 415,
  sinkLeadMs: 300,
  routeAdjustmentLimitMs: 2_000,
  minimumSpeed: 0.98,
  maximumSpeed: 1.02,
  maximumSpeedStep: 0.0005,
  playbackSpeedErrorDivisorMs: 5_000,
  routeFilterDivisor: 16,
  videoDepthStartMs: 30_000,
  videoDepthRampMs: 180_000,
  videoDepthFinalMs: 404,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function videoDepthAt(timeMs, profile) {
  if (timeMs <= profile.videoDepthStartMs) return 0;
  if (profile.videoDepthRampMs <= 0) return profile.videoDepthFinalMs;
  const progress = clamp(
    (timeMs - profile.videoDepthStartMs) / profile.videoDepthRampMs,
    0,
    1,
  );
  return profile.videoDepthFinalMs * progress;
}

export function simulateAudioRoute(options = {}) {
  const profile = { ...audioRouteProfile, ...options };
  const baselineRouteLeadMs = profile.sinkLeadMs + profile.baselineQueueLeadMs;
  const queueCapacityMs = profile.queueCapacityFrames * profile.packetDurationMs;
  let queueLeadMs = profile.baselineQueueLeadMs;
  let routeAdjustmentMs = 0;
  let speed = 1;
  let droppedPacketEquivalent = 0;
  let queueDrainActivations = 0;
  let drainActive = false;
  let maximumQueueFrames = queueLeadMs / profile.packetDurationMs;
  let minimumAppliedSpeed = speed;
  let maximumAppliedSpeed = speed;
  let phaseErrorMs = 0;
  let depthMs = 0;

  for (
    let timeMs = profile.feedbackIntervalMs;
    timeMs <= profile.durationMs;
    timeMs += profile.feedbackIntervalMs
  ) {
    queueLeadMs += (1 - speed) * profile.feedbackIntervalMs;
    if (queueLeadMs < 0) queueLeadMs = 0;
    if (queueLeadMs > queueCapacityMs) {
      droppedPacketEquivalent +=
        (queueLeadMs - queueCapacityMs) / profile.packetDurationMs;
      queueLeadMs = queueCapacityMs;
    }

    const measuredRouteLeadMs = profile.sinkLeadMs + queueLeadMs;
    const routeSampleMs = clamp(
      measuredRouteLeadMs - baselineRouteLeadMs,
      -profile.routeAdjustmentLimitMs,
      profile.routeAdjustmentLimitMs,
    );
    routeAdjustmentMs +=
      (routeSampleMs - routeAdjustmentMs) / profile.routeFilterDivisor;

    depthMs = videoDepthAt(timeMs, profile);
    phaseErrorMs = depthMs - routeAdjustmentMs;
    let desiredSpeed = clamp(
      1 - phaseErrorMs / profile.playbackSpeedErrorDivisorMs,
      profile.minimumSpeed,
      profile.maximumSpeed,
    );
    const shouldDrain =
      profile.enableQueueDrain !== false &&
      queueLeadMs / profile.packetDurationMs >= profile.queueDrainFrames;
    if (shouldDrain && !drainActive) queueDrainActivations++;
    drainActive = shouldDrain;
    if (drainActive) desiredSpeed = profile.maximumSpeed;

    speed += clamp(
      desiredSpeed - speed,
      -profile.maximumSpeedStep,
      profile.maximumSpeedStep,
    );
    maximumQueueFrames = Math.max(
      maximumQueueFrames,
      queueLeadMs / profile.packetDurationMs,
    );
    minimumAppliedSpeed = Math.min(minimumAppliedSpeed, speed);
    maximumAppliedSpeed = Math.max(maximumAppliedSpeed, speed);
  }

  return {
    durationMs: profile.durationMs,
    droppedPacketEquivalent,
    queueDrainActivations,
    maximumQueueFrames,
    finalQueueFrames: queueLeadMs / profile.packetDurationMs,
    finalRouteAdjustmentMs: routeAdjustmentMs,
    finalVideoDepthMs: depthMs,
    finalPhaseErrorMs: phaseErrorMs,
    finalSpeed: speed,
    minimumAppliedSpeed,
    maximumAppliedSpeed,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const corrected = simulateAudioRoute();
  const legacyClamp = simulateAudioRoute({
    routeAdjustmentLimitMs: 150,
    enableQueueDrain: false,
  });
  const saturation = simulateAudioRoute({
    durationMs: 600_000,
    videoDepthRampMs: 30_000,
    videoDepthFinalMs: 1_000,
  });
  console.log(JSON.stringify({ corrected, legacyClamp, saturation }, null, 2));
}
