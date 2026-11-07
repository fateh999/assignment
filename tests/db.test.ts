import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const tmp = await vi.hoisted(async () => {
  const [fsm, pathm, osm] = await Promise.all([import("node:fs"), import("node:path"), import("node:os")]);
  const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "sg-db-"));
  process.env.DATA_DIR = dir;
  return dir;
});

import { createJob, FILE_TTL_MS, getJob, sweepFiles, updateJob } from "../lib/db";

let n = 0;
const job = (format_id = "ig-post-square") => ({ id: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`, input_type: "url" as const, input_value: "https://x.example", platform: "instagram", format_id });

describe("createJob limits", () => {
  it("limits per client IP, then per day for video, then per day overall", () => {
    Object.assign(process.env, { RATE_LIMIT_PER_IP: "2", DAILY_VIDEO_CAP: "1", DAILY_JOB_CAP: "4" });
    try {
      expect(createJob(job(), "1.1.1.1")).toBeNull();
      expect(createJob(job(), "1.1.1.1")).toBeNull();
      const blocked = job();
      expect(createJob(blocked, "1.1.1.1")).toMatch(/Rate limit/);
      expect(getJob(blocked.id)).toBeUndefined();
      expect(createJob(job("ig-reel"), "2.2.2.2")).toBeNull();
      expect(createJob(job("ig-reel"), "3.3.3.3")).toMatch(/video limit/);
      expect(createJob(job(), "3.3.3.3")).toBeNull();
      expect(createJob(job(), "4.4.4.4")).toMatch(/Daily job limit/);
    } finally {
      for (const k of ["RATE_LIMIT_PER_IP", "DAILY_VIDEO_CAP", "DAILY_JOB_CAP"]) delete process.env[k];
    }
  });
});

describe("boot recovery", () => {
  it("marks every queued/processing job failed when the database opens", () => {
    const q = job(), p = job(), d = job();
    for (const j of [q, p, d]) createJob(j, "boot");
    updateJob(p.id, { status: "processing" });
    updateJob(d.id, { status: "done" });
    const g = globalThis as unknown as { __db?: { close(): void } };
    g.__db!.close(); delete g.__db; // simulate a process restart
    expect(getJob(q.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/restarted/) });
    expect(getJob(p.id)!.status).toBe("failed");
    expect(getJob(d.id)!.status).toBe("done");
  });
});

describe("sweepFiles", () => {
  it("deletes files older than the TTL and clears the job reference", () => {
    const j = job();
    createJob(j, "sweep");
    const old = path.join(tmp, "outputs", `${j.id}.png`), fresh = path.join(tmp, "uploads", "fresh.png");
    fs.writeFileSync(old, "x"); fs.writeFileSync(fresh, "x");
    updateJob(j.id, { status: "done", output_file: `${j.id}.png` });
    const past = (Date.now() - FILE_TTL_MS - 60_000) / 1000;
    fs.utimesSync(old, past, past);
    sweepFiles();
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(getJob(j.id)!.output_file).toBeNull();
  });
});
