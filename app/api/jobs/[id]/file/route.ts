import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { DATA_DIR, getJob } from "@/lib/db";
import { parseRange } from "@/lib/range";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const j = /^[0-9a-f-]{36}$/.test(id) ? getJob(id) : undefined;
  if (!j || j.status !== "done" || !j.output_file) return notFound();
  const name = path.basename(j.output_file);
  const file = path.join(DATA_DIR, "outputs", name);
  let size: number;
  try { size = (await fs.promises.stat(file)).size; } catch { return notFound(); } // expired by the sweep
  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "content-type": name.endsWith(".mp4") ? "video/mp4" : "image/png", "accept-ranges": "bytes", "x-content-type-options": "nosniff",
    ...(download ? { "content-disposition": `attachment; filename="${j.platform}-${id.slice(0, 8)}${path.extname(name)}"` } : {}),
  };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  const [start, end] = range ?? [0, size - 1];
  // Safari needs 206 + Content-Range to play MP4; stream instead of buffering the whole file.
  // (No content-length: Next strips it from route handler responses and sends chunked.)
  const body = size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, { status: range ? 206 : 200, headers: range ? { ...headers, "content-range": `bytes ${start}-${end}/${size}` } : headers });
}
