import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stableHash, sha256File } from "../job/hash.js";
import { runProcess } from "../util/process.js";
async function requireProcess(command, args, label) {
    const result = await runProcess(command, args);
    if (result.code !== 0) {
        throw new Error(`${label} failed: ${result.stderr.trim()}`);
    }
}
export class MockVoiceProvider {
    stage = "voice";
    paid = false;
    async inputHash(input) {
        return stableHash({ mock: "voice-v1", ...input });
    }
    async execute(input, _context) {
        await mkdir(dirname(input.outputPath), { recursive: true });
        await requireProcess("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            "5",
            "-c:a",
            "libmp3lame",
            "-y",
            input.outputPath,
        ], "Mock voice generation");
        return {
            artifacts: [
                {
                    path: input.outputPath,
                    sha256: await sha256File(input.outputPath),
                    mediaType: "audio/mpeg",
                },
            ],
            metadata: { provider: "mock", durationSeconds: 5 },
        };
    }
}
export class MockAvatarProvider {
    stage = "avatar";
    paid = false;
    async inputHash(input) {
        return stableHash({
            mock: "avatar-v1",
            avatarId: input.avatarId,
            audio: await sha256File(input.audioPath),
            width: input.width,
            height: input.height,
        });
    }
    async execute(input, _context) {
        await mkdir(dirname(input.outputPath), { recursive: true });
        await requireProcess("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${input.width}x${input.height}:rate=30:duration=5`,
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-y",
            input.outputPath,
        ], "Mock avatar generation");
        return {
            artifacts: [
                {
                    path: input.outputPath,
                    sha256: await sha256File(input.outputPath),
                    mediaType: "video/mp4",
                },
            ],
            metadata: { provider: "mock", avatarId: input.avatarId },
        };
    }
}
export class MockCaptionProvider {
    narration;
    stage = "captions";
    paid = false;
    constructor(narration) {
        this.narration = narration;
    }
    async inputHash(input) {
        return stableHash({
            mock: "captions-v1",
            narration: this.narration,
            audio: await sha256File(input.audioPath),
        });
    }
    async execute(input, _context) {
        await mkdir(dirname(input.outputPath), { recursive: true });
        const midpoint = Math.max(1, Math.floor(this.narration.length / 2));
        const first = this.narration.slice(0, midpoint).trim();
        const second = this.narration.slice(midpoint).trim() || first;
        const source = `1
00:00:00,000 --> 00:00:02,400
${first}

2
00:00:02,400 --> 00:00:04,900
${second}
`;
        await writeFile(input.outputPath, source, "utf8");
        return {
            artifacts: [
                {
                    path: input.outputPath,
                    sha256: await sha256File(input.outputPath),
                    mediaType: "application/x-subrip",
                },
            ],
            metadata: { provider: "mock", cueCount: 2 },
        };
    }
}
