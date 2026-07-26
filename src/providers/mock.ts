import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ProviderContext,
  StageProvider,
  StageResult,
} from "../contracts.js";
import { stableHash, sha256File } from "../job/hash.js";
import { runProcess } from "../util/process.js";
import type { CaptionInput } from "./captions.js";
import type { FishTtsInput } from "./fish-audio.js";
import type { HeyGenInput } from "./heygen.js";

async function requireProcess(
  command: string,
  args: string[],
  label: string,
): Promise<void> {
  const result = await runProcess(command, args);
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim()}`);
  }
}

export class MockVoiceProvider implements StageProvider<FishTtsInput> {
  readonly stage = "voice" as const;
  readonly paid = false;

  async inputHash(input: FishTtsInput): Promise<string> {
    return stableHash({ mock: "voice-v1", ...input });
  }

  async execute(
    input: FishTtsInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    await mkdir(dirname(input.outputPath), { recursive: true });
    await requireProcess(
      "ffmpeg",
      [
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
      ],
      "Mock voice generation",
    );
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

export class MockAvatarProvider implements StageProvider<HeyGenInput> {
  readonly stage = "avatar" as const;
  readonly paid = false;

  async inputHash(input: HeyGenInput): Promise<string> {
    return stableHash({
      mock: "avatar-v1",
      avatarId: input.avatarId,
      audio: await sha256File(input.audioPath),
      width: input.width,
      height: input.height,
    });
  }

  async execute(
    input: HeyGenInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    await mkdir(dirname(input.outputPath), { recursive: true });
    await requireProcess(
      "ffmpeg",
      [
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
      ],
      "Mock avatar generation",
    );
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

export class MockCaptionProvider implements StageProvider<CaptionInput> {
  readonly stage = "captions" as const;
  readonly paid = false;

  constructor(private readonly narration: string) {}

  async inputHash(input: CaptionInput): Promise<string> {
    return stableHash({
      mock: "captions-v1",
      narration: this.narration,
      audio: await sha256File(input.audioPath),
    });
  }

  async execute(
    input: CaptionInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
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
