import {
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { StageProvider } from "../contracts.js";
import { loadCredentials, type Credentials } from "../config/credentials.js";
import { currentAppPaths } from "../config/paths.js";
import { loadProfile, type Profile } from "../config/profile.js";
import { JobEngine, invalidateForChange, invalidateFromStage, STAGE_ORDER } from "../job/engine.js";
import { sha256File } from "../job/hash.js";
import type { Job } from "../job/schema.js";
import { JobStore } from "../job/store.js";
import { CaptionProvider, type CaptionInput } from "../providers/captions.js";
import { FishAudioProvider, type FishTtsInput } from "../providers/fish-audio.js";
import { HeyGenProvider, type HeyGenInput } from "../providers/heygen.js";
import {
  HyperFramesProvider,
  type HyperFramesInput,
} from "../providers/hyperframes.js";
import {
  MediaProvider,
  type MediaInput,
  type MediaManifest,
} from "../providers/media.js";
import {
  MockAvatarProvider,
  MockCaptionProvider,
  MockVoiceProvider,
} from "../providers/mock.js";
import {
  parseScript,
  PublishPackProvider,
  type PublishPackInput,
  type ScriptDocument,
} from "../providers/publish-pack.js";
import { runProcess } from "../util/process.js";

export const ExitCode = {
  ok: 0,
  usage: 2,
  notConfigured: 10,
  providerFailure: 20,
  unknownPaidOutcome: 21,
  renderFailure: 30,
} as const;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface RunOptions {
  voice?: string;
  avatar?: string;
  speed?: number;
  mediaDir?: string;
  outputDir?: string;
  mock?: boolean;
}

interface WorkflowProviders {
  voice: StageProvider<FishTtsInput>;
  avatar: StageProvider<HeyGenInput>;
  media: StageProvider<MediaInput>;
  captions: StageProvider<CaptionInput>;
  package: StageProvider<HyperFramesInput>;
  publish: StageProvider<PublishPackInput>;
}

export interface RunResult {
  jobId: string;
  runDir: string;
  outputDir: string;
  outputs: string[];
}

async function probeDuration(path: string): Promise<number> {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  if (result.code !== 0) {
    throw new Error(`Cannot read audio duration: ${result.stderr.trim()}`);
  }
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Audio duration is invalid");
  }
  return duration;
}

function mediaManifest(job: Job): MediaManifest {
  const value = job.stages.media.metadata.manifest;
  if (!value || typeof value !== "object") {
    throw new Error("Media stage did not produce a manifest");
  }
  return value as MediaManifest;
}

async function verifyCachedArtifacts(
  original: Job,
  store: JobStore,
): Promise<Job> {
  let job = structuredClone(original);
  const currentScriptHash = await sha256File(job.scriptPath);
  if (currentScriptHash !== job.scriptHash) {
    job = invalidateForChange(job, "script");
    job.scriptHash = currentScriptHash;
  }
  for (const name of STAGE_ORDER) {
    const stage = job.stages[name];
    if (stage.status !== "completed") continue;
    let valid = true;
    for (const artifact of stage.artifacts) {
      try {
        if ((await sha256File(artifact.path)) !== artifact.sha256) {
          valid = false;
          break;
        }
      } catch {
        valid = false;
        break;
      }
    }
    if (!valid) {
      job = invalidateFromStage(job, name);
      break;
    }
  }
  await store.save(job);
  return job;
}

async function loadRuntimeCredentials(): Promise<Credentials> {
  const paths = currentAppPaths();
  return await loadCredentials({
    processEnv: process.env,
    projectEnvPath: join(process.cwd(), ".env"),
    userEnvPath: paths.credentialsPath,
  });
}

async function requireProfile(): Promise<Profile> {
  try {
    return await loadProfile(currentAppPaths().profilePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(
        "Configuration is missing. Run video-agent setup first.",
        ExitCode.notConfigured,
      );
    }
    throw error;
  }
}

function createProviders(
  job: Job,
  store: JobStore,
  script: ScriptDocument,
  credentials: Credentials,
): WorkflowProviders {
  const engine = new JobEngine(store);
  if (job.parameters.mock) {
    return {
      voice: new MockVoiceProvider(),
      avatar: new MockAvatarProvider(),
      media: new MediaProvider(),
      captions: new MockCaptionProvider(script.narration),
      package: new HyperFramesProvider(),
      publish: new PublishPackProvider(),
    };
  }
  if (!credentials.fishAudioApiKey || !credentials.heygenApiKey) {
    throw new CliError(
      "Fish Audio and HeyGen credentials are required. Run video-agent setup.",
      ExitCode.notConfigured,
    );
  }
  return {
    voice: new FishAudioProvider(credentials.fishAudioApiKey),
    avatar: new HeyGenProvider(
      credentials.heygenApiKey,
      async (providerTaskId) =>
        await engine.persistProviderTaskId(
          job.id,
          "avatar",
          providerTaskId,
        ),
    ),
    media: new MediaProvider(),
    captions: new CaptionProvider(),
    package: new HyperFramesProvider(),
    publish: new PublishPackProvider(),
  };
}

