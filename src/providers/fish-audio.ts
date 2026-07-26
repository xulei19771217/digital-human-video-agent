import { mkdir, rename, writeFile } from "node:fs/promises";
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

const API_BASE = "https://api.fish.audio";

const FishTtsInputSchema = z.object({
  text: z.string().trim().min(1),
  voiceId: z.string().trim().min(1),
  speed: z.number().min(0.5).max(2),
  outputPath: z.string().min(1),
});

const VoiceListSchema = z.object({
  items: z.array(
    z.object({
      _id: z.string(),
      title: z.string().catch("Untitled voice"),
    }),
  ),
});

export interface FishTtsInput {
  text: string;
  voiceId: string;
  speed: number;
  outputPath: string;
}

export class FishAudioProvider implements StageProvider<FishTtsInput> {
  readonly stage = "voice" as const;
  readonly paid = true;

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("Fish Audio API Key is required");
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async validate(): Promise<void> {
    const endpoint = `${API_BASE}/wallet/self/api-credit`;
    const response = await this.fetcher(endpoint, {
      method: "GET",
      headers: this.headers(),
    });
    await requireOk(response, endpoint);
  }

  async listVoices(): Promise<Array<{ id: string; title: string }>> {
    const endpoint = `${API_BASE}/model?page_size=50&page_number=1`;
    const response = await this.fetcher(endpoint, {
      method: "GET",
      headers: this.headers(),
    });
    await requireOk(response, endpoint);
    const parsed = VoiceListSchema.parse(await response.json());
    return parsed.items.map((voice) => ({
      id: voice._id,
      title: voice.title,
    }));
  }

  async inputHash(input: FishTtsInput): Promise<string> {
    const value = FishTtsInputSchema.parse(input);
    return stableHash({
      model: "s2-pro",
      text: value.text,
      voiceId: value.voiceId,
      speed: value.speed,
      format: "mp3",
      sampleRate: 44100,
      normalize: true,
    });
  }

  async execute(
    input: FishTtsInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    const value = FishTtsInputSchema.parse(input);
    const endpoint = `${API_BASE}/v1/tts`;
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: {
          ...this.headers(),
          model: "s2-pro",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: value.text,
          reference_id: value.voiceId,
          format: "mp3",
          prosody: { speed: value.speed },
          sample_rate: 44100,
          normalize: true,
        }),
      });
    } catch (error) {
      throw new AmbiguousPaidRequestError(
        `Fish Audio TTS request outcome is unknown: ${(error as Error).message}`,
      );
    }
    await requireOk(response, endpoint);
    const mediaType = response.headers.get("content-type")?.split(";")[0];
    if (!mediaType?.startsWith("audio/")) {
      throw new Error("Fish Audio TTS response is not audio");
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.byteLength === 0) {
      throw new Error("Fish Audio TTS response is empty");
    }

    await mkdir(dirname(value.outputPath), { recursive: true });
    const temporary = `${value.outputPath}.partial`;
    await writeFile(temporary, audio);
    await rename(temporary, value.outputPath);

    return {
      artifacts: [
        {
          path: value.outputPath,
          sha256: await sha256File(value.outputPath),
          mediaType,
        },
      ],
      metadata: {
        provider: "fish-audio",
        model: "s2-pro",
        voiceId: value.voiceId,
        speed: value.speed,
      },
    };
  }
}
