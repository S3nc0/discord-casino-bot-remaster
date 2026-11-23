// Preloaded into the server with NODE_OPTIONS=--import=/perf/probe.mjs (see ops/pi-sim/perf.sh).
// Measures the server process from the inside and appends one JSON line per second to
// $PERF_PROBE_FILE: RSS, cumulative CPU time and the raw event-loop lag samples of that second.
// It adds one 10 ms timer and one 1 s timer; nothing else in the process is touched.
import fs from 'node:fs';
import net from 'node:net';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setInterval } from 'node:timers';

const file = process.env.PERF_PROBE_FILE;
if (file) {
  const TICK_MS = 10;
  const write = (record) => {
    try {
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    } catch {
      // The probe must never take the server down.
    }
  };

  // Time from process start to the first `listening` event (the server's own cold start).
  const emit = net.Server.prototype.emit;
  let announced = false;
  net.Server.prototype.emit = function patched(event, ...args) {
    if (event === 'listening' && !announced) {
      announced = true;
      write({ type: 'listening', uptimeMs: Math.round(process.uptime() * 1000), t: Date.now() });
    }
    return emit.call(this, event, ...args);
  };

  let lag = [];
  let expected = performance.now() + TICK_MS;
  const sampler = setInterval(() => {
    const now = performance.now();
    lag.push(Math.max(0, Math.round((now - expected) * 10) / 10));
    expected = now + TICK_MS;
  }, TICK_MS);
  sampler.unref();

  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  const reporter = setInterval(() => {
    const at = performance.now();
    const cpu = process.cpuUsage(lastCpu);
    const wallMs = at - lastAt;
    lastCpu = process.cpuUsage();
    lastAt = at;
    const usage = process.memoryUsage();
    write({
      type: 'sample',
      t: Date.now(),
      rssMb: Math.round((usage.rss / 1048576) * 10) / 10,
      heapMb: Math.round((usage.heapUsed / 1048576) * 10) / 10,
      // Percent of one core over the last interval (2 cores = 200 at most).
      cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / wallMs) * 1000) / 10,
      lag,
    });
    lag = [];
  }, 1000);
  reporter.unref();
}
