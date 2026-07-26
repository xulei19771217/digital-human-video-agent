import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import type {
  ProviderContext,
  StageProvider,
  StageResult,
} from "../contracts.js";
import { stableHash, sha256File } from "../job/hash.js";
import { AmbiguousPaidRequestError } from "../job/engine.js";
import { requireOk } from "../util/http.js";
import { runProcess } from "../util/process.js";

const API_BASE = "https://api.heygen.com";
const UPLOAD_ENDPOINT = "https://upload.heygen.com/v1/asset";
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 15_000];

const HeyGenInputSchema = z.object({
  title: z.string().trim().min(1),
  avatarId: z.string().trim().min(1),
  audioPath: z.string().min(1),
  outputPath: z.string().min(1),
  width: z.literal(720),
  height: z.literal(1280),
});

const AvatarListSchema = z.object({
  data: z.object({
    avatars: z.array(
      z.object({
        avatar_id: z.string(),
        avatar_name: z.string().catch("Untitled avatar"),
      }),
    ),
  }),
});

const UploadSchema = z.object({
  code: z.literal(100),
  data: z.object({
    id: z.string().min(1),
    url: z.string().url(),
  }),
});

const GenerateSchema = z.object({
  data: z.object({ video_id: z.string().min(1) }),
});

const StatusSchema = z.object({
  data: z.object({
    status: z.string(),
    video_url: z.string().url().optional(),
    error: z.unknown().optional(),
  }),
});

export interface HeyGenInput {
  title: string;
  avatarId: string;
  audioPath: string;
  outputPath: string;
  width: 720;
  height: 1280;
}

interface ProbeResult {
  streams: Array<{
    codec_type?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
  }>;
}

export interface HeyGenDependencies {
  fetcher: typeof fetch;
  persistProviderTaskId(providerTaskId: string): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
  probeVideo(path: string): Promise<ProbeResult>;
  maxPolls?: number;
}

