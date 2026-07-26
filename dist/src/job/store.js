import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, } from "node:fs/promises";
import { join } from "node:path";
import { JobSchema, } from "./schema.js";
const STAGES = [
    "voice",
    "avatar",
    "media",
    "captions",
    "package",
    "publish",
];
function emptyStage(paid) {
    return {
        status: "pending",
        paid,
        artifacts: [],
        metadata: {},
    };
}
function makeJobId(now) {
    const timestamp = now
        .toISOString()
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace(/\.\d{3}Z$/, "Z");
    return `${timestamp}-${randomBytes(4).toString("hex")}`;
}
export class JobStore {
    runsDir;
    constructor(runsDir) {
        this.runsDir = runsDir;
    }
    runDir(jobId) {
        return join(this.runsDir, jobId);
    }
    jobPath(jobId) {
        return join(this.runDir(jobId), "job.json");
    }
    async create(scriptPath, scriptHash, profile, parameters = {
        speed: 1,
        pexelsEnabled: false,
        mock: false,
    }) {
        const now = new Date();
        const paid = new Set(["voice", "avatar"]);
        const stages = Object.fromEntries(STAGES.map((name) => [name, emptyStage(paid.has(name))]));
        const job = JobSchema.parse({
            schemaVersion: 1,
            id: makeJobId(now),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            scriptPath,
            scriptHash,
            profile,
            parameters,
            stages,
        });
        await this.save(job);
        return job;
    }
    async load(jobId) {
        return JobSchema.parse(JSON.parse(await readFile(this.jobPath(jobId), "utf8")));
    }
    async save(value) {
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
        }
        finally {
            await handle.close();
        }
        await rename(temporary, target);
    }
    async list() {
        try {
            const entries = await readdir(this.runsDir, { withFileTypes: true });
            const jobs = await Promise.all(entries
                .filter((entry) => entry.isDirectory())
                .map(async (entry) => await this.load(entry.name)));
            return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
    }
}
