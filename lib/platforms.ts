export type Platform = "instagram" | "tiktok" | "youtube";
export type Kind = "image" | "video";
export interface Format { id: string; platform: Platform; label: string; kind: Kind; width: number; height: number }

export const FORMATS: Format[] = [
  { id: "ig-post-square", platform: "instagram", label: "Post 1:1", kind: "image", width: 1080, height: 1080 },
  { id: "ig-post-portrait", platform: "instagram", label: "Post 4:5", kind: "image", width: 1080, height: 1350 },
  { id: "ig-story", platform: "instagram", label: "Story 9:16", kind: "image", width: 1080, height: 1920 },
  { id: "ig-reel", platform: "instagram", label: "Reel 9:16", kind: "video", width: 1080, height: 1920 },
  { id: "tt-photo", platform: "tiktok", label: "Photo 9:16", kind: "image", width: 1080, height: 1920 },
  { id: "tt-video", platform: "tiktok", label: "Video 9:16", kind: "video", width: 1080, height: 1920 },
  { id: "yt-thumb", platform: "youtube", label: "Thumbnail 16:9", kind: "image", width: 1280, height: 720 },
  { id: "yt-short", platform: "youtube", label: "Short 9:16", kind: "video", width: 1080, height: 1920 },
  { id: "yt-video", platform: "youtube", label: "Video 16:9", kind: "video", width: 1920, height: 1080 },
];

export const getFormats = (p: Platform) => FORMATS.filter((f) => f.platform === p);
export const getFormat = (id: string) => FORMATS.find((f) => f.id === id);
export const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube"];
export const VIDEO_SECONDS = 6;
