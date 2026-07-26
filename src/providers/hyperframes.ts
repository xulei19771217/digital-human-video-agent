import { existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type {
  ProviderContext,
  StageProvider,
  StageResult,
} from "../contracts.js";
import { stableHash, sha256File } from "../job/hash.js";
import type { MediaManifest } from "./media.js";
import { parseSrt } from "./captions.js";
import { npxInvocation, runProcess } from "../util/process.js";

export interface HyperFramesInput {
  projectDir: string;
  avatarPath: string;
  audioPath: string;
  captionsPath: string;
  media: MediaManifest;
  outputPath: string;
  coverPath: string;
  durationSeconds: number;
  coverTimeSeconds: number;
  hook: string;
  facts: string[];
}

interface MasterProbe {
  streams: Array<{
    codec_type?: string | undefined;
    codec_name?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    r_frame_rate?: string | undefined;
  }>;
}

export interface HyperFramesDependencies {
  run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  templateDir: string;
  gsapPath: string;
  probeMaster(path: string): Promise<MasterProbe>;
  captureCover(
    masterPath: string,
    outputPath: string,
    atSeconds: number,
  ): Promise<void>;
}

function findPackagePath(relative: string): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "..", relative),
    join(moduleDir, "..", "..", "..", relative),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Package asset not found: ${relative}`);
  return found;
}

async function defaultProbeMaster(path: string): Promise<MasterProbe> {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    path,
  ]);
  if (result.code !== 0) {
    throw new Error(`FFprobe rejected master: ${result.stderr.trim()}`);
  }
  return z
    .object({
      streams: z.array(
        z.object({
          codec_type: z.string().optional(),
          codec_name: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          r_frame_rate: z.string().optional(),
        }),
      ),
    })
    .parse(JSON.parse(result.stdout));
}

async function defaultCaptureCover(
  masterPath: string,
  outputPath: string,
  atSeconds: number,
): Promise<void> {
  const result = await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(atSeconds),
    "-i",
    masterPath,
    "-vf",
    "drawbox=x=0:y=1000:w=720:h=280:color=0x11100e:t=fill",
    "-frames:v",
    "1",
    "-y",
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(`Cover extraction failed: ${result.stderr.trim()}`);
  }
}

export function createDefaultHyperFramesDependencies(): HyperFramesDependencies {
  return {
    run: runProcess,
    templateDir: findPackagePath(join("templates", "hyperframes")),
    gsapPath: findPackagePath(
      join("node_modules", "gsap", "dist", "gsap.min.js"),
    ),
    probeMaster: defaultProbeMaster,
    captureCover: defaultCaptureCover,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function seconds(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function validateMaster(probe: MasterProbe): void {
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (
    !video ||
    video.codec_name !== "h264" ||
    video.width !== 720 ||
    video.height !== 1280
  ) {
    throw new Error("Master must be 720x1280 H.264");
  }
  if (!audio || audio.codec_name !== "aac") {
    throw new Error("Master must contain AAC audio");
  }
  if (video.r_frame_rate && video.r_frame_rate !== "30/1") {
    throw new Error("Master must be 30 fps");
  }
}

function buildFactClips(
  facts: string[],
  duration: number,
): { markup: string; animations: string } {
  if (facts.length === 0 || duration <= 2.6) {
    return { markup: "", animations: "" };
  }
  const available = duration - 2.5;
  const slot = available / facts.length;
  const markup: string[] = [];
  const animations: string[] = [];
  facts.forEach((fact, index) => {
    const start = 2.5 + slot * index;
    const clipDuration = Math.max(0.3, Math.min(slot, duration - start));
    const id = `fact-${index + 1}`;
    markup.push(`<section id="${id}" class="clip fact-card" data-start="${seconds(start)}" data-duration="${seconds(clipDuration)}" data-track-index="2"><div id="${id}-inner"><span class="fact-index">FACT ${String(index + 1).padStart(2, "0")}</span><p class="fact-text">${escapeHtml(fact)}</p></div></section>`);
    animations.push(
      `timeline.fromTo("#${id}-inner", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: ${seconds(Math.min(0.4, clipDuration / 3))}, ease: "power2.out" }, ${seconds(start)});`,
    );
  });
  return { markup: markup.join("\n"), animations: animations.join("\n") };
}

function buildCaptionClips(
  captionsSource: string,
  duration: number,
): { markup: string; animations: string } {
  const markup: string[] = [];
  const animations: string[] = [];
  for (const cue of parseSrt(captionsSource)) {
    const start = Math.min(cue.startMs / 1_000, duration);
    const end = Math.min(cue.endMs / 1_000, duration);
    if (end <= start) continue;
    const id = `caption-${cue.index}`;
    markup.push(`<section id="${id}" class="clip caption" data-start="${seconds(start)}" data-duration="${seconds(end - start)}" data-track-index="3"><span id="${id}-text">${escapeHtml(cue.text)}</span></section>`);
    animations.push(
      `timeline.fromTo("#${id}-text", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: ${seconds(Math.min(0.18, (end - start) / 3))}, ease: "power1.out" }, ${seconds(start)});`,
    );
  }
  return { markup: markup.join("\n"), animations: animations.join("\n") };
}

async function buildMediaClips(
  manifest: MediaManifest,
  projectDir: string,
  duration: number,
): Promise<string> {
  const markup: string[] = [];
  for (const [index, item] of manifest.items.entries()) {
    const extension = extname(item.localPath).toLowerCase();
    const name = `media-${index + 1}${extension}`;
    await copyFile(item.localPath, join(projectDir, "assets", name));
    const start = Math.min(2.5 + index * 3, Math.max(0, duration - 1));
    const clipDuration = Math.min(3, duration - start);
    if (clipDuration <= 0) continue;
    if ([".mp4", ".mov"].includes(extension)) {
      markup.push(`<video id="broll-${index + 1}" class="broll" src="./assets/${name}" data-start="${seconds(start)}" data-duration="${seconds(clipDuration)}" data-track-index="6" muted playsinline></video>`);
    } else {
      markup.push(`<img id="broll-${index + 1}" class="clip broll" src="./assets/${name}" data-start="${seconds(start)}" data-duration="${seconds(clipDuration)}" data-track-index="6" alt="" />`);
    }
  }
  return markup.join("\n");
}

export class HyperFramesProvider
  implements StageProvider<HyperFramesInput>
{
  readonly stage = "package" as const;
  readonly paid = false;

  constructor(
    private readonly dependencies: HyperFramesDependencies =
      createDefaultHyperFramesDependencies(),
  ) {}

  async inputHash(input: HyperFramesInput): Promise<string> {
    return stableHash({
      avatar: await sha256File(input.avatarPath),
      audio: await sha256File(input.audioPath),
      captions: await sha256File(input.captionsPath),
      media: input.media.items.map((item) => item.sha256),
      durationSeconds: input.durationSeconds,
      hook: input.hook,
      facts: input.facts,
      templateVersion: 2,
      hyperframes: "0.7.71",
    });
  }

  async execute(
    input: HyperFramesInput,
    _context: ProviderContext,
  ): Promise<StageResult> {
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
      throw new Error("Video duration must be positive");
    }
    await cp(this.dependencies.templateDir, input.projectDir, {
      recursive: true,
    });
    await mkdir(join(input.projectDir, "assets"), { recursive: true });
    await mkdir(join(input.projectDir, "vendor"), { recursive: true });
    await mkdir(dirname(input.outputPath), { recursive: true });
    await copyFile(input.avatarPath, join(input.projectDir, "assets", "avatar.mp4"));
    await copyFile(input.audioPath, join(input.projectDir, "assets", "voice.mp3"));
    await copyFile(input.captionsPath, join(input.projectDir, "assets", "captions.srt"));
    await copyFile(
      this.dependencies.gsapPath,
      join(input.projectDir, "vendor", "gsap.min.js"),
    );

    const captionsSource = await readFile(input.captionsPath, "utf8");
    const facts = buildFactClips(input.facts, input.durationSeconds);
    const captions = buildCaptionClips(
      captionsSource,
      input.durationSeconds,
    );
    const media = await buildMediaClips(
      input.media,
      input.projectDir,
      input.durationSeconds,
    );
    const hookDuration = Math.min(2.5, input.durationSeconds);
    const hookMarkup = `<section id="hook" class="clip hook" data-start="0" data-duration="${seconds(hookDuration)}" data-track-index="2"><div id="hook-inner"><p class="hook-label">反常识问题</p><h1 class="hook-title">${escapeHtml(input.hook)}</h1></div></section>`;
    const hookAnimation = `timeline.fromTo("#hook-inner", { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: ${seconds(Math.min(0.45, hookDuration / 3))}, ease: "power2.out" }, 0);`;

    const templatePath = join(input.projectDir, "index.html");
    const template = await readFile(templatePath, "utf8");
    const html = template
      .replaceAll("__DURATION__", seconds(input.durationSeconds))
      .replace("__MEDIA_CLIPS__", media)
      .replace("__HOOK_CLIP__", hookMarkup)
      .replace("__FACT_CLIPS__", facts.markup)
      .replace("__CAPTION_CLIPS__", captions.markup)
      .replace(
        "__ANIMATIONS__",
        [hookAnimation, facts.animations, captions.animations].join("\n"),
      );
    await writeFile(templatePath, html, "utf8");
    await writeFile(
      join(input.projectDir, "episode.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          hook: input.hook,
          facts: input.facts,
          durationSeconds: input.durationSeconds,
          media: input.media,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const upgrade = npxInvocation([
      "hyperframes@latest",
      "upgrade",
      "--project",
      input.projectDir,
      "--check",
    ]);
    await this.dependencies.run(upgrade.command, upgrade.args);

    const check = npxInvocation([
      "--yes",
      "hyperframes@0.7.71",
      "check",
      input.projectDir,
      "--strict",
      "--json",
    ]);
    const checkResult = await this.dependencies.run(check.command, check.args);
    if (checkResult.code !== 0) {
      throw new Error(`HyperFrames check failed: ${checkResult.stderr.trim()}`);
    }

    const render = npxInvocation([
      "--yes",
      "hyperframes@0.7.71",
      "render",
      input.projectDir,
      `--output=${input.outputPath}`,
      "--fps=30",
      "--quality=high",
      "--strict",
    ]);
    const renderResult = await this.dependencies.run(
      render.command,
      render.args,
    );
    if (renderResult.code !== 0) {
      throw new Error(`HyperFrames render failed: ${renderResult.stderr.trim()}`);
    }
    validateMaster(await this.dependencies.probeMaster(input.outputPath));
    await this.dependencies.captureCover(
      input.outputPath,
      input.coverPath,
      input.coverTimeSeconds,
    );

    return {
      artifacts: [
        {
          path: input.outputPath,
          sha256: await sha256File(input.outputPath),
          mediaType: "video/mp4",
        },
        {
          path: input.coverPath,
          sha256: await sha256File(input.coverPath),
          mediaType: "image/png",
        },
      ],
      metadata: {
        provider: "hyperframes",
        version: "0.7.71",
        projectDir: input.projectDir,
        width: 720,
        height: 1280,
        fps: 30,
      },
    };
  }
}
