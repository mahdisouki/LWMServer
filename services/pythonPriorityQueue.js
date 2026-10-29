/**
 * Shared gate for PYTHON_SERVER calls.
 * High priority (suggest_reply, order_llm) always runs before low (classify).
 * Does not preempt an in-flight low job — high runs as soon as a slot frees.
 */

function resolveConcurrency() {
  const n = Number(process.env.PYTHON_QUEUE_CONCURRENCY);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return 1;
}

const state = {
  concurrency: resolveConcurrency(),
  active: 0,
  high: [],
  low: [],
};

function pump() {
  while (state.active < state.concurrency) {
    const task = state.high.shift() || state.low.shift();
    if (!task) return;

    state.active += 1;
    Promise.resolve()
      .then(() => task.fn())
      .then(task.resolve, task.reject)
      .finally(() => {
        state.active -= 1;
        pump();
      });
  }
}

/**
 * @param {'high'|'low'} priority
 * @param {() => Promise<any>} fn
 */
function runPython(priority, fn) {
  const bucket = priority === 'high' ? 'high' : 'low';
  return new Promise((resolve, reject) => {
    state[bucket].push({ fn, resolve, reject });
    pump();
  });
}

function runPythonHigh(fn) {
  return runPython('high', fn);
}

function runPythonLow(fn) {
  return runPython('low', fn);
}

function getPythonQueueStats() {
  return {
    concurrency: state.concurrency,
    active: state.active,
    highWaiting: state.high.length,
    lowWaiting: state.low.length,
  };
}

module.exports = {
  runPython,
  runPythonHigh,
  runPythonLow,
  getPythonQueueStats,
};
