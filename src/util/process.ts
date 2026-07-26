import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

export async function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function npxInvocation(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  nodePath: string = process.execPath,
): { command: string; args: string[] } {
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
