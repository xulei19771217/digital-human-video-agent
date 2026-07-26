import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PublishPackProvider,
  parseScript,
} from "../src/providers/publish-pack.js";

describe("PublishPackProvider", () => {
  it("parses required Markdown front matter and narration", async () => {
    const script = await parseScript(
      join(process.cwd(), "tests", "fixtures", "script.md"),
    );

    expect(script.title).toBe("角马迁徙不是为了躲狮子");
    expect(script.facts).toHaveLength(2);
    expect(script.narration).toContain("新鲜牧草");
    expect(script.coverTimeSeconds).toBe(1.5);
  });

  it("creates distinct documents for three platforms", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "publish-pack-"));
    const provider = new PublishPackProvider();
    const script = await parseScript(
      join(process.cwd(), "tests", "fixtures", "script.md"),
    );

    const result = await provider.execute(
      {
        outputDir,
        script,
        coverNote: "使用通用竖屏封面，不叠加平台按钮。",
      },
      { jobId: "job", runDir: outputDir },
    );

    expect((await readdir(outputDir)).sort()).toEqual([
      "channels.md",
      "douyin.md",
      "xiaohongshu.md",
    ]);
    for (const artifact of result.artifacts) {
      const content = await readFile(artifact.path, "utf8");
      expect(content).toContain("# ");
      expect(content).toContain("## 话题");
      expect(content).toContain("## 封面");
      expect(content).not.toMatch(/评论.*关键词|保证看到|加微信/);
    }
  });
});
