import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stableHash, sha256File } from "../job/hash.js";
import { npxInvocation, runProcess } from "../util/process.js";
function timestampToMs(value) {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
    if (!match)
        throw new Error(`Invalid SRT timestamp: ${value}`);
    const [, hours, minutes, seconds, milliseconds] = match;
    return (Number(hours) * 3_600_000 +
        Number(minutes) * 60_000 +
        Number(seconds) * 1_000 +
        Number(milliseconds));
}
export function parseSrt(source) {
    const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
    const blocks = normalized
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
    return blocks.map((block) => {
        const lines = block.split("\n");
        const index = Number(lines[0]);
        const timing = lines[1]?.match(/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/);
        const text = lines.slice(2).join("\n").trim();
        if (!Number.isInteger(index) || !timing || !text) {
            throw new Error(`Invalid SRT cue: ${block}`);
        }
        return {
            index,
            startMs: timestampToMs(timing[1]),
            endMs: timestampToMs(timing[2]),
            text,
        };
    });
}
export function validateCaptionCues(cues, audioDurationSeconds) {
    if (cues.length === 0)
        throw new Error("Caption file contains no cues");
    let previousEnd = 0;
    for (const cue of cues) {
        if (cue.endMs <= cue.startMs) {
            throw new Error(`Caption cue ${cue.index} has a non-positive duration`);
        }
        if (cue.startMs < previousEnd) {
            throw new Error(`Caption cue ${cue.index} overlaps the previous cue`);
        }
        previousEnd = cue.endMs;
    }
    if (previousEnd > audioDurationSeconds * 1_000 + 250) {
        throw new Error("Caption timeline exceeds audio duration");
    }
}
async function defaultProbeAudioDuration(path) {
    const result = await runProcess("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]);
    if (result.code !== 0) {
        throw new Error(`FFprobe failed for audio: ${result.stderr.trim()}`);
    }
    const duration = Number(result.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Audio duration is invalid");
    }
    return duration;
}
export class CaptionProvider {
    dependencies;
    stage = "captions";
    paid = false;
    constructor(dependencies = {
        run: runProcess,
        probeAudioDuration: defaultProbeAudioDuration,
    }) {
        this.dependencies = dependencies;
    }
    async inputHash(input) {
        return stableHash({
            audioSha256: await sha256File(input.audioPath),
            model: "large-v3",
            language: "zh",
            format: "srt",
            hyperframes: "0.7.71",
        });
    }
    async execute(input, _context) {
        await mkdir(dirname(input.outputPath), { recursive: true });
        const invocation = npxInvocation([
            "--yes",
            "hyperframes@0.7.71",
            "transcribe",
            input.audioPath,
            "--model=large-v3",
            "--language=zh",
            "--to=srt",
            `--output=${input.outputPath}`,
        ]);
        const result = await this.dependencies.run(invocation.command, invocation.args);
        if (result.code !== 0) {
            throw new Error(`Caption transcription failed: ${result.stderr.trim()}`);
        }
        const source = await readFile(input.outputPath, "utf8");
        const cues = parseSrt(source);
        validateCaptionCues(cues, await this.dependencies.probeAudioDuration(input.audioPath));
        return {
            artifacts: [
                {
                    path: input.outputPath,
                    sha256: await sha256File(input.outputPath),
                    mediaType: "application/x-subrip",
                },
            ],
            metadata: {
                provider: "hyperframes-transcribe",
                model: "large-v3",
                language: "zh",
                cueCount: cues.length,
            },
        };
    }
}
