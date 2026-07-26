import { resolve } from "node:path";
import { currentAppPaths } from "../config/paths.js";
import { loadProfile } from "../config/profile.js";
import { JobStore } from "../job/store.js";
function summarize(job) {
    const current = Object.entries(job.stages).find(([, stage]) => stage.status !== "completed")?.[0] ?? "completed";
    return {
        jobId: job.id,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        current,
        stages: Object.fromEntries(Object.entries(job.stages).map(([name, stage]) => [
            name,
            {
                status: stage.status,
                providerTaskId: stage.providerTaskId,
                error: stage.error,
                artifacts: stage.artifacts.map((artifact) => artifact.path),
            },
        ])),
    };
}
export async function runStatus(jobId, runsDir) {
    let root = runsDir;
    if (!root) {
        try {
            root = (await loadProfile(currentAppPaths().profilePath)).outputDir;
        }
        catch {
            root = currentAppPaths().runsDir;
        }
    }
    const store = new JobStore(resolve(root));
    if (jobId)
        return summarize(await store.load(jobId));
    return (await store.list()).map(summarize);
}
