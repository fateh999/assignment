/** Turn internal error text into something a user can act on. */
export function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  const status = /status (\d{3})/.exec(m)?.[1];
  if (status === "404" || status === "410") return "That page wasn't found (404). Check the link and try again.";
  if (status === "401" || status === "403" || status === "429") return "The site blocked our request. Try another page, or upload the product photo instead.";
  if (status && status.startsWith("5")) return "The site had a server error. Try again in a moment.";
  if (m.includes("private or reserved") || m.includes("credentials") || m.includes("only http")) return "That address can't be used. Enter a public http(s) product link.";
  if (m.includes("invalid url")) return "That doesn't look like a valid link. Include https://.";
  if (m.includes("not an html")) return "That link isn't a web page. Paste a product page, or upload an image.";
  if (m.includes("could not find a product title")) return "We couldn't find a product on that page. Try the product's own page, or upload a photo.";
  if (m.includes("too large")) return "That file is too large to process.";
  if (m.includes("timed out") || m.includes("timeout") || m.includes("aborted")) return "This took too long and was stopped. Try again.";
  if (m.includes("openrouter") || m.includes("copy generation")) return "The caption service is unavailable right now. Try again shortly.";
  if (m.includes("ffmpeg")) return "Video rendering failed. Try an image format or try again.";
  if (m.includes("is not set")) return "A required API key is missing on the server.";
  if (m.includes("fetch failed") || m.includes("enotfound") || m.includes("econn")) return "We couldn't reach that site. Check the link and try again.";
  return "Something went wrong generating this. Try again.";
}
