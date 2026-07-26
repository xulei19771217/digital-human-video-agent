#!/usr/bin/env node
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Command, CommanderError } from "commander";

import {
  createDefaultDoctorDependencies,
  runDoctor,
} from "./commands/doctor.js";
import {
  createDefaultSetupDependencies,
  runSetup,
} from "./commands/setup.js";
import { loadCredentials } from "./config/credentials.js";
import { currentAppPaths } from "./config/paths.js";

async function currentCredentials() {
  const paths = currentAppPaths();
  return await loadCredentials({
    processEnv: process.env,
    projectEnvPath: join(process.cwd(), ".env"),
    userEnvPath: paths.credentialsPath,
  });
}

export async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name("video-agent")
    .description("Turn a script into a digital-human video publishing pack")
    .exitOverride()
    .showHelpAfterError();

  program
    .command("setup")
    .description("Configure providers and defaults")
    .action(async () => {
      const profile = await runSetup(
        await currentCredentials(),
        createDefaultSetupDependencies(),
      );
      process.stdout.write(
        `${JSON.stringify({ configured: true, profile }, null, 2)}\n`,
      );
    });
  program
    .command("doctor")
    .description("Check local readiness")
    .option("--json", "Print a machine-readable report")
    .action(async (options: { json?: boolean }) => {
      const report = await runDoctor(
        await currentCredentials(),
        createDefaultDoctorDependencies(),
      );
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        for (const check of report.checks) {
          process.stdout.write(
            `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}\n`,
          );
        }
      }
      if (!report.ready) process.exitCode = 10;
    });
  program.command("run").argument("<script>", "Markdown script path");
  program.command("status").argument("[job-id]");
  program.command("resume").argument("<job-id>");

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    throw error;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = await main(process.argv);
}
