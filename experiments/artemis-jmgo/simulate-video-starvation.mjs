const FRAME_MS = 1000 / 60;
const PREPARED_LIMIT = 5;

export function simulateVideoStarvation({
  outageStage,
  outageDurationMs,
  totalDurationMs = 5000,
}) {
  let prepared = PREPARED_LIMIT;
  let pacing = true;
  let starvationStartMs = null;
  let consecutiveEmpty = 0;
  let idrRequested = false;
  let codecScheduled = false;
  let reconnectRequested = false;
  const events = [];

  for (let nowMs = 0; nowMs <= totalDurationMs; nowMs += FRAME_MS) {
    const outage = nowMs < outageDurationMs;
    const inputFresh = !(outage && outageStage === "input");
    const imageAvailable = !outage;

    if (imageAvailable && prepared < PREPARED_LIMIT) prepared += 1;

    if (pacing) {
      if (prepared > 0) {
        prepared -= 1;
        if (starvationStartMs !== null) {
          events.push({ type: "recovered", atMs: nowMs });
          starvationStartMs = null;
          consecutiveEmpty = 0;
          idrRequested = false;
          codecScheduled = false;
          reconnectRequested = false;
        }
      } else {
        if (starvationStartMs === null) {
          starvationStartMs = nowMs;
          events.push({ type: "started", atMs: nowMs });
        }
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 3) {
          pacing = false;
          events.push({ type: "rebuffer", atMs: nowMs });
        }
      }
    } else if (prepared >= PREPARED_LIMIT) {
      pacing = true;
      prepared -= 1;
      events.push({ type: "recovered", atMs: nowMs });
      starvationStartMs = null;
      consecutiveEmpty = 0;
      idrRequested = false;
      codecScheduled = false;
      reconnectRequested = false;
    }

    if (starvationStartMs === null) continue;
    const stalledMs = nowMs - starvationStartMs;
    if (!idrRequested && stalledMs >= 100) {
      idrRequested = true;
      events.push({ type: "idr", atMs: nowMs });
    }
    if (!reconnectRequested && !codecScheduled && inputFresh && stalledMs >= 1000) {
      codecScheduled = true;
      events.push({ type: "codec", atMs: nowMs });
    }
    if (!reconnectRequested && stalledMs >= 3000) {
      reconnectRequested = true;
      events.push({ type: "reconnect", atMs: nowMs });
    }
  }

  return {
    events,
    eventTypes: events.map((event) => event.type),
    pacing,
    prepared,
  };
}
