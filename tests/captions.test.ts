import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CaptionProvider,
  parseSrt,
  validateCaptionCues,
} from "../src/providers/captions.js";

describe("CaptionProvider", () => {
  it("parses UTF-8 SRT cues structurally", () => {
    expect(
      parseSrt(`1
00:00:00,000 --> 00:00:01,500
角马迁徙

2
00:00:01,500 --> 00:00:03,000
追逐的是雨水
`),
    ).toEqual([
      { index: 1, startMs: 0, endMs: 1500, text: "角马迁徙" },
      { index: 2, startMs: 1500, endMs: 3000, text: "追逐的是雨水" },
    ]);
  });

  it("rejects captions that exceed audio duration", () => {
    const cues = parseSrt(`1
00:00:09,000 --> 00:00:11,000
迁徙开始了
`);

    expect(() => validateCaptionCues(cues, 10)).toThrow(
      "exceeds audio duration",
    );
  });

  it("runs the pinned HyperFrames transcription command", async () => {
    const root = await mkdtemp(join(tmpdir(), "captions-"));
    const audioPath = join(root, "voice.mp3");
    const outputPath = join(root, "captions.srt");
    await writeFile(audioPath, "audio");
    const run = vi.fn(async (_command: string, args: string[]) => {
      await writeFile(
        outputPath,
        "1\n00:00:00,000 --> 00:00:01,000\n迁徙\n",
      );
      return { code: 0, stdout: "", stderr: "", args };
    });
    const provider = new CaptionProvider({
      run,
      probeAudioDuration: async () => 2,
    });

    await provider.execute(
      { audioPath, outputPath },
      { jobId: "job", runDir: root },
    );

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![1].slice(1)).toEqual([
      "--yes",
      "hyperframes@0.7.71",
      "transcribe",
      audioPath,
      "--model=large-v3",
      "--language=zh",
      "--to=srt",
      `--output=${outputPath}`,
    ]);
  });
});