async function defaultProbeVideo(path: string): Promise<ProbeResult> {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height",
    "-of",
    "json",
    path,
  ]);
  if (result.code !== 0) {
    throw new Error(`FFprobe rejected HeyGen video: ${result.stderr.trim()}`);
  }
  return z
    .object({
      streams: z.array(
        z.object({
          codec_type: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
    })
    .parse(JSON.parse(result.stdout));
}

function defaultDependencies(
  persistProviderTaskId: (providerTaskId: string) => Promise<void>,
): HeyGenDependencies {
  return {
    fetcher: fetch,
    persistProviderTaskId,
    sleep: async (milliseconds) =>
      await new Promise((resolve) => setTimeout(resolve, milliseconds)),
    probeVideo: defaultProbeVideo,
    maxPolls: 120,
  };
}

export class HeyGenProvider implements StageProvider<HeyGenInput> {
  readonly stage = "avatar" as const;
  readonly paid = true;
  private readonly dependencies: HeyGenDependencies;

  constructor(
    private readonly apiKey: string,
    dependencies:
      | HeyGenDependencies
      | ((providerTaskId: string) => Promise<void>),
  ) {
    if (!apiKey.trim()) throw new Error("HeyGen API Key is required");
    this.dependencies =
      typeof dependencies === "function"
        ? defaultDependencies(dependencies)
        : dependencies;
  }

  private headers(): Record<string, string> {
    return { "X-Api-Key": this.apiKey };
  }

  async validate(): Promise<void> {
    await this.listAvatars();
  }

  async listAvatars(): Promise<Array<{ id: string; name: string }>> {
    const endpoint = `${API_BASE}/v2/avatars`;
    const response = await this.dependencies.fetcher(endpoint, {
      method: "GET",
      headers: this.headers(),
    });
    await requireOk(response, endpoint);
    const parsed = AvatarListSchema.parse(await response.json());
    return parsed.data.avatars.map((avatar) => ({
      id: avatar.avatar_id,
      name: avatar.avatar_name,
    }));
  }

  async inputHash(input: HeyGenInput): Promise<string> {
    const value = HeyGenInputSchema.parse(input);
    return stableHash({
      avatarId: value.avatarId,
      audioSha256: await sha256File(value.audioPath),
      width: value.width,
      height: value.height,
      style: "normal",
      scale: 1,
      background: "#1D1A17",
    });
  }

  private async retryFetch(
    endpoint: string,
    init?: RequestInit,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.dependencies.fetcher(endpoint, init);
      } catch (error) {
        lastError = error;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await this.dependencies.sleep(delay);
      }
    }
    throw lastError;
  }

  private async uploadAudio(audioPath: string): Promise<string> {
    const audio = await readFile(audioPath);
    if (audio.byteLength === 0) throw new Error("HeyGen input audio is empty");
    const response = await this.retryFetch(UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "audio/mpeg",
      },
      body: audio,
    });
    await requireOk(response, UPLOAD_ENDPOINT);
    return UploadSchema.parse(await response.json()).data.id;
  }

  private async generate(
    input: HeyGenInput,
    audioAssetId: string,
  ): Promise<string> {
    const endpoint = `${API_BASE}/v2/video/generate`;
    let response: Response;
    try {
      response = await this.dependencies.fetcher(endpoint, {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: input.title,
          caption: false,
          dimension: { width: input.width, height: input.height },
          video_inputs: [
            {
              character: {
                type: "avatar",
                avatar_id: input.avatarId,
                avatar_style: "normal",
                scale: 1,
              },
              voice: {
                type: "audio",
                audio_asset_id: audioAssetId,
              },
              background: {
                type: "color",
                value: "#1D1A17",
              },
            },
          ],
        }),
      });
    } catch (error) {
      throw new AmbiguousPaidRequestError(
        `HeyGen generation outcome is unknown: ${(error as Error).message}`,
      );
    }
    await requireOk(response, endpoint);
    return GenerateSchema.parse(await response.json()).data.video_id;
  }

  private async waitForVideo(providerTaskId: string): Promise<string> {
    const endpoint = `${API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(providerTaskId)}`;
    const maxPolls = this.dependencies.maxPolls ?? 120;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const response = await this.retryFetch(endpoint, {
        method: "GET",
        headers: this.headers(),
      });
      await requireOk(response, endpoint);
      const status = StatusSchema.parse(await response.json()).data;
      if (status.status === "completed") {
        if (!status.video_url) {
          throw new Error("HeyGen completed without a video URL");
        }
        return status.video_url;
      }
      if (status.status === "failed") {
        throw new Error(
          `HeyGen task ${providerTaskId} failed: ${JSON.stringify(status.error ?? "unknown")}`,
        );
      }
      await this.dependencies.sleep(5_000);
    }
    throw new Error(`HeyGen task ${providerTaskId} is still processing`);
  }

  private async downloadAndValidate(
    videoUrl: string,
    outputPath: string,
  ): Promise<void> {
    const response = await this.retryFetch(videoUrl);
    await requireOk(response, "HeyGen video download");
    const video = Buffer.from(await response.arrayBuffer());
    if (video.byteLength === 0) throw new Error("HeyGen video is empty");
    await mkdir(dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.partial`;
    await writeFile(temporary, video);
    await rename(temporary, outputPath);
    const probe = await this.dependencies.probeVideo(outputPath);
    if (!probe.streams.some((stream) => stream.codec_type === "video")) {
      throw new Error("HeyGen output has no video stream");
    }
  }

  private async finish(
    providerTaskId: string,
    input: HeyGenInput,
  ): Promise<StageResult> {
    const videoUrl = await this.waitForVideo(providerTaskId);
    await this.downloadAndValidate(videoUrl, input.outputPath);
    return {
      artifacts: [
        {
          path: input.outputPath,
          sha256: await sha256File(input.outputPath),
          mediaType: "video/mp4",
        },
      ],
      providerTaskId,
      metadata: {
        provider: "heygen",
        avatarId: input.avatarId,
        width: input.width,
        height: input.height,
      },
    };
  }

  async execute(
    rawInput: HeyGenInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    const input = HeyGenInputSchema.parse(rawInput);
    const audioAssetId = await this.uploadAudio(input.audioPath);
    const providerTaskId = await this.generate(input, audioAssetId);
    await this.dependencies.persistProviderTaskId(providerTaskId);
    return await this.finish(providerTaskId, input);
  }

  async recover(
    providerTaskId: string,
    rawInput: HeyGenInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    const input = HeyGenInputSchema.parse(rawInput);
    return await this.finish(providerTaskId, input);
  }
}