async function executeJob(
  initialJob: Job,
  store: JobStore,
  script: ScriptDocument,
  credentials: Credentials,
): Promise<RunResult> {
  let job = await verifyCachedArtifacts(initialJob, store);
  const engine = new JobEngine(store);
  const providers = createProviders(job, store, script, credentials);
  const runDir = store.runDir(job.id);
  const outputDir = join(runDir, "output");
  const audioPath = join(runDir, "audio", "voice.mp3");
  const avatarPath = join(runDir, "avatar", "source.mp4");
  const captionsPath = join(outputDir, "captions.srt");
  const masterPath = join(outputDir, "master.mp4");
  const coverPath = join(outputDir, "cover.png");
  const mediaDir =
    job.parameters.mediaDir ?? join(dirname(job.scriptPath), "media");

  job = await engine.runStage(job, providers.voice, {
    text: script.narration,
    voiceId: job.profile.voiceId,
    speed: job.parameters.speed,
    outputPath: audioPath,
  });
  job = await engine.runStage(job, providers.avatar, {
    title: job.id,
    avatarId: job.profile.avatarId,
    audioPath,
    outputPath: avatarPath,
    width: 720,
    height: 1280,
  });
  job = await engine.runStage(job, providers.media, {
    localDir: mediaDir,
    outputDir: join(runDir, "media"),
    queries: script.mediaQueries,
    pexelsEnabled: job.parameters.pexelsEnabled,
    pexelsApiKey: credentials.pexelsApiKey,
  });
  job = await engine.runStage(job, providers.captions, {
    audioPath,
    outputPath: captionsPath,
  });
  const durationSeconds = await probeDuration(audioPath);
  job = await engine.runStage(job, providers.package, {
    projectDir: join(runDir, "hyperframes"),
    avatarPath,
    audioPath,
    captionsPath,
    media: mediaManifest(job),
    outputPath: masterPath,
    coverPath,
    durationSeconds,
    coverTimeSeconds: Math.min(
      script.coverTimeSeconds,
      Math.max(0, durationSeconds - 0.1),
    ),
    hook: script.hook,
    facts: script.facts,
  });
  job = await engine.runStage(job, providers.publish, {
    outputDir,
    script,
    coverNote: "使用通用9:16竖屏封面，不叠加平台按钮或界面元素。",
  });

  const outputs = [
    masterPath,
    captionsPath,
    coverPath,
    join(outputDir, "xiaohongshu.md"),
    join(outputDir, "douyin.md"),
    join(outputDir, "channels.md"),
  ];
  const artifacts = Object.fromEntries(
    await Promise.all(
      outputs.map(async (path) => [
        path.split(/[\\/]/).at(-1)!,
        { path, sha256: await sha256File(path) },
      ]),
    ),
  );
  const reportPath = join(outputDir, "run-report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        jobId: job.id,
        status: "completed",
        profile: job.profile,
        parameters: job.parameters,
        stages: job.stages,
        artifacts,
        provenance: mediaManifest(job).items,
        startedAt: job.createdAt,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  outputs.push(reportPath);
  return { jobId: job.id, runDir, outputDir, outputs };
}

export async function runVideoJob(
  scriptPath: string,
  options: RunOptions,
): Promise<RunResult> {
  const absoluteScriptPath = resolve(scriptPath);
  const script = await parseScript(absoluteScriptPath);
  const mock = options.mock ?? false;
  const credentials = mock
    ? {
        fishAudioApiKey: undefined,
        heygenApiKey: undefined,
        pexelsApiKey: undefined,
      }
    : await loadRuntimeCredentials();
  const savedProfile = mock ? undefined : await requireProfile();
  const profile = {
    voiceId: options.voice ?? savedProfile?.voiceId ?? "mock-voice",
    avatarId: options.avatar ?? savedProfile?.avatarId ?? "mock-avatar",
    language: "zh" as const,
    width: 720 as const,
    height: 1280 as const,
    fps: 30 as const,
  };
  const runsDir = resolve(
    options.outputDir ??
      savedProfile?.outputDir ??
      join(process.cwd(), "runs"),
  );
  const mediaDir = resolve(
    options.mediaDir ?? join(dirname(absoluteScriptPath), "media"),
  );
  const store = new JobStore(runsDir);

  if (!mock) {
    if (!credentials.fishAudioApiKey || !credentials.heygenApiKey) {
      throw new CliError(
        "Fish Audio and HeyGen credentials are required. Run video-agent setup.",
        ExitCode.notConfigured,
      );
    }
    await new FishAudioProvider(credentials.fishAudioApiKey).validate();
    await new HeyGenProvider(
      credentials.heygenApiKey,
      async () => undefined,
    ).validate();
  }

  const job = await store.create(
    absoluteScriptPath,
    await sha256File(absoluteScriptPath),
    profile,
    {
      speed: options.speed ?? 1,
      mediaDir,
      pexelsEnabled: savedProfile?.pexelsEnabled ?? false,
      mock,
    },
  );
  const frozenScriptPath = join(store.runDir(job.id), "input", "script.md");
  await mkdir(dirname(frozenScriptPath), { recursive: true });
  await copyFile(absoluteScriptPath, frozenScriptPath);
  job.scriptPath = frozenScriptPath;
  await store.save(job);
  return await executeJob(job, store, script, credentials);
}

export async function resumeVideoJob(
  jobId: string,
  runsDir?: string,
): Promise<RunResult> {
  const profile = await requireProfile().catch((error) => {
    if (runsDir) return undefined;
    throw error;
  });
  const root = resolve(
    runsDir ?? profile?.outputDir ?? currentAppPaths().runsDir,
  );
  const store = new JobStore(root);
  const job = await store.load(jobId);
  const script = await parseScript(job.scriptPath);
  const credentials = job.parameters.mock
    ? {
        fishAudioApiKey: undefined,
        heygenApiKey: undefined,
        pexelsApiKey: undefined,
      }
    : await loadRuntimeCredentials();
  return await executeJob(job, store, script, credentials);
}
