import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
export async function runProcess(command, args, options = {}) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.env === undefined ? {} : { env: options.env }),
            shell: false,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            resolve({ code: code ?? 1, stdout, stderr });
        });
    });
}
export function npxInvocation(args, platform = process.platform, nodePath = process.execPath) {
    if (platform !== "win32") {
        return { command: "npx", args };
    }
    return {
        command: nodePath,
        args: [
            join(dirname(nodePath), "node_modules", "npm", "bin", "npx-cli.js"),
            ...args,
        ],
    };
}
