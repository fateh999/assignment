export const env = {
  get openrouterKey() { return process.env.OPENROUTER_API_KEY || ""; },
  get falKey() { return process.env.FAL_KEY || ""; },
  get textModel() { return process.env.OPENROUTER_TEXT_MODEL || "anthropic/claude-sonnet-4.5"; },
  get imageModel() { return process.env.FAL_IMAGE_MODEL || "fal-ai/flux/schnell"; },
  get videoModel() { return process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video"; },
};
