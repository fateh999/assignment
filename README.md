# Social Content Generator

Turn a product URL or an uploaded image into platform-ready social content (image or video) for Instagram, TikTok or YouTube.

## Run locally
```bash
bun install
cp .env.example .env.local   # fill in OPENROUTER_API_KEY and FAL_KEY
bun run dev                  # http://localhost:3000
bun run test                 # unit tests (vitest)
bun run lint && bun run typecheck && bun run build
```
Requires Bun 1.4+ (package manager and script runner) and Node 22+ (runs Next and vitest; uses built-in `node:sqlite`). ffmpeg is bundled via `ffmpeg-static`.
Next runs on Node rather than the Bun runtime on purpose: Bun ignores the connect-time `lookup` hook the SSRF guard relies on, so the DNS-rebinding test fails under `bun --bun`, and Cache Components is only supported on Node.

## Docker
```bash
docker compose up --build   # http://localhost:3000, reads .env.local, data persists in the `appdata` volume
```
The image installs and builds with Bun (`bun install --frozen-lockfile`, binary from `oven/bun:1.4.4`) and runs `next start` on Node 24, non-root, with a `/api/health` healthcheck. Keys are passed at runtime, never baked into the image. Deploy target (Railway) runs this same Dockerfile with a Railway Volume mounted at `/app/data`. Railway mounts volumes as root, so set `RAILWAY_RUN_UID=0` on the service or the non-root `node` user cannot write to it.

## Flow
1. `POST /api/jobs` (multipart: `platform`, `formatId`, and `url` or `file`) validates input, stores a job in SQLite and returns `202 {id}`.
2. The pipeline runs in the background (`after()`): scrape page (SSRF-guarded) -> OpenRouter writes headline/caption/hashtags (zod-validated JSON) -> source image (page `og:image`, upload, or fal.ai FLUX if none) -> `sharp` cover-crops to exact platform size and overlays the headline.
3. Video formats: fal.ai image-to-video (Kling) -> ffmpeg scales/crops to the format and overlays the headline. If fal fails, a local Ken Burns zoom clip is rendered instead and the job is flagged `simulated`.
4. UI polls `GET /api/jobs/:id`, then previews and offers `GET /api/jobs/:id/file?download=1`.

## Real vs simulated
- Real: scraping, copy (OpenRouter), image/video generation (fal.ai), cropping, overlay, persistence, download.
- Simulated only as a fallback: gradient background when no image is available and fal is down; local Ken Burns video when fal video fails. Fallback use is surfaced in the UI.

## Decisions
- Next.js App Router, route handlers, no separate backend. Tailwind v4 via `@tailwindcss/postcss`. SQLite (`node:sqlite`) keeps local setup to zero services.
- Job table with explicit statuses so failures and timeouts are visible and persisted. 12-minute job cap: one `AbortController` per job cancels every network step and kills ffmpeg; step timeouts add up to ~11 min for the worst-case video job.
- Cost guards (`lib/limits.ts`, env-overridable): 10 jobs / 10 min per client IP, 200 jobs and 20 videos per rolling 24 h, checked and inserted in one SQLite transaction. At most 2 jobs run at once; the rest stay `queued`.
- Security: keys server-side only; SSRF checks on every redirect hop (private/reserved IPv4/IPv6 incl. mapped, NAT64 and 6to4 blocked via `net.BlockList`) and again at connect time (undici `Agent` lookup), so DNS rebinding cannot swap in a private IP; size/time caps on fetches; request bodies over 11 MB rejected before parsing; image decodes capped at 50 MP; uploads re-encoded through `sharp`; file names derived from UUIDs; scraped text passed to the LLM as data.
- Files in `data/uploads` and `data/outputs` are deleted after 7 days (at boot and hourly); the job stays in history without a download.

## Known limits
- Upload copy relies on the vision model reading the photo; it only describes what is visible (no price or brand context).
- Overlay text needs fontconfig plus a Helvetica/Arial-compatible font on the host (the Docker image installs `fonts-liberation`); without them headlines render as empty boxes. Emoji are stripped from overlay text.
- Deployment: container with a persistent volume at `/app/data`. Single instance (SQLite); scaling out needs Postgres + object storage.

## Known issues and trade-offs
- No auth, so limits are per client IP taken from the first `x-forwarded-for` hop. That header is client-controlled unless the proxy in front overwrites it; the daily caps are the hard backstop. Without the header all clients share one bucket.
- Jobs run in-process (`after()`), single instance. A restart or deploy kills in-flight jobs; they are marked failed when the database next opens. Queued jobs wait in memory, so they are lost on restart too.
- A job that times out may still be billed by fal: aborting cancels our request, but fal may finish a generation it already started.
- Output files expire after 7 days; old jobs then show without a preview or download.
- Next.js strips `Content-Length` from route handler responses, so file downloads (including 206 range responses) are sent chunked. Range playback was checked with curl, not on a real iOS device.
- Video upload as an input is out of scope for the MVP: it needs large uploads, transcoding and validation of arbitrary video, while a product photo already covers the core flow.
- `output: "standalone"` is not used: the image ships full `node_modules` so `sharp`, `ffmpeg-static` and fonts resolve exactly as in development.

## Next
Per-user auth and quotas, a real queue (e.g. Inngest/QStash), brand templates, caption burn-in with timing, scheduling/publishing to platforms.
