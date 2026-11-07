const num = (name: string, fallback: number) => Number(process.env[name]) || fallback;

/** Cost guards. All overridable by env; read at call time so tests and restarts pick up changes. */
export const LIMITS = {
  get perIpPer10Min() { return num("RATE_LIMIT_PER_IP", 10); },
  get jobsPerDay() { return num("DAILY_JOB_CAP", 200); },
  get videosPerDay() { return num("DAILY_VIDEO_CAP", 20); },
  get maxRunning() { return num("MAX_RUNNING_JOBS", 2); },
};

/** First hop of x-forwarded-for (the proxy in front of us sets it); one shared bucket if absent. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** Run at most `max` tasks at once; the rest wait in FIFO order. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) active++;
    else await new Promise<void>((r) => waiting.push(r)); // slot is handed over by the finishing task
    try { return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}
