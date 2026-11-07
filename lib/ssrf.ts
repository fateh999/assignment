import dns, { type LookupAddress } from "node:dns";
import net from "node:net";
import { Agent, fetch } from "undici";

// IANA special-purpose ranges. BlockList also matches IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 rules.
const blocked = new net.BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 96], // unspecified, loopback, IPv4-compatible (::a.b.c.d)
  ["::ffff:0:0:0", 96], // IPv4-translated
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], // NAT64
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], // discard, IETF/Teredo, docs, 6to4
  ["3fff::", 20], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(ip, bits, "ipv6");

export function isPrivateIp(ip: string): boolean {
  const type = net.isIP(ip);
  return type === 0 || blocked.check(ip, type === 4 ? "ipv4" : "ipv6");
}

const PRIVATE = "URL resolves to a private or reserved address";

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error(PRIVATE);
  return u;
}

/** net.connect lookup that refuses private addresses, so the IP we check is the IP we connect to (no DNS rebinding). */
export function safeLookup(host: string, opts: dns.LookupOptions, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) {
  dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, []);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error(PRIVATE), []);
    if (opts.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
  });
}
const agent = new Agent({ connect: { lookup: safeLookup } });

/** fetch with timeout, size cap and per-hop SSRF check on redirects */
export async function safeFetch(raw: string, opts: { maxBytes: number; timeoutMs?: number; accept?: string; signal?: AbortSignal }) {
  // one deadline for all hops and the body, plus the caller's (job) signal
  const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 15000), ...(opts.signal ? [opts.signal] : [])]);
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublicUrl(url);
    const res = await fetch(u, {
      redirect: "manual", signal, dispatcher: agent,
      headers: { "user-agent": "Mozilla/5.0 (compatible; SocialGenBot/1.0)", accept: opts.accept ?? "*/*" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, u).toString();
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Fetch failed with status ${res.status}`); }
    if (Number(res.headers.get("content-length") || 0) > opts.maxBytes) { await res.body?.cancel(); throw new Error("Remote file too large"); }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > opts.maxBytes) { await reader.cancel(); throw new Error("Remote file too large"); }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType: res.headers.get("content-type") || "", url };
  }
  throw new Error("Too many redirects");
}
