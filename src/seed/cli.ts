#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import type { SeedModule, SeedScenario } from "./types";

type CliCommand = "seed" | "backfill" | "status";

export type SeedCliOptions = {
  modulePath: string;
  command: CliCommand;
  target: string;
  days: number;
  scale: number;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function parseSeedCliArgs(argv: string[]): SeedCliOptions {
  const command = (argv[2] as CliCommand | undefined) ?? "seed";
  const target = argv[3] ?? "all";

  if (!["seed", "backfill", "status"].includes(command)) {
    throw new Error(`Unknown command "${command}". Use seed, backfill, or status.`);
  }

  const flagMap = new Map<string, string>();
  for (let i = 4; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flagMap.set(key, "true");
      continue;
    }
    flagMap.set(key, next);
    i += 1;
  }

  const modulePath = flagMap.get("module") ?? "";
  if (!modulePath) {
    throw new Error("Missing --module <path-to-scenario-module>");
  }

  return {
    modulePath,
    command,
    target,
    days: parseNumber(flagMap.get("days"), 80),
    scale: parseNumber(flagMap.get("scale"), 3),
  };
}

function resolveScenario<TContext, TTarget extends string, TStatus>(
  loaded: SeedModule<TContext, TTarget, TStatus>
): SeedScenario<TContext, TTarget, TStatus> {
  if ("seed" in (loaded as any) && "createContext" in (loaded as any)) {
    return loaded as SeedScenario<TContext, TTarget, TStatus>;
  }
  if ("default" in (loaded as any)) {
    return (loaded as any).default as SeedScenario<TContext, TTarget, TStatus>;
  }
  if ("scenario" in (loaded as any)) {
    return (loaded as any).scenario as SeedScenario<TContext, TTarget, TStatus>;
  }
  throw new Error(
    "Module does not export a scenario. Export default scenario or named export 'scenario'."
  );
}

export async function runSeedCli(argv: string[]): Promise<void> {
  const options = parseSeedCliArgs(argv);
  const absoluteModulePath = resolve(process.cwd(), options.modulePath);
  const moduleUrl = pathToFileURL(absoluteModulePath).toString();
  const loaded = (await import(moduleUrl)) as SeedModule<any, any, any>;
  const scenario = resolveScenario(loaded);

  if (options.command === "seed") {
    const context = scenario.createContext(options.days, options.scale);
    const results = await scenario.seed(options.target, context);
    console.log(JSON.stringify({ command: "seed", target: options.target, results }, null, 2));
    return;
  }

  if (options.command === "backfill") {
    await scenario.backfill();
    console.log(JSON.stringify({ command: "backfill", ok: true }, null, 2));
    return;
  }

  const status = await scenario.status();
  console.log(JSON.stringify({ command: "status", status }, null, 2));
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).toString()
  : false;

if (isDirectRun) {
  runSeedCli(process.argv).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
