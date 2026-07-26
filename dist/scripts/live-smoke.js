import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runVideoJob } from "../src/commands/run.js";
if (process.env.VIDEO_AGENT_LIVE_SMOKE !== "1") {
    throw new Error("Set VIDEO_AGENT_LIVE_SMOKE=1 to authorize a paid smoke test");
}
if (!process.env.FISH_AUDIO_API_KEY || !process.env.HEYGEN_API_KEY) {
    throw new Error("Live smoke test requires Fish Audio and HeyGen API keys");
}
const workingDir = await mkdtemp(join(tmpdir(), "video-agent-live-smoke-"));
const scriptPath = join(workingDir, "script.md");
await writeFile(scriptPath, `---
title: 角马迁徙的真正原因
hook: 角马迁徙，并不是为了躲避狮子。
facts:
  - 它们追逐的是雨水和新鲜牧草。
cover_time_seconds: 1.5
---

角马迁徙，并不是为了躲避狮子。它们真正追逐的，是雨水之后长出的新鲜牧草。降雨改变，迁徙的时间和路线也会跟着变化。
`, "utf8");
const result = await runVideoJob(scriptPath, {
    speed: 1.3,
    outputDir: join(workingDir, "runs"),
});
process.stdout.write(`${JSON.stringify({ jobId: result.jobId, outputDir: result.outputDir }, null, 2)}\n`);
