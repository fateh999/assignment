import * as cheerio from "cheerio";
import { safeFetch } from "./ssrf";

export interface Product { url: string; title: string; description: string; price?: string; imageUrl?: string }

export async function scrapeProduct(url: string, signal: AbortSignal): Promise<Product> {
  const { buffer, contentType, url: finalUrl } = await safeFetch(url, { maxBytes: 3_000_000, accept: "text/html", signal });
  if (!/html/i.test(contentType)) throw new Error("URL is not an HTML page");
  const $ = cheerio.load(buffer.toString("utf8"));
  const meta = (n: string) => $(`meta[property="${n}"],meta[name="${n}"]`).attr("content")?.trim();
  const title = meta("og:title") || $("title").first().text().trim() || $("h1").first().text().trim();
  if (!title) throw new Error("Could not find a product title on that page");
  const description = (meta("og:description") || meta("description") || "").slice(0, 600);
  const price = meta("product:price:amount") ? `${meta("product:price:amount")} ${meta("product:price:currency") ?? ""}`.trim() : undefined;
  const img = meta("og:image") || $("img").first().attr("src");
  let imageUrl: string | undefined;
  try { if (img) imageUrl = new URL(img, finalUrl).toString(); } catch {}
  return { url: finalUrl, title: title.slice(0, 200), description, price, imageUrl };
}
