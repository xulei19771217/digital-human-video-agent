import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import { z } from "zod";

import type {
  ProviderContext,
  StageProvider,
  StageResult,
} from "../contracts.js";
import { stableHash, sha256File } from "../job/hash.js";

const FrontMatterSchema = z.object({
  title: z.string().trim().min(1),
  hook: z.string().trim().min(1),
  facts: z.array(z.string().trim().min(1)).min(1),
  cover_time_seconds: z.number().nonnegative().default(1),
  media_queries: z.array(z.string().trim().min(1)).default([]),
  topics: z.array(z.string().trim().min(1)).default([]),
});

export interface ScriptDocument {
  title: string;
  hook: string;
  facts: string[];
  narration: string;
  coverTimeSeconds: number;
  mediaQueries: string[];
  topics: string[];
}

export interface PublishPackInput {
  outputDir: string;
  script: ScriptDocument;
  coverNote: string;
}

export async function parseScript(path: string): Promise<ScriptDocument> {
  const parsed = matter(await readFile(path, "utf8"));
  const frontMatter = FrontMatterSchema.parse(parsed.data);
  const narration = parsed.content.trim();
  if (!narration) throw new Error("Script narration is empty");
  return {
    title: frontMatter.title,
    hook: frontMatter.hook,
    facts: frontMatter.facts,
    narration,
    coverTimeSeconds: frontMatter.cover_time_seconds,
    mediaQueries:
      frontMatter.media_queries.length > 0
        ? frontMatter.media_queries
        : [frontMatter.title],
    topics:
      frontMatter.topics.length > 0
        ? frontMatter.topics
        : ["非洲旅行", "旅行知识"],
  };
}

function packageTemplateDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "..", "templates", "publish"),
    join(moduleDir, "..", "..", "..", "templates", "publish"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Publishing templates are missing");
  return found;
}

function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  const unresolved = output.match(/\{\{[a-z_]+\}\}/);
  if (unresolved) {
    throw new Error(`Unresolved publishing template value: ${unresolved[0]}`);
  }
  return output;
}

function factsAsLines(facts: string[]): string {
  return facts.map((fact) => `- ${fact}`).join("\n");
}

export class PublishPackProvider
  implements StageProvider<PublishPackInput>
{
  readonly stage = "publish" as const;
  readonly paid = false;

  constructor(private readonly templateDir: string = packageTemplateDir()) {}

  async inputHash(input: PublishPackInput): Promise<string> {
    return stableHash({
      script: input.script,
      coverNote: input.coverNote,
      templateVersion: 1,
    });
  }

  async execute(
    input: PublishPackInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    await mkdir(input.outputDir, { recursive: true });
    const topics = input.script.topics.map((topic) => `#${topic}`).join(" ");
    const facts = factsAsLines(input.script.facts);
    const shared = {
      title: input.script.title,
      short_title: input.script.title.slice(0, 24),
      topics,
      cover_note: input.coverNote,
      body: `${input.script.hook}\n\n${facts}\n\n理解迁徙背后的降雨和草场变化，也能帮助旅行者更合理地判断季节与路线。`,
      direct_body: `${input.script.hook}\n${input.script.facts.join("；")}`,
      context_body: `${input.script.hook}\n\n${facts}\n\n这类自然规律，是规划非洲动物观察路线时需要先理解的基础信息。`,
    };
    const targets = [
      ["xiaohongshu.md", "xiaohongshu.md"],
      ["douyin.md", "douyin.md"],
      ["channels.md", "channels.md"],
    ] as const;
    const artifacts = [];
    for (const [templateName, outputName] of targets) {
      const template = await readFile(
        join(this.templateDir, templateName),
        "utf8",
      );
      const outputPath = join(input.outputDir, outputName);
      await writeFile(outputPath, fillTemplate(template, shared), "utf8");
      artifacts.push({
        path: outputPath,
        sha256: await sha256File(outputPath),
        mediaType: "text/markdown",
      });
    }
    return {
      artifacts,
      metadata: {
        platforms: ["xiaohongshu", "douyin", "channels"],
        autoPublished: false,
      },
    };
  }
}
