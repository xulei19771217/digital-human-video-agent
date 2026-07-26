import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { FishAudioProvider } from "../src/providers/fish-audio.js";

function mockFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

describe("FishAudioProvider", () => {
  it("uses the official read-only credential and voice endpoints", async () => {
    const fetcher = mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/wallet/")) {
        return Response.json({ credit: 10 });
      }
      return Response.json({
        items: [{ _id: "voice-3", title: "少年3" }],
      });
    });
    const provider = new FishAudioProvider("fish-secret", fetcher);

    await expect(provider.validate()).resolves.toBeUndefined();
    await expect(provider.listVoices()).resolves.toEqual([
      { id: "voice-3", title: "少年3" },
    ]);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.fish.audio/wallet/self/api-credit",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer fish-secret" },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.fish.audio/model?page_size=50&page_number=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("writes binary TTS with the selected voice and speed", async () => {
    const root = await mkdtemp(join(tmpdir(), "fish-audio-"));
    const outputPath = join(root, "voice.mp3");
    const fetcher = mockFetch(async () => {
      return new Response(Uint8Array.from([73, 68, 51, 4]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const provider = new FishAudioProvider("fish-secret", fetcher);

    const result = await provider.execute(
      {
        text: "角马迁徙不是为了躲狮子。",
        voiceId: "voice-3",
        speed: 1.3,
        outputPath,
      },
      { jobId: "job-20260726", runDir: root },
    );

    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(init?.headers).toEqual({
      Authorization: "Bearer fish-secret",
      model: "s2-pro",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "角马迁徙不是为了躲狮子。",
      reference_id: "voice-3",
      format: "mp3",
      prosody: { speed: 1.3 },
      sample_rate: 44100,
      normalize: true,
    });
    expect(await readFile(outputPath)).toEqual(
      Buffer.from([73, 68, 51, 4]),
    );
    expect(result.artifacts[0]).toMatchObject({
      path: outputPath,
      mediaType: "audio/mpeg",
    });
  });

  it("never exposes the key in an HTTP error", async () => {
    const fetcher = mockFetch(async () => {
      return new Response("unauthorized", { status: 401 });
    });
    const provider = new FishAudioProvider("fish-secret", fetcher);

    await expect(provider.validate()).rejects.not.toThrow("fish-secret");
    await expect(provider.validate()).rejects.toThrow("HTTP 401");
  });
});
