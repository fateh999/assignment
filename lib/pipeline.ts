import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR, getJob, updateJob } from "./db";
import { createLimiter, LIMITS } from "./limits";
import { getFormat } from "./platforms";
import type { Platform } from "./platforms";
import { scrapeProduct, type Product } from "./scrape";
import { generateCopy } from "./openrouter";
import { falImage, falVideo } from "./fal";
import { safeFetch } from "./ssrf";
import { banner, composeImage, cropToFormat, gradientBase, MAX_INPUT_PIXELS } from "./compose";
import { makeVideo } from "./video";
import { friendlyError } from "./errors";

/**
 * Whole-job budget. Video worst case with every step at its own timeout: scrape 15 s + image download 15 s
 * + copy 3x30 s + 3 s backoff + fal image 60 s + fal video 360 s + ffmpeg 120 s = 663 s (~11 min), so 10 min
 * would cut off jobs that are still within their step budgets. 12 min leaves headroom for sharp/IO.
 */
export const JOB_TIMEOUT_MS = 12 * 60_000;

// In-process: at most LIMITS.maxRunning jobs run at once; the rest stay `queued` until a slot frees.
const limit = createLimiter(LIMITS.maxRunning);
export const startJob = (id: string) => limit(() => runJob(id));

export async function runJob(id: string, timeoutMs = JOB_TIMEOUT_MS) {
  const job = getJob(id);
  if (!job) return;
  // One controller per job: the timer aborts every network step and kills ffmpeg.
  const ac = new AbortController();
  const signal = ac.signal;
  const step = (s: string) => { signal.throwIfAborted(); updateJob(id, { status: "processing", step: s }); };
  const timer = setTimeout(() => {
    ac.abort(new Error("Job timed out"));
    updateJob(id, { status: "failed", step: "Failed", error: friendlyError("timed out") });
  }, timeoutMs);
  try {
    const f = getFormat(job.format_id)!;
    let simulated = false;
    let product: Product = { url: "", title: "Your product", description: "A product shown in the uploaded image" };
    let source: Buffer | null = null;

    if (job.input_type === "url") {
      step("Reading product page");
      product = await scrapeProduct(job.input_value, signal);
      if (product.imageUrl) {
        step("Downloading product image");
        try {
          source = (await safeFetch(product.imageUrl, { maxBytes: 15_000_000, accept: "image/*", signal })).buffer;
          const m = await sharp(source).metadata();
          if ((m.width ?? 0) * (m.height ?? 0) > MAX_INPUT_PIXELS) throw new Error("Image too large");
        } catch { source = null; }
      }
    } else {
      source = await fs.readFile(path.join(DATA_DIR, "uploads", path.basename(job.input_value)));
    }

    step("Writing copy");
    const copy = await generateCopy(product, job.platform as Platform, signal, job.input_type === "image" ? source ?? undefined : undefined);
    updateJob(id, { copy_json: JSON.stringify(copy) });

    if (!source) {
      step("Generating image");
      try {
        source = await falImage(copy.imagePrompt, f.height > f.width, signal);
      } catch { simulated = true; source = null; }
    }

    step("Composing for " + f.label);
    const base = source ? await cropToFormat(source, f) : await gradientBase(f, product.title);
    const outName = `${id}.${f.kind === "image" ? "png" : "mp4"}`;
    const outFile = path.join(DATA_DIR, "outputs", outName);

    if (f.kind === "image") {
      await fs.writeFile(outFile, await composeImage(base, copy, f), { signal });
    } else {
      let video: Buffer | undefined;
      if (source) {
        step("Generating video (this can take a few minutes)");
        try { video = await falVideo(base, copy.imagePrompt, signal); } catch { simulated = true; }
      } else simulated = true;
      step("Rendering video");
      await makeVideo({ still: base, video, bannerPng: await banner(copy, f), f, outFile, signal });
    }
    if (signal.aborted) return; // the timer already marked the row failed; never overwrite with done
    updateJob(id, { status: "done", step: "Done", output_file: outName, simulated: simulated ? 1 : 0 });
  } catch (e) {
    if (signal.aborted) return;
    updateJob(id, { status: "failed", step: "Failed", error: friendlyError(e instanceof Error ? e.message : String(e)) });
    console.error(`[job ${id}]`, e);
  } finally { clearTimeout(timer); }
}
