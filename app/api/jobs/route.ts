import { after } from "next/server";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { DATA_DIR, createJob, listJobs, updateJob } from "@/lib/db";
import { getFormat, PLATFORMS } from "@/lib/platforms";
import { assertPublicUrl } from "@/lib/ssrf";
import { friendlyError } from "@/lib/errors";
import { startJob } from "@/lib/pipeline";
import { serializeJob } from "@/lib/serialize";
import { MAX_INPUT_PIXELS } from "@/lib/compose";
import { clientIp } from "@/lib/limits";

// Covers JOB_TIMEOUT_MS (12 min) plus a little queue time, for platforms that enforce it.
export const maxDuration = 780;
const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_BODY = MAX_UPLOAD + 1024 * 1024; // upload + multipart overhead

const Base = z.object({ platform: z.enum(PLATFORMS as [string, ...string[]]), formatId: z.string() });
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() { return NextResponse.json({ jobs: listJobs().map(serializeJob) }); }

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return fail("Image too large (max 10 MB)", 413);
  let fd: FormData;
  try { fd = await req.formData(); } catch { return fail("Expected multipart form data"); }
  const base = Base.safeParse({ platform: fd.get("platform"), formatId: fd.get("formatId") });
  if (!base.success) return fail("Invalid platform or format");
  const fmt = getFormat(base.data.formatId);
  if (!fmt || fmt.platform !== base.data.platform) return fail("Format does not belong to that platform");

  const id = crypto.randomUUID();
  const url = fd.get("url"), file = fd.get("file");
  let input_type: "url" | "image", input_value: string, png: Buffer | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD) return fail("Image too large (max 10 MB)");
    try { png = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_INPUT_PIXELS }).rotate().png().toBuffer(); }
    catch { return fail("File is not a valid image (PNG, JPG, WebP, GIF)"); }
    input_type = "image"; input_value = `${id}.png`;
  } else if (typeof url === "string" && url.trim()) {
    try { await assertPublicUrl(url.trim()); } catch (e) { return fail(friendlyError(e instanceof Error ? e.message : "")); }
    input_type = "url"; input_value = url.trim();
  } else return fail("Provide a product URL or an image");

  // limits are checked and the row inserted atomically, after all awaits
  const limited = createJob({ id, input_type, input_value, platform: base.data.platform, format_id: fmt.id }, clientIp(req));
  if (limited) return fail(limited, 429);
  if (png) {
    try { await fs.writeFile(path.join(DATA_DIR, "uploads", input_value), png); }
    catch (e) {
      console.error(`[job ${id}] upload write`, e);
      updateJob(id, { status: "failed", step: "Failed", error: friendlyError("") });
      return fail("Could not save the upload. Try again.", 500);
    }
  }
  after(() => startJob(id));
  return NextResponse.json({ id }, { status: 202 });
}
