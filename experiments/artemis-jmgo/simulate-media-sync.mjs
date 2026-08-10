import { pathToFileURL } from "node:url";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

export function scheduleMediaAudioPackets({
  mediaTimesMs,
  arrivalsMs,
  mediaOffsetMs = 2_000,
  mediaOffsetsMs = null,
  timelineActive = null,
  sinkLeadMs = 300,
  deadlineCorrectionMs = 0,
  maximumDeadlineStepMs = 0.1,
  discontinuityMs = 100,
  deadlineRebaseMs = 100,
}) {
  if (mediaTimesMs.length !== arrivalsMs.length) {
    throw new Error("mediaTimesMs and arrivalsMs must have equal lengths");
  }
  if (mediaOffsetsMs !== null && mediaOffsetsMs.length !== mediaTimesMs.length) {
    throw new Error("mediaOffsetsMs and mediaTimesMs must have equal lengths");
  }
  if (timelineActive !== null && timelineActive.length !== mediaTimesMs.length) {
    throw new Error("timelineActive and mediaTimesMs must have equal lengths");
  }

  const deadlinesMs = [];
  let previousMediaMs = null;
  let previousDeadlineMs = null;
  let previousTimelineActive = null;
  for (let index = 0; index < mediaTimesMs.length; index++) {
    const mediaMs = mediaTimesMs[index];
    const arrivalMs = arrivalsMs[index];
    const currentMediaOffsetMs = mediaOffsetsMs?.[index] ?? mediaOffsetMs;
    const currentTimelineActive = timelineActive?.[index] ?? true;
    let deadlineMs = Math.max(
      arrivalMs,
      currentMediaOffsetMs + mediaMs - sinkLeadMs + deadlineCorrectionMs,
    );
    if (previousMediaMs !== null) {
      const mediaDeltaMs = mediaMs - previousMediaMs;
      const expectedDeadlineMs = previousDeadlineMs + mediaDeltaMs;
      const deadlineCorrection = deadlineMs - expectedDeadlineMs;
      if (
        mediaDeltaMs > 0 &&
        mediaDeltaMs <= discontinuityMs &&
        expectedDeadlineMs >= arrivalMs &&
        Math.abs(deadlineCorrection) < deadlineRebaseMs &&
        currentTimelineActive === previousTimelineActive
      ) {
        deadlineMs =
          expectedDeadlineMs +
          clamp(
            deadlineCorrection,
            -maximumDeadlineStepMs,
            maximumDeadlineStepMs,
          );
      }
    }
    deadlinesMs.push(deadlineMs);
    previousMediaMs = mediaMs;
    previousDeadlineMs = deadlineMs;
    previousTimelineActive = currentTimelineActive;
  }
  return deadlinesMs;
}

export function simulateSharedMediaSync({
  durationMs = 20_000,
  feedbackIntervalMs = 80,
  actualSinkLeadMs = 330,
  estimatedSinkLeadMs = 300,
  phaseFilterDivisor = 8,
  correctionDivisor = 16,
  maximumCorrectionStepMs = 1,
  maximumCorrectionMs = 250,
} = {}) {
  let deadlineCorrectionMs = 0;
  let filteredPhaseErrorMs = 0;
  let maximumAbsolutePhaseErrorMs = 0;
  let phaseErrorMs = 0;

  for (
    let elapsedMs = feedbackIntervalMs;
    elapsedMs <= durationMs;
    elapsedMs += feedbackIntervalMs
  ) {
    const predictedAudioPresentationMs =
      -estimatedSinkLeadMs + deadlineCorrectionMs + actualSinkLeadMs;
    phaseErrorMs = -predictedAudioPresentationMs;
    filteredPhaseErrorMs +=
      (phaseErrorMs - filteredPhaseErrorMs) / phaseFilterDivisor;
    maximumAbsolutePhaseErrorMs = Math.max(
      maximumAbsolutePhaseErrorMs,
      Math.abs(phaseErrorMs),
    );
    const correctionStepMs = clamp(
      filteredPhaseErrorMs / correctionDivisor,
      -maximumCorrectionStepMs,
      maximumCorrectionStepMs,
    );
    deadlineCorrectionMs = clamp(
      deadlineCorrectionMs + correctionStepMs,
      -maximumCorrectionMs,
      maximumCorrectionMs,
    );
  }

  return {
    deadlineCorrectionMs,
    finalPhaseErrorMs: phaseErrorMs,
    maximumAbsolutePhaseErrorMs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    JSON.stringify(
      {
        burstDeadlines: scheduleMediaAudioPackets({
          mediaTimesMs: [0, 5, 10, 15, 20, 25],
          arrivalsMs: [1_000, 1_005, 1_010, 1_010, 1_010, 1_025],
        }),
        slowSink: simulateSharedMediaSync(),
        fastSink: simulateSharedMediaSync({ actualSinkLeadMs: 260 }),
      },
      null,
      2,
    ),
  );
}
