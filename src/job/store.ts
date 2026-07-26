import { randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import { join } from "node:path";

import type { StageName } from "../contracts.js";
import {
  type Job,
  JobSchema,
  type StageRecord,
} from "./schema.js";

const STAGES: StageName[] = [
  "voice",
  "avatar",
  "media",
  "captions",
  "package",
  "publish",
];

function emptyStage(paid: boolean): StageRecord {
  return {
    status: "pending",
    paid,
    artifacts: [],
    metadata: {},
  };
}

function makeJobId(now: Date): string {
  const timestamp = now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
}

export class JobStore {
  constructor(readonly runsDir: string) {}

  runDir(jobId: string): string {
    return join(this.runsDir, jobId);
  }

  private jobPath(jobId: string): string {
    return join(this.runDir(jobId), "job.json");
  }

  async create(
    scriptPath: string,
    scriptHash: string,
    profile: Job["profile"],
  ): Promise<Job> {
    const now = new Date();
    const paid = new Set<StageName>(["voice", "avatar"]);
    const stages = Object.fromEntries(
      STAGES.map((name) => [name, emptyStage(paid.has(name))]),
    ) as Job["stages"];
    const job = JobSchema.parse({
      schemaVersion: 1,
      id: makeJobId(now),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      scriptPath,
      scriptHash,
      profile,
      stages,
    });
    await this.save(job);
    return job;
  }

  async load(jobId: string): Promise<Job> {
    return JobSchema.parse(
      JSON.parse(await readFile(this.jobPath(jobId), "utf8")),
    );
  }

  async save(value: Job): Promise<void> {
    const job = JobSchema.parse({
      ...value,
      updatedAt: new Date().toISOString(),
    });
    const runDir = this.runDir(job.id);
    await mkdir(runDir, { recursive: true });
    const target = this.jobPath(job.id);
    const temporary = `${target}.tmp`;
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(`${JSON.stringify(job, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  }

  async list(): Promise<Job[]> {
    try {
      const entries = await readdir(this.runsDir, { withFileTypes: true });
      const jobs = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => await this.load(entry.name)),
      );
      return jobs.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
