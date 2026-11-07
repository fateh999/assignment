import { fal } from "@fal-ai/client";
import { env } from "./env";

export const FAL_IMAGE_TIMEOUT_MS = 60_000; // generate + download
export const FAL_VIDEO_TIMEOUT_MS = 360_000; // upload + queue + generate + download

function init() {
  if (!env.falKey) throw new Error("FAL_KEY is not set");
  fal.config({ credentials: env.falKey });
}

/** Rejects as soon as `signal` aborts, even if `p` itself ignores the signal (e.g. storage upload). */
const until = <T,>(p: Promise<T>, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
  const onAbort = () => reject(signal.reason);
  if (signal.aborted) return onAbort();
  signal.addEventListener("abort", onAbort, { once: true });
  p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
});

async function download(url: string, max: number, signal: AbortSignal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Download failed ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > max) throw new Error("Generated file too large");
  return b;
}

export async function falImage(prompt: string, portrait: boolean, jobSignal: AbortSignal): Promise<Buffer> {
  init();
  const signal = AbortSignal.any([jobSignal, AbortSignal.timeout(FAL_IMAGE_TIMEOUT_MS)]);
  const res = await until(fal.subscribe(env.imageModel, {
    input: { prompt, image_size: portrait ? "portrait_16_9" : "landscape_16_9", num_images: 1 }, logs: false, abortSignal: signal,
  }), signal);
  const url = (res.data as { images?: { url: string }[] }).images?.[0]?.url;
  if (!url) throw new Error("fal returned no image");
  return download(url, 30_000_000, signal);
}

export async function falVideo(imageBuf: Buffer, prompt: string, jobSignal: AbortSignal): Promise<Buffer> {
  init();
  const signal = AbortSignal.any([jobSignal, AbortSignal.timeout(FAL_VIDEO_TIMEOUT_MS)]);
  const imageUrl = await until(fal.storage.upload(new Blob([new Uint8Array(imageBuf)], { type: "image/png" })), signal);
  const res = await until(fal.subscribe(env.videoModel, {
    input: { prompt: `${prompt}. Subtle cinematic camera motion.`, negative_prompt: "text, captions, watermark, logo, blur, distortion", image_url: imageUrl, duration: "5" },
    logs: false, abortSignal: signal,
  }), signal);
  const url = (res.data as { video?: { url: string } }).video?.url;
  if (!url) throw new Error("fal returned no video");
  return download(url, 100_000_000, signal);
}
