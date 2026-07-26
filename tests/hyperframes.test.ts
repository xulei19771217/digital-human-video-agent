import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MediaManifest } from "../src/providers/media.js";
import {
  HyperFramesProvider,
  type HyperFramesInput,
} from "../src/providers/hyperframes.js";

describe("HyperFramesProvider", () => {
  it("prepares a deterministic project, checks it, and renders portrait output", async () => {
    const root = await mkdtemp(join(tmpdir(), "hyperframes-provider-"));
    const assets = join(root, "source");
    await mkdir(assets);
    const avatarPath = join(assets, "avatar.mp4");
    const audioPath = join(assets, "voice.mp3");
    const captionsPath = join(assets, "captions.srt");
    await writeFile(avatarPath, "avatar");
    await writeFile(audioPath, "audio");
    await writeFile(
      captionsPath,
      "1\n00:00:00,000 --> 00:00:01,000\n迁徙\n",
    );
    const templateDir = join(
      process.cwd(),
      "templates",
      "hyperframes",
    );
    const gsapPath = join(
      process.cwd(),
      "node_modules",
      "gsap",
      "dist",
      "gsap.min.js",
    );
    const commands: string[][] = [];
    const run = vi.fn(async (_command: string, args: string[]) => {
      commands.push(args);
      const output = args.find((arg) => arg.startsWith("--output="));
      if (args.includes("render") && output) {
        await writeFile(output.slice("--output=".length), "master");
      }
      return { code: 0, stdout: "{}", stderr: "" };
    });
    const provider = new HyperFramesProvider({
      run,
      templateDir,
      gsapPath,
      probeMaster: async () => ({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 720,
            height: 1280,
            r_frame_rate: "30/1",
          },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
      captureCover: async (_masterPath, outputPath) => {
        await writeFile(outputPath, "png");
      },
    });
    const media: MediaManifest = {
      mode: "graphics",
      items: [],
      reason: "No licensed media resolved",
    };
    const input: HyperFramesInput = {
      projectDir: join(root, "project"),
      avatarPath,
      audioPath,
      captionsPath,
      media,
      outputPath: join(root, "output", "master.mp4"),
      coverPath: join(root, "output", "cover.png"),
      durationSeconds: 5,
      coverTimeSeconds: 1.5,
      hook: "角马迁徙不是为了躲狮子",
      facts: ["它们追逐的是雨水", "时间会随降雨变化"],
    };

    await provider.execute(input, { jobId: "job", runDir: root });

    expect(commands.some((args) => args.includes("check"))).toBe(true);
    expect(commands.some((args) => args.includes("render"))).toBe(true);
    expect(
      commands.find((args) => args.includes("render")),
    ).toEqual(
      expect.arrayContaining([
        "hyperframes@0.7.71",
        "render",
        input.projectDir,
        `--output=${input.outputPath}`,
        "--fps=30",
        "--quality=high",
        "--strict",
      ]),
    );
    const html = await readFile(join(input.projectDir, "index.html"), "utf8");
    expect(html).toContain('data-composition-id="digital-human-portrait"');
    expect(html).toContain('data-duration="5"');
    expect(html).toContain("角马迁徙不是为了躲狮子");
    expect(html).not.toContain("__DURATION__");
  });
});
