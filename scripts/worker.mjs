const baseUrl = (process.env.FOLLOWUP_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const workerKey = process.env.WORKER_API_KEY;
const pollMilliseconds = Math.max(15_000, Number(process.env.WORKER_POLL_MS || 30_000));
const enrollMilliseconds = Math.max(pollMilliseconds, Number(process.env.WORKER_ENROLL_INTERVAL_MS || 300_000));

if (!workerKey) {
  console.error("WORKER_API_KEY não configurada.");
  process.exit(1);
}

let running = false;
let lastEnrollmentAt = 0;

async function execute(action) {
  const response = await fetch(`${baseUrl}/api/internal/control`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-key": workerKey },
    body: JSON.stringify({ action }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${action}: ${result.error || response.statusText}`);
  return result;
}

async function executeSafely(action) {
  try {
    return { ok: true, result: await execute(action) };
  } catch (error) {
    console.error(new Date().toISOString(), `${action}:`, error instanceof Error ? error.message : error);
    return { ok: false, result: { error: true } };
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const shouldEnroll = Date.now() - lastEnrollmentAt >= enrollMilliseconds;
    const enrollmentRun = shouldEnroll
      ? await executeSafely("enroll")
      : { ok: true, result: { enrolled: 0, skipped: true } };
    if (shouldEnroll && enrollmentRun.ok) lastEnrollmentAt = Date.now();
    const queueRun = await executeSafely("queue");
    const dispatchRun = await executeSafely("dispatch");
    const broadcastRun = await executeSafely("broadcast");
    const enrolled = enrollmentRun.result;
    const queued = queueRun.result;
    const dispatched = dispatchRun.result;
    const broadcasts = broadcastRun.result;
    const activity = (enrolled.enrolled || 0) + (queued.queued || 0) +
      (dispatched.sent || 0) + (dispatched.simulated || 0) +
      (broadcasts.sent || 0) + (broadcasts.simulated || 0);
    if (activity || shouldEnroll) console.log(new Date().toISOString(), { enrolled, queued, dispatched, broadcasts });
  } catch (error) {
    console.error(new Date().toISOString(), error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

console.log(`Worker ativo: fila a cada ${pollMilliseconds} ms; entrada automática a cada ${enrollMilliseconds} ms.`);
await tick();
setInterval(tick, pollMilliseconds);
