import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { LIMITS } from "./limits";
import { FORMATS, getFormat } from "./platforms";

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const FILE_TTL_MS = 7 * 24 * 3600_000;

const g = globalThis as unknown as { __db?: DatabaseSync };
// Opened lazily so `next build` workers never touch the database file.
function getDb(): DatabaseSync {
  return (g.__db ??= open());
}
function open(): DatabaseSync {
  fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "outputs"), { recursive: true });
  const d = new DatabaseSync(path.join(DATA_DIR, "app.db"));
  d.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  d.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, input_type TEXT NOT NULL, input_value TEXT NOT NULL,
    platform TEXT NOT NULL, format_id TEXT NOT NULL, status TEXT NOT NULL,
    step TEXT, copy_json TEXT, output_file TEXT, simulated INTEGER DEFAULT 0,
    error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, client_ip TEXT)`);
  if (!d.prepare("SELECT 1 FROM pragma_table_info('jobs') WHERE name='client_ip'").get()) d.exec("ALTER TABLE jobs ADD COLUMN client_ip TEXT");
  // Jobs run in-process on a single instance, so anything still active when the DB opens (process boot) is dead.
  d.prepare("UPDATE jobs SET status='failed', step='Failed', error=?, updated_at=? WHERE status IN ('queued','processing')")
    .run("The server restarted before this job finished. Please try again.", Date.now());
  sweepFiles(d);
  setInterval(() => sweepFiles(d), 3600_000).unref();
  return d;
}

/** Delete uploads/outputs older than FILE_TTL_MS and drop the job references to them. */
export function sweepFiles(d = getDb(), now = Date.now()) {
  for (const dir of [path.join(DATA_DIR, "uploads"), path.join(DATA_DIR, "outputs")]) {
    // runtime data, not source: keep the bundler's file tracer out of it
    for (const name of fs.readdirSync(/*turbopackIgnore: true*/ dir)) {
      const file = path.join(/*turbopackIgnore: true*/ dir, name);
      try {
        if (now - fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs < FILE_TTL_MS) continue;
        fs.rmSync(/*turbopackIgnore: true*/ file, { force: true });
        if (dir.endsWith("outputs")) d.prepare("UPDATE jobs SET output_file=NULL WHERE output_file=?").run(name);
      } catch (e) { console.error("[sweep]", file, e); }
    }
  }
}

export type Status = "queued" | "processing" | "done" | "failed";
export interface Job {
  id: string; input_type: "url" | "image"; input_value: string; platform: string; format_id: string;
  status: Status; step: string | null; copy_json: string | null; output_file: string | null;
  simulated: number; error: string | null; created_at: number; updated_at: number;
}
type NewJob = Pick<Job, "id" | "input_type" | "input_value" | "platform" | "format_id">;

const VIDEO_IDS = FORMATS.filter((f) => f.kind === "video").map((f) => `'${f.id}'`).join(",");

/**
 * Check the cost limits and insert in one synchronous transaction, so concurrent requests cannot all pass.
 * Returns an error message when a limit is hit (nothing inserted), otherwise null.
 */
export function createJob(j: NewJob, clientIp = "unknown"): string | null {
  const d = getDb(), now = Date.now();
  const count = (where: string, ...args: (string | number)[]) =>
    (d.prepare(`SELECT COUNT(*) c FROM jobs WHERE ${where}`).get(...args) as { c: number }).c;
  d.exec("BEGIN IMMEDIATE");
  try {
    let err: string | null = null;
    if (count("client_ip=? AND created_at>?", clientIp, now - 10 * 60_000) >= LIMITS.perIpPer10Min) err = "Rate limit: too many jobs, try again in a few minutes";
    else if (count("created_at>?", now - 86400_000) >= LIMITS.jobsPerDay) err = "Daily job limit reached. Try again tomorrow.";
    else if (getFormat(j.format_id)?.kind === "video" && count(`format_id IN (${VIDEO_IDS}) AND created_at>?`, now - 86400_000) >= LIMITS.videosPerDay) err = "Daily video limit reached. Try an image format, or try again tomorrow.";
    else d.prepare(`INSERT INTO jobs (id,input_type,input_value,platform,format_id,status,step,created_at,updated_at,client_ip)
      VALUES (?,?,?,?,?,'queued','Queued',?,?,?)`).run(j.id, j.input_type, j.input_value, j.platform, j.format_id, now, now, clientIp);
    d.exec("COMMIT");
    return err;
  } catch (e) { d.exec("ROLLBACK"); throw e; }
}
export function getJob(id: string) { return getDb().prepare("SELECT * FROM jobs WHERE id=?").get(id) as unknown as Job | undefined; }
export function listJobs(n = 20) { return getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(n) as unknown as Job[]; }
export function updateJob(id: string, patch: Partial<Omit<Job, "id">>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = keys.map((k) => `${k}=?`).join(",");
  getDb().prepare(`UPDATE jobs SET ${sql}, updated_at=? WHERE id=?`).run(...(Object.values(patch) as never[]), Date.now(), id);
}
