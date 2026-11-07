"use client";
import { useEffect, useRef, useState } from "react";
import { getFormat, getFormats, PLATFORMS, type Platform } from "@/lib/platforms";

interface JobView {
  id: string; status: "queued" | "processing" | "done" | "failed"; step: string | null; error: string | null;
  platform: string; format: { id: string; label: string; kind: "image" | "video"; width: number; height: number } | null;
  inputValue: string; copy: { headline: string; caption: string; hashtags: string[] } | null;
  simulated: boolean; fileUrl: string | null; createdAt: number;
}

const NAMES: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
const SAMPLE = "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html";
const STEPS = ["Reading product", "Writing copy", "Composing", "Rendering"];
const stepIndex = (s: string | null) => {
  const t = (s ?? "").toLowerCase();
  if (t.includes("render") || t.includes("generating video")) return 3;
  if (t.includes("compos") || t.includes("generating image")) return 2;
  if (t.includes("copy")) return 1;
  return 0;
};
const mss = (ms: number) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-ink pt-3">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-baseline gap-3 mb-3"><span className="label text-accent">{n}</span><h2 className="text-[15px] font-semibold">{title}</h2></div>
      {children}
    </fieldset>
  );
}

export default function Generator() {
  const [tab, setTab] = useState<"url" | "image">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<Platform>("instagram");
  const formats = getFormats(platform);
  const [formatId, setFormatId] = useState(formats[0].id);
  const [job, setJob] = useState<JobView | null>(null);
  const [recent, setRecent] = useState<JobView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const stage = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fmt = getFormat(formatId)!;

  const loadRecent = () => fetch("/api/jobs").then((r) => r.json()).then((d) => setRecent(d.jobs)).catch(() => {});
  useEffect(() => { loadRecent(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  const polling = useRef<string | null>(null);
  function stopPolling() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null; polling.current = null; setBusy(false);
  }
  function poll(id: string) {
    stopPolling();
    polling.current = id; setBusy(true);
    let misses = 0;
    const giveUp = (error: string) => { stopPolling(); setJob((p) => p && { ...p, status: "failed", error }); loadRecent(); };
    timer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${id}`);
        if (polling.current !== id) return; // a newer poll took over
        if (r.status === 404) return giveUp("This job no longer exists.");
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j: JobView = await r.json();
        if (polling.current !== id) return;
        misses = 0; setJob(j);
        if (j.status === "done" || j.status === "failed") { stopPolling(); loadRecent(); }
      } catch {
        if (polling.current === id && ++misses >= 5) giveUp("Lost contact with the server. Check Recent in a moment.");
      }
    }, 1500);
  }
  function openJob(j: JobView) {
    setJob(j);
    if (j.format) { setPlatform(j.platform as Platform); setFormatId(j.format.id); }
    if (j.status === "queued" || j.status === "processing") poll(j.id); else stopPolling();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const fd = new FormData();
    fd.set("platform", platform); fd.set("formatId", formatId);
    if (tab === "url") fd.set("url", url); else if (file) fd.set("file", file);
    stopPolling(); setBusy(true); setJob(null);
    try {
      const r = await fetch("/api/jobs", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Something went wrong"); setBusy(false); return; }
      stage.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setJob({ id: d.id, status: "queued", step: "Queued", format: fmt } as unknown as JobView); poll(d.id);
    } catch { setError("Could not reach the server."); setBusy(false); }
  }

  const canSubmit = !busy && (tab === "url" ? url.trim().length > 0 : !!file);
  const shown = job?.format ?? fmt;
  const ratio = `${shown.width} / ${shown.height}`;
  const working = job && job.status !== "done" && job.status !== "failed";
  const hashtags = job?.copy?.hashtags.map((h) => `#${h}`).join(" ") ?? "";
  const videoWorking = !!working && job.format?.kind === "video";
  useEffect(() => {
    if (!videoWorking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0), id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [videoWorking]);

  return (
    <div className="mx-auto max-w-[1180px] px-5 sm:px-8 pb-16">
      <header className="flex items-end justify-between border-b border-ink py-6">
        <h1 className="font-[family-name:var(--font-display)] text-[40px] leading-none">Reframe</h1>
        <p className="label hidden sm:block">Product page or photo, cut to platform spec</p>
      </header>

      <div className="grid lg:grid-cols-[400px_1fr] gap-10 lg:gap-14 pt-8">
        <form onSubmit={submit} className="space-y-8">
          <Step n="01" title="Source">
            <div role="tablist" className="flex gap-5 mb-3 border-b border-line">
              {([["url", "Product URL"], ["image", "Upload photo"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`pb-2 -mb-px text-sm border-b-2 ${tab === k ? "border-accent text-ink font-medium" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
              ))}
            </div>
            {tab === "url" ? (
              <div>
                <label htmlFor="u" className="sr-only">Product URL</label>
                <input id="u" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.com/products/…" inputMode="url"
                  className="w-full bg-card border border-line px-3 py-2.5 text-sm placeholder:text-muted/70 focus:border-ink outline-none" />
                <button type="button" onClick={() => setUrl(SAMPLE)} className="label mt-2 underline underline-offset-4 hover:text-ink">Use a sample page</button>
              </div>
            ) : (
              <label className="block border border-dashed border-muted bg-card px-3 py-5 text-sm cursor-pointer hover:border-ink">
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file ? <span className="font-medium">{file.name}</span> : <span className="text-muted">Choose an image (PNG, JPG, WebP, up to 10 MB)</span>}
              </label>
            )}
          </Step>

          <Step n="02" title="Platform">
            <div className="grid grid-cols-3 border border-ink">
              {PLATFORMS.map((p, i) => (
                <button key={p} type="button" aria-pressed={platform === p}
                  onClick={() => { setPlatform(p); setFormatId(getFormats(p)[0].id); }}
                  className={`py-2.5 text-sm ${i > 0 ? "border-l border-ink" : ""} ${platform === p ? "bg-ink text-paper" : "bg-card hover:bg-paper"}`}>{NAMES[p]}</button>
              ))}
            </div>
          </Step>

          <Step n="03" title="Format">
            <ul className="border-t border-line">
              {formats.map((f) => (
                <li key={f.id} className="border-b border-line">
                  <button type="button" aria-pressed={formatId === f.id} onClick={() => setFormatId(f.id)}
                    className={`w-full flex items-center gap-3 py-2.5 text-left text-sm ${formatId === f.id ? "text-ink" : "text-muted hover:text-ink"}`}>
                    <span className={`size-2 ${formatId === f.id ? "bg-accent" : "border border-muted"}`} aria-hidden />
                    <span className={formatId === f.id ? "font-semibold" : ""}>{f.label}</span>
                    <span className="label ml-auto">{f.kind} · {f.width}×{f.height}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Step>

          {error && <p role="alert" className="text-sm border-l-2 border-accent pl-3 text-accent">{error}</p>}
          <button disabled={!canSubmit}
            className="w-full bg-accent text-white py-3 text-sm font-semibold tracking-wide disabled:bg-line disabled:text-muted enabled:hover:bg-ink transition-colors">
            {busy ? "Working…" : `Generate ${fmt.kind}`}
          </button>
        </form>

        <section ref={stage} aria-live="polite" className="min-w-0 scroll-mt-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="label">Output · {shown.width}×{shown.height} · {shown.kind}</h2>
            {job?.status === "done" && job.fileUrl && (
              <a href={`${job.fileUrl}?download=1`} className="text-sm font-semibold underline underline-offset-4 decoration-accent decoration-2 hover:text-accent">Download</a>
            )}
          </div>

          <div className="bg-card border border-line p-6 sm:p-10 flex justify-center">
            <div className="relative w-full overflow-hidden bg-paper border border-ink"
              style={{ aspectRatio: ratio, maxHeight: 560, maxWidth: `calc(560px * ${shown.width} / ${shown.height})` }}>
              {job?.status === "done" && job.fileUrl ? (
                shown.kind === "video"
                  ? <video src={job.fileUrl} controls autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={job.fileUrl} alt={job.copy?.headline ?? "Generated content"} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 hatch flex flex-col items-center justify-center text-center p-6 gap-2">
                  {working ? (
                    <>
                      <p className="label text-ink">{job?.step ?? "Working"}</p>
                      <div className="w-32 h-px bg-line relative overflow-hidden"><div className="sweep absolute inset-y-0 w-1/3 bg-accent" /></div>
                    </>
                  ) : job?.status === "failed" ? (
                    <p role="alert" className="text-sm max-w-xs bg-card border border-accent px-3 py-2 text-accent">{job.error}</p>
                  ) : (
                    <p className="label bg-paper px-2">{shown.label} · {shown.width}×{shown.height}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {working && (
            <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Progress">
              {STEPS.map((s, i) => {
                const at = stepIndex(job.step);
                return <li key={s} className={`border-t-2 pt-1.5 label ${i < at ? "border-ink text-ink" : i === at ? "border-accent text-accent" : "border-line"}`}>{s}</li>;
              })}
            </ol>
          )}

          {videoWorking && (
            <div className="mt-3 flex items-baseline justify-between gap-4 text-sm text-muted">
              <p>{job.step === "Queued" ? "Waiting its turn for a free slot. " : ""}Video takes about 3 to 6 minutes. You can leave this tab open; it keeps running.</p>
              {job.createdAt > 0 && now > 0 && <span className="label text-ink tabular-nums shrink-0" aria-hidden>{mss(now - job.createdAt)}</span>}
            </div>
          )}

          {job?.status === "done" && job.copy && (
            <div className="mt-6 grid sm:grid-cols-[1fr_auto] gap-x-8 gap-y-2 border-t border-ink pt-4">
              <div>
                <p className="font-[family-name:var(--font-display)] text-3xl leading-tight">{job.copy.headline}</p>
                <p className="mt-2 text-sm whitespace-pre-wrap max-w-prose">{job.copy.caption}</p>
                <p className="mt-2 text-sm text-muted break-words">{hashtags}</p>
              </div>
              <button type="button" onClick={() => navigator.clipboard.writeText(`${job.copy!.caption}\n\n${hashtags}`)}
                className="label self-start border border-ink px-3 py-2 hover:bg-ink hover:text-paper">Copy caption</button>
              {job.simulated && <p className="label sm:col-span-2 text-accent">Fallback used: part of this output is simulated.</p>}
            </div>
          )}

          {recent.length > 0 && (
            <div className="mt-12">
              <h3 className="label mb-2">Recent</h3>
              <ul className="border-t border-ink">
                {recent.slice(0, 6).map((j) => (
                  <li key={j.id} className="border-b border-line">
                    <button type="button" onClick={() => openJob(j)} className="w-full flex items-baseline gap-4 py-2 text-sm text-left hover:bg-card">
                      <span className="w-24">{NAMES[j.platform]}</span>
                      <span className="text-muted">{j.format?.label}</span>
                      <span className="label ml-auto">{j.status === "failed" ? "failed" : j.status === "done" ? ago(j.createdAt) : j.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
