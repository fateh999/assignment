import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicUrl, safeFetch } from "../lib/ssrf";

afterEach(() => vi.restoreAllMocks());

describe("assertPublicUrl", () => {
  it("rejects IPv4-mapped / compat IPv6 literals after URL normalisation", async () => {
    for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/", "http://[::127.0.0.1]/", "http://0x7f.1/"])
      await expect(assertPublicUrl(u), u).rejects.toThrow(/private or reserved/);
  });
  it("rejects hostnames resolving to private addresses", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    await expect(assertPublicUrl("https://intranet.example/")).rejects.toThrow(/private or reserved/);
  });
});

describe("safeFetch DNS rebinding", () => {
  it("re-checks the address at connect time, so a host that turns private is never contacted", async () => {
    let hits = 0;
    const server = http.createServer((_, res) => { hits++; res.end("secret"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    // first answer (validation) is public, second (connect) is loopback
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }])) as never);
    try {
      const err = await safeFetch(`http://rebind.example:${port}/`, { maxBytes: 1000 }).catch((e) => e);
      expect(String(err?.cause?.message ?? err?.message)).toMatch(/private or reserved/);
      expect(hits).toBe(0);
    } finally { server.close(); }
  });
});
