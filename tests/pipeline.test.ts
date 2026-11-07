import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// imports are hoisted, so env must be set in vi.hoisted to take effect before lib/db loads
const tmp = await vi.hoisted(async () => {
  const [fsm, pathm, osm] = await Promise.all([import("node:fs"), import("node:path"), import("node:os")]);
  const dir = fsm.mkdtempSync(pathm.join(osm.tmpdir(), "sg-test-"));
  process.env.DATA_DIR = dir;
  process.env.RATE_LIMIT_PER_IP = "1000";
  return dir;
});

vi.mock("../lib/scrape", () => ({ scrapeProduct: vi.fn() }));
vi.mock("../lib/openrouter", () => ({ generateCopy: vi.fn() }));
vi.mock("../lib/fal", () => ({ falImage: vi.fn(), falVideo: vi.fn() }));
vi.mock("../lib/ssrf", () => ({ safeFetch: vi.fn() }));

import { scrapeProduct } from "../lib/scrape";
import { generateCopy } from "../lib/openrouter";
import { falImage, falVideo } from "../lib/fal";
import { safeFetch } from "../lib/ssrf";
import { createJob, getJob } from "../lib/db";
import { runJob, startJob } from "../lib/pipeline";
import { makeVideo } from "../lib/video";
import { getFormat } from "../lib/platforms";

const COPY = { headline: "Great Product", caption: "Buy it.", hashtags: ["a"], imagePrompt: "scene" };
let png: Buffer<ArrayBuffer>;
let n = 0;

function newJob(formatId: string, platform = "instagram") {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  expect(createJob({ id, input_type: "url", input_value: "https://shop.example/p", platform, format_id: formatId })).toBeNull();
  return id;
}
async function run(formatId: string, platform = "instagram", timeoutMs?: number) {
  const id = newJob(formatId, platform);
  await runJob(id, timeoutMs);
  return getJob(id)!;
}
/** mock implementation that only settles when the given signal aborts */
const hangUntilAbort = (signal: AbortSignal) => new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(signal.reason)));

beforeAll(async () => {
  png = Buffer.from(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#c84" } }).png().toBuffer());
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(scrapeProduct).mockResolvedValue({ url: "https://shop.example/p", title: "Thing", description: "d", imageUrl: "https://shop.example/i.png" });
  vi.mocked(safeFetch).mockResolvedValue({ buffer: png, contentType: "image/png", url: "" });
  vi.mocked(generateCopy).mockResolvedValue(COPY);
});

describe("pipeline", () => {
  it("URL to exact-size image, not simulated", async () => {
    const j = await run("ig-post-square");
    expect(j.status).toBe("done");
    expect(j.simulated).toBe(0);
    const meta = await sharp(path.join(tmp, "outputs", j.output_file!)).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1080]);
  });

  it("fails with a friendly message when the copy service errors", async () => {
    vi.mocked(generateCopy).mockRejectedValue(new Error("OpenRouter error 500: boom"));
    const j = await run("ig-post-square");
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/caption service/);
    expect(j.error).not.toMatch(/boom/);
  });

  it("fails friendly when the page 404s", async () => {
    vi.mocked(scrapeProduct).mockRejectedValue(new Error("Fetch failed with status 404"));
    const j = await run("ig-post-square");
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/wasn't found/);
  });

  it("falls back to a local background when image generation fails (flagged simulated)", async () => {
    vi.mocked(scrapeProduct).mockResolvedValue({ url: "u", title: "Thing", description: "" });
    vi.mocked(falImage).mockRejectedValue(new Error("fal down"));
    const j = await run("yt-thumb", "youtube");
    expect(j.status).toBe("done");
    expect(j.simulated).toBe(1);
    const meta = await sharp(path.join(tmp, "outputs", j.output_file!)).metadata();
    expect([meta.width, meta.height]).toEqual([1280, 720]);
  });

  it("falls back to a local video when fal video fails", async () => {
    vi.mocked(falVideo).mockRejectedValue(new Error("fal timed out"));
    const j = await run("tt-video", "tiktok");
    expect(j.status).toBe("done");
    expect(j.simulated).toBe(1);
    expect(j.output_file).toMatch(/\.mp4$/);
    expect(fs.statSync(path.join(tmp, "outputs", j.output_file!)).size).toBeGreaterThan(10_000);
  }, 60_000);
});

describe("uploads", () => {
  it("send the photo to the copy step so copy is based on what's visible", async () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    fs.mkdirSync(path.join(tmp, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "uploads", `${id}.png`), png);
    createJob({ id, input_type: "image", input_value: `${id}.png`, platform: "instagram", format_id: "ig-post-square" });
    await runJob(id);
    expect(getJob(id)!.status).toBe("done");
    expect(vi.mocked(generateCopy).mock.calls[0][3]).toBeInstanceOf(Buffer);
  });
});

describe("abort", () => {
  it("the job timer aborts the running step and the job ends failed", async () => {
    vi.mocked(generateCopy).mockImplementation((_p, _pl, signal) => hangUntilAbort(signal));
    const j = await run("ig-post-square", "instagram", 50);
    expect(vi.mocked(generateCopy).mock.calls[0][2].aborted).toBe(true);
    expect(j).toMatchObject({ status: "failed", error: expect.stringMatching(/took too long/), output_file: null });
    expect(falImage).not.toHaveBeenCalled();
  });

  it("an abort during fal video does not fall through to rendering or done", async () => {
    vi.mocked(falVideo).mockImplementation((_b, _p, signal) => hangUntilAbort(signal));
    const j = await run("tt-video", "tiktok", 300);
    expect(j.status).toBe("failed");
    expect(fs.existsSync(path.join(tmp, "outputs", `${j.id}.mp4`))).toBe(false);
  });

  it("kills ffmpeg when the signal aborts", async () => {
    const t0 = Date.now();
    const done = makeVideo({ still: png, bannerPng: png, f: getFormat("yt-video")!, outFile: path.join(tmp, "outputs", "killed.mp4"), signal: AbortSignal.timeout(300) });
    await expect(done).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("concurrency", () => {
  it("runs at most 2 jobs; the third stays queued until a slot frees", async () => {
    const release: (() => void)[] = [];
    vi.mocked(generateCopy).mockImplementation(() => new Promise((r) => release.push(() => r(COPY))));
    const ids = [newJob("ig-post-square"), newJob("ig-post-square"), newJob("ig-post-square")];
    const all = Promise.all(ids.map((id) => startJob(id)));
    await vi.waitFor(() => expect(release.length).toBe(2));
    expect(ids.map((id) => getJob(id)!.status)).toEqual(["processing", "processing", "queued"]);
    release.shift()!();
    await vi.waitFor(() => expect(release.length).toBe(2)); // third job picked up the freed slot
    expect(getJob(ids[2])!.status).toBe("processing");
    release.splice(0).forEach((r) => r());
    await all;
    expect(ids.map((id) => getJob(id)!.status)).toEqual(["done", "done", "done"]);
  });
});
