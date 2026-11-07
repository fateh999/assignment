import sharp from "sharp";
import type { Copy } from "./openrouter";
import type { Format } from "./platforms";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = []; let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const k = lines.slice(0, maxLines); k[maxLines - 1] = k[maxLines - 1].replace(/.{0,2}$/, "…"); return k; }
  return lines;
}

/** Transparent PNG with gradient + headline, exactly format-sized. */
export async function banner(copy: Copy, f: Format): Promise<Buffer> {
  const size = Math.round(f.width * 0.058);
  const clean = copy.headline.replace(/[^\p{L}\p{N}\p{P}\p{Zs}$%&+=]/gu, "").trim() || "New";
  const lines = wrap(clean, Math.floor((f.width * 0.84) / (size * 0.55)), 3);
  const blockH = lines.length * size * 1.2 + size * 2;
  const y0 = f.height - blockH - Math.round(f.height * 0.06);
  const text = lines.map((l, i) => `<text x="${f.width / 2}" y="${y0 + size * 1.3 + i * size * 1.2}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff">${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f.width}" height="${f.height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient></defs>
    <rect x="0" y="${y0 - size}" width="${f.width}" height="${f.height - y0 + size}" fill="url(#g)"/>${text}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function gradientBase(f: Format, seed: string): Promise<Buffer> {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f.width}" height="${f.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,45%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,25%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Decode cap for untrusted (scraped/remote/generated) images: rejects decompression bombs. */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Cover-crop any image to the exact platform dimensions. */
export async function cropToFormat(src: Buffer, f: Format): Promise<Buffer> {
  return sharp(src, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(f.width, f.height, { fit: "cover", position: "attention" }).png().toBuffer();
}

export async function composeImage(base: Buffer, copy: Copy, f: Format): Promise<Buffer> {
  return sharp(base).composite([{ input: await banner(copy, f) }]).png().toBuffer();
}
