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
import {
  CliError,
  ExitCode,
  resumeVideoJob,
  runVideoJob,
} from "./commands/run.js";
import { runStatus } from "./commands/status.js";
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
  let commandExitCode: number = ExitCode.ok;
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
      if (!report.ready) commandExitCode = ExitCode.notConfigured;
    });
  program
    .command("run")
    .argument("<script>", "Markdown script path")
    .option("--voice <voice-id>", "Override the default Fish Audio voice")
    .option("--avatar <avatar-id>", "Override the default HeyGen avatar")
    .option(
      "--speed <number>",
      "Narration speed from 0.5 through 2.0",
      Number,
    )
    .option("--media-dir <path>", "Directory containing local B-roll")
    .option("--output-dir <path>", "Runs directory")
    .option("--mock", "Use local mock voice and avatar providers")
    .action(
      async (
        script: string,
        options: {
          voice?: string;
          avatar?: string;
          speed?: number;
          mediaDir?: string;
          outputDir?: string;
          mock?: boolean;
        },
      ) => {
        const result = await runVideoJob(script, options);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      },
    );
  program
    .command("status")
    .argument("[job-id]")
    .option("--runs-dir <path>", "Override the configured runs directory")
    .action(async (jobId: string | undefined, options: { runsDir?: string }) => {
      process.stdout.write(
        `${JSON.stringify(await runStatus(jobId, options.runsDir), null, 2)}\n`,
      );
    });
  program
    .command("resume")
    .argument("<job-id>")
    .option("--runs-dir <path>", "Override the configured runs directory")
    .action(async (jobId: string, options: { runsDir?: string }) => {
      const result = await resumeVideoJob(jobId, options.runsDir);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  try {
    await program.parseAsync(argv);
    return commandExitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    const message = (error as Error).message;
    process.stderr.write(`${message}\n`);
    if (error instanceof CliError) return error.exitCode;
    if (message.includes("manual recovery")) {
      return ExitCode.unknownPaidOutcome;
    }
    if (message.includes("HyperFrames") || message.includes("render")) {
      return ExitCode.renderFailure;
    }
    return ExitCode.providerFailure;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = await main(process.argv);
}
