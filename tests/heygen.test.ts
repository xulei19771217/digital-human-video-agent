import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AmbiguousPaidRequestError } from "../src/job/engine.js";
import {
  type HeyGenInput,
  HeyGenProvider,
} from "../src/providers/heygen.js";

function baseInput(root: string): HeyGenInput {
  return {
    title: "job-20260726",
    avatarId: "avatar-middle",
    audioPath: join(root, "voice.mp3"),
    outputPath: join(root, "source.mp4"),
    width: 720,
    height: 1280,
  };
}

describe("HeyGenProvider", () => {
  it("uploads raw audio, generates once, persists the ID, and downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "heygen-"));
    const input = baseInput(root);
    await writeFile(input.audioPath, Buffer.from([73, 68, 51, 4]));
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
      const url = String(raw);
      requests.push({ url, ...(init === undefined ? {} : { init }) });
      if (url === "https://upload.heygen.com/v1/asset") {
        return Response.json({
          code: 100,
          data: { id: "asset-123", url: "https://cdn.test/audio.mp3" },
        });
      }
      if (url === "https://api.heygen.com/v2/video/generate") {
        return Response.json({ data: { video_id: "video-123" } });
      }
      if (url.includes("/v1/video_status.get")) {
        return Response.json({
          data: {
            status: "completed",
            video_url: "https://cdn.test/video-123.mp4",
          },
        });
      }
      if (url === "https://cdn.test/video-123.mp4") {
        return new Response(Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]));
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;
    const persistProviderTaskId = vi.fn(async () => undefined);
    const provider = new HeyGenProvider("heygen-secret", {
      fetcher,
      persistProviderTaskId,
      sleep: async () => undefined,
      probeVideo: async () => ({
        streams: [{ codec_type: "video", width: 720, height: 1280 }],
      }),
    });

    const result = await provider.execute(input, {
      jobId: "job-20260726",
      runDir: root,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://upload.heygen.com/v1/asset",
      "https://api.heygen.com/v2/video/generate",
      "https://api.heygen.com/v1/video_status.get?video_id=video-123",
      "https://cdn.test/video-123.mp4",
    ]);
    expect(requests[0]!.init?.headers).toEqual({
      "X-Api-Key": "heygen-secret",
      "Content-Type": "audio/mpeg",
    });
    expect(Buffer.from(requests[0]!.init?.body as Uint8Array)).toEqual(
      await readFile(input.audioPath),
    );
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      title: "job-20260726",
      caption: false,
      dimension: { width: 720, height: 1280 },
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: "avatar-middle",
            avatar_style: "normal",
            scale: 1,
          },
          voice: { type: "audio", audio_asset_id: "asset-123" },
          background: { type: "color", value: "#1D1A17" },
        },
      ],
    });
    expect(persistProviderTaskId).toHaveBeenCalledWith("video-123");
    expect(result.providerTaskId).toBe("video-123");
    expect(await readFile(input.outputPath)).toHaveLength(8);
  });

  it("recovers from the saved video ID without upload or generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "heygen-recover-"));
    const input = baseInput(root);
    await writeFile(input.audioPath, "audio");
    const urls: string[] = [];
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      const url = String(raw);
      urls.push(url);
      if (url.includes("/v1/video_status.get")) {
        return Response.json({
          data: {
            status: "completed",
            video_url: "https://cdn.test/recovered.mp4",
          },
        });
      }
      return new Response(Uint8Array.from([1, 2, 3, 4]));
    }) as unknown as typeof fetch;
    const provider = new HeyGenProvider("heygen-secret", {
      fetcher,
      persistProviderTaskId: async () => undefined,
      sleep: async () => undefined,
      probeVideo: async () => ({
        streams: [{ codec_type: "video", width: 720, height: 1280 }],
      }),
    });

    await provider.recover("video-123", input, {
      jobId: "job-20260726",
      runDir: root,
    });

    expect(urls).toEqual([
      "https://api.heygen.com/v1/video_status.get?video_id=video-123",
      "https://cdn.test/recovered.mp4",
    ]);
  });

  it("does not retry an ambiguous paid generation request", async () => {
    const root = await mkdtemp(join(tmpdir(), "heygen-ambiguous-"));
    const input = baseInput(root);
    await writeFile(input.audioPath, "audio");
    const fetcher = vi.fn(async (raw: string | URL | Request) => {
      if (String(raw).includes("upload.heygen.com")) {
        return Response.json({
          code: 100,
          data: { id: "asset-123", url: "https://cdn.test/audio.mp3" },
        });
      }
      throw new TypeError("connection reset");
    }) as unknown as typeof fetch;
    const provider = new HeyGenProvider("heygen-secret", {
      fetcher,
      persistProviderTaskId: async () => undefined,
      sleep: async () => undefined,
      probeVideo: async () => ({ streams: [] }),
    });

    await expect(
      provider.execute(input, { jobId: "job", runDir: root }),
    ).rejects.toBeInstanceOf(AmbiguousPaidRequestError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
