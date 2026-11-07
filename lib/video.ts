import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Bundlers can rewrite the static path; fall back to the real node_modules location.
const ffmpegPath = ffmpegStatic && ffmpegStatic.startsWith("/ROOT") ? path.join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg") : ffmpegStatic;
import type { Format } from "./platforms";
import { VIDEO_SECONDS } from "./platforms";

export const FFMPEG_TIMEOUT_MS = 120_000;

/** Runs ffmpeg; the process is killed when `signal` aborts (job budget or step timeout). */
function run(args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not available"));
    const p = spawn(ffmpegPath, ["-y", "-loglevel", "error", ...args], { signal, killSignal: "SIGKILL" });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(signal.aborted ? new Error("ffmpeg timed out") : e));
    p.on("close", (c) => { if (c === 0) resolve(); else reject(new Error(`ffmpeg failed: ${err.slice(-300)}`)); });
  });
}

/** Ken Burns (zoom) clip from a still. If `source` is a video buffer, it is cropped/scaled instead. */
export async function makeVideo(opts: { still: Buffer; video?: Buffer; bannerPng: Buffer; f: Format; outFile: string; signal: AbortSignal }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sg-"));
  try {
    const { f } = opts, fps = 30, secs = VIDEO_SECONDS;
    const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(FFMPEG_TIMEOUT_MS)]);
    const ban = path.join(dir, "banner.png"); await fs.writeFile(ban, opts.bannerPng);
    const common = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", opts.outFile];
    if (opts.video) {
      const vid = path.join(dir, "in.mp4"); await fs.writeFile(vid, opts.video);
      await run(["-i", vid, "-i", ban, "-filter_complex",
        `[0:v]scale=${f.width}:${f.height}:force_original_aspect_ratio=increase,crop=${f.width}:${f.height},fps=${fps},setsar=1[v];[v][1:v]overlay=0:0,trim=duration=${secs}`, ...common], signal);
    } else {
      const img = path.join(dir, "in.png"); await fs.writeFile(img, opts.still);
      const frames = secs * fps;
      await run(["-loop", "1", "-i", img, "-i", ban, "-filter_complex",
        `[0:v]scale=${f.width * 2}:${f.height * 2},zoompan=z='min(zoom+0.0007,1.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${f.width}x${f.height}:fps=${fps}[v];[v][1:v]overlay=0:0,format=yuv420p`,
        "-frames:v", String(frames), ...common], signal);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
