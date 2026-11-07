import type { Job } from "./db";
import { getFormat } from "./platforms";

export function serializeJob(j: Job) {
  const f = getFormat(j.format_id);
  return {
    id: j.id, status: j.status, step: j.step, error: j.error, platform: j.platform, format: f ?? null,
    inputType: j.input_type, inputValue: j.input_type === "url" ? j.input_value : "uploaded image",
    copy: j.copy_json ? JSON.parse(j.copy_json) : null, simulated: !!j.simulated,
    fileUrl: j.status === "done" && j.output_file ? `/api/jobs/${j.id}/file` : null, createdAt: j.created_at,
  };
}
