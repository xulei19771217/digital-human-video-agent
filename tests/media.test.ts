import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { MediaProvider } from "../src/providers/media.js";

describe("MediaProvider", () => {
  it("freezes local media first without calling an external provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-local-"));
    const localDir = join(root, "local");
    const outputDir = join(root, "frozen");
    await mkdir(localDir);
    await writeFile(join(localDir, "migration.mp4"), "local-video");
    const searchPexels = vi.fn();
    const provider = new MediaProvider({
      searchPexels,
      download: vi.fn(),
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });

    const result = await provider.resolve({
      localDir,
      outputDir,
      queries: ["wildebeest"],
      pexelsEnabled: true,
      pexelsApiKey: "pexels-key",
    });

    expect(result).toMatchObject({
      mode: "local",
      items: [{ sourceType: "local" }],
    });
    expect(searchPexels).not.toHaveBeenCalled();
    expect(await readFile(result.items[0]!.localPath, "utf8")).toBe(
      "local-video",
    );
  });

  it("records provenance for downloaded portrait media", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-external-"));
    const localDir = join(root, "local");
    await mkdir(localDir);
    const provider = new MediaProvider({
      searchPexels: vi.fn(async () => [
        {
          id: "42",
          width: 720,
          height: 1280,
          downloadUrl: "https://cdn.test/giraffe.mp4",
          sourceUrl: "https://pexels.com/video/42",
          author: "A. Creator",
        },
      ]),
      download: vi.fn(async () => Buffer.from("external-video")),
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });

    const result = await provider.resolve({
      localDir,
      outputDir: join(root, "frozen"),
      queries: ["giraffe"],
      pexelsEnabled: true,
      pexelsApiKey: "pexels-key",
    });

    expect(result).toMatchObject({
      mode: "external",
      items: [
        {
          sourceType: "pexels",
          sourceUrl: "https://pexels.com/video/42",
          author: "A. Creator",
          licenseNote: "Pexels license; verify current terms before publishing",
          accessedAt: "2026-07-26",
        },
      ],
    });
  });

  it("uses graphics fallback when no licensed media resolves", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-fallback-"));
    const localDir = join(root, "local");
    await mkdir(localDir);
    const provider = new MediaProvider({
      searchPexels: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
      download: vi.fn(),
      now: () => new Date("2026-07-26T00:00:00.000Z"),
    });

    await expect(
      provider.resolve({
        localDir,
        outputDir: join(root, "frozen"),
        queries: ["lion"],
        pexelsEnabled: false,
        pexelsApiKey: undefined,
      }),
    ).resolves.toEqual({
      mode: "graphics",
      items: [],
      reason: "No licensed media resolved",
    });
  });
});
