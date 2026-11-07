import { NextResponse } from "next/server";
import { getJob } from "@/lib/db";
import { serializeJob } from "@/lib/serialize";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const j = /^[0-9a-f-]{36}$/.test(id) ? getJob(id) : undefined;
  if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(serializeJob(j));
}
