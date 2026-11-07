import { connection, NextResponse } from "next/server";
import { listJobs } from "@/lib/db";

export async function GET() {
  await connection();
  try { listJobs(1); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
