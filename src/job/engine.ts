import type {
  StageName,
  StageProvider,
  StageResult,
} from "../contracts.js";
import type { Job, StageRecord } from "./schema.js";
import { JobStore } from "./store.js";

export const STAGE_ORDER = [
  "voice",
  "avatar",
  "media",
  "captions",
  "package",
  "publish",
] as const satisfies readonly StageName[];

export class AmbiguousPaidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousPaidRequestError";
  }
}

function resetStage(stage: StageRecord): StageRecord {
  return {
    status: "pending",
    paid: stage.paid,
    artifacts: [],
    metadata: {},
  };
}

function invalidateFrom(job: Job, first: StageName): Job {
  const copy = structuredClone(job);
  const firstIndex = STAGE_ORDER.indexOf(first);
  for (const name of STAGE_ORDER.slice(firstIndex)) {
    copy.stages[name] = resetStage(copy.stages[name]);
  }
  return copy;
}

export function invalidateForChange(
  job: Job,
  change: "script" | "cover",
): Job {
  return invalidateFrom(job, change === "script" ? "voice" : "package");
}

function completedRecord(
  current: StageRecord,
  inputHash: string,
  result: StageResult,
): StageRecord {
  return {
    status: "completed",
    paid: current.paid,
    inputHash,
    ...(result.providerTaskId === undefined
      ? current.providerTaskId === undefined
        ? {}
        : { providerTaskId: current.providerTaskId }
      : { providerTaskId: result.providerTaskId }),
    artifacts: result.artifacts,
    metadata: result.metadata,
    ...(current.startedAt === undefined
      ? {}
      : { startedAt: current.startedAt }),
    completedAt: new Date().toISOString(),
  };
}

export class JobEngine {
  constructor(private readonly store: JobStore) {}

  async persistProviderTaskId(
    jobId: string,
    stage: StageName,
    providerTaskId: string,
  ): Promise<void> {
    const job = await this.store.load(jobId);
    job.stages[stage].providerTaskId = providerTaskId;
    await this.store.save(job);
  }

  async runStage<TInput>(
    original: Job,
    provider: StageProvider<TInput>,
    input: TInput,
  ): Promise<Job> {
    let job = structuredClone(original);
    const inputHash = await provider.inputHash(input);
    let current = job.stages[provider.stage];

    if (current.status === "completed" && current.inputHash === inputHash) {
      return job;
    }
    if (current.status === "completed" && current.inputHash !== inputHash) {
      job = invalidateFrom(job, provider.stage);
      current = job.stages[provider.stage];
    }

    if (
      (current.status === "unknown" || current.status === "failed") &&
      current.providerTaskId &&
      provider.recover
    ) {
      const result = await provider.recover(
        current.providerTaskId,
        input,
        { jobId: job.id, runDir: this.store.runDir(job.id) },
      );
      job.stages[provider.stage] = completedRecord(
        current,
        inputHash,
        result,
      );
      await this.store.save(job);
      return job;
    }

    if (current.status === "unknown") {
      throw new Error(
        "Paid stage outcome is unknown; manual recovery is required",
      );
    }

    if (current.status === "running" && provider.paid) {
      current.status = "unknown";
      current.error = "Process stopped while a paid request was running";
      await this.store.save(job);
      throw new Error(
        "Paid stage outcome is unknown; manual recovery is required",
      );
    }

    job.stages[provider.stage] = {
      status: "running",
      paid: provider.paid,
      inputHash,
      ...(current.providerTaskId === undefined
        ? {}
        : { providerTaskId: current.providerTaskId }),
      artifacts: [],
      metadata: {},
      startedAt: new Date().toISOString(),
    };
    await this.store.save(job);

    try {
      const result = await provider.execute(input, {
        jobId: job.id,
        runDir: this.store.runDir(job.id),
      });
      job.stages[provider.stage] = completedRecord(
        job.stages[provider.stage],
        inputHash,
        result,
      );
      await this.store.save(job);
      return job;
    } catch (error) {
      const persisted = await this.store.load(job.id);
      const record = persisted.stages[provider.stage];
      record.error = (error as Error).message;
      if (provider.paid && error instanceof AmbiguousPaidRequestError) {
        record.status = "unknown";
        await this.store.save(persisted);
        return persisted;
      }
      record.status = "failed";
      await this.store.save(persisted);
      throw error;
    }
  }
}
