import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProviderContext,
  StageProvider,
  StageResult,
} from "../src/contracts.js";
import {
  AmbiguousPaidRequestError,
  JobEngine,
  invalidateForChange,
} from "../src/job/engine.js";
import type { Job } from "../src/job/schema.js";
import { JobStore } from "../src/job/store.js";

function makeProvider(options: {
  hash?: string;
  paid?: boolean;
  error?: Error;
  result?: StageResult;
}): StageProvider<Record<string, never>> & {
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(
    async (
      _input: Record<string, never>,
      _context: ProviderContext,
    ): Promise<StageResult> => {
      if (options.error) throw options.error;
      return options.result ?? { artifacts: [], metadata: { ok: true } };
    },
  );
  return {
    stage: "voice",
    paid: options.paid ?? true,
    inputHash: async () => options.hash ?? "voice-hash",
    execute,
  };
}

describe("JobEngine", () => {
  let store: JobStore;
  let engine: JobEngine;
  let job: Job;

  beforeEach(async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "video-agent-jobs-"));
    store = new JobStore(runsDir);
    engine = new JobEngine(store);
    job = await store.create("script.md", "script-hash", {
      voiceId: "voice-3",
      avatarId: "avatar-middle",
      language: "zh",
      width: 720,
      height: 1280,
      fps: 30,
    });
  });

  it("reuses a completed paid stage when the input hash is unchanged", async () => {
    const provider = makeProvider({});
    const first = await engine.runStage(job, provider, {});
    const second = await engine.runStage(first, provider, {});

    expect(provider.execute).toHaveBeenCalledTimes(1);
    expect(second.stages.voice.status).toBe("completed");
  });

  it("invalidates voice and all downstream stages after script changes", () => {
    const completed = structuredClone(job);
    for (const stage of Object.values(completed.stages)) {
      stage.status = "completed";
      stage.inputHash = "old";
    }

    const invalidated = invalidateForChange(completed, "script");

    expect(
      Object.values(invalidated.stages).every(
        (stage) => stage.status === "pending",
      ),
    ).toBe(true);
  });

  it("changes to cover inputs preserve paid voice and avatar stages", () => {
    const completed = structuredClone(job);
    for (const stage of Object.values(completed.stages)) {
      stage.status = "completed";
      stage.inputHash = "old";
    }

    const invalidated = invalidateForChange(completed, "cover");

    expect(invalidated.stages.voice.status).toBe("completed");
    expect(invalidated.stages.avatar.status).toBe("completed");
    expect(invalidated.stages.package.status).toBe("pending");
    expect(invalidated.stages.publish.status).toBe("pending");
  });

  it("marks an ambiguous paid timeout unknown and never auto-repeats it", async () => {
    const provider = makeProvider({
      error: new AmbiguousPaidRequestError("timeout after request body"),
    });
    const result = await engine.runStage(job, provider, {});

    expect(result.stages.voice.status).toBe("unknown");
    await expect(engine.runStage(result, provider, {})).rejects.toThrow(
      "manual recovery",
    );
    expect(provider.execute).toHaveBeenCalledTimes(1);
  });

  it("recovers a paid provider task ID instead of creating it again", async () => {
    const execute = vi.fn(async () => {
      await engine.persistProviderTaskId(job.id, "voice", "paid-task-123");
      throw new Error("polling temporarily unavailable");
    });
    const recover = vi.fn(async (): Promise<StageResult> => ({
      artifacts: [],
      providerTaskId: "paid-task-123",
      metadata: { recovered: true },
    }));
    const provider: StageProvider<Record<string, never>> = {
      stage: "voice",
      paid: true,
      inputHash: async () => "voice-hash",
      execute,
      recover,
    };

    await expect(engine.runStage(job, provider, {})).rejects.toThrow(
      "polling temporarily unavailable",
    );
    const failed = await store.load(job.id);
    expect(failed.stages.voice.providerTaskId).toBe("paid-task-123");

    const recovered = await engine.runStage(failed, provider, {});

    expect(execute).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recovered.stages.voice.status).toBe("completed");
  });
});
