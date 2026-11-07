import { describe, expect, it } from "vitest";
import { FORMATS, getFormats, getFormat } from "../lib/platforms";
import { clientIp, createLimiter } from "../lib/limits";
import { parseRange } from "../lib/range";
import { isPrivateIp } from "../lib/ssrf";
import { wrap } from "../lib/compose";
import { CopySchema } from "../lib/openrouter";

describe("platforms", () => {
  it("each platform has formats; ids are unique", () => {
    for (const p of ["instagram", "tiktok", "youtube"] as const) expect(getFormats(p).length).toBeGreaterThan(0);
    expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
  });
  it("vertical formats are 9:16, thumbnail is 16:9", () => {
    expect(getFormat("tt-video")).toMatchObject({ width: 1080, height: 1920 });
    expect(getFormat("yt-thumb")).toMatchObject({ width: 1280, height: 720 });
  });
});
describe("ssrf", () => {
  it("flags private ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255",
      "::", "::1", "fd00::1", "fe80::1", "fec0::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1",
      "64:ff9b::7f00:1", "2002:7f00:1::1", "2001::1", "not-an-ip"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "::ffff:808:808", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});
describe("compose", () => {
  it("wraps and truncates", () => {
    expect(wrap("a b c d e f g h", 5, 2).length).toBe(2);
  });
});
describe("copy schema", () => {
  it("rejects bad shape", () => {
    expect(CopySchema.safeParse({ headline: "x" }).success).toBe(false);
    expect(CopySchema.safeParse({ headline: "h", caption: "c", hashtags: ["a"], imagePrompt: "p" }).success).toBe(true);
  });
});
import { friendlyError } from "../lib/errors";
describe("friendlyError", () => {
  it("maps known failures and hides internals", () => {
    expect(friendlyError("Fetch failed with status 404")).toMatch(/wasn't found/);
    expect(friendlyError("URL resolves to a private or reserved address")).toMatch(/can't be used/);
    expect(friendlyError("spawn /ROOT/x ENOENT")).toBe("Something went wrong generating this. Try again.");
  });
});

describe("createLimiter", () => {
  it("runs at most `max` tasks at once, FIFO, and frees slots on failure", async () => {
    const run = createLimiter(2);
    let active = 0, peak = 0;
    const order: number[] = [];
    const task = (i: number, fail = false) => run(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--; order.push(i);
      if (fail) throw new Error("x");
    });
    await Promise.allSettled([task(1, true), task(2), task(3), task(4), task(5)]);
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});
describe("clientIp", () => {
  it("uses the first x-forwarded-for hop, else a shared bucket", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": " 1.2.3.4 , 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
describe("parseRange", () => {
  it("handles open, closed, suffix, invalid and absent ranges", () => {
    expect(parseRange("bytes=0-", 100)).toEqual([0, 99]);
    expect(parseRange("bytes=0-1", 100)).toEqual([0, 1]);
    expect(parseRange("bytes=10-500", 100)).toEqual([10, 99]);
    expect(parseRange("bytes=-10", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});
