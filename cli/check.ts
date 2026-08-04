#!/usr/bin/env node
/**
 * node-verdict check — CI performance gate.
 *
 *   npx node-verdict check trace.json [--config gate.json] [--json] [--report out.md]
 *
 * Exit codes:
 *   0  gate PASS
 *   1  gate FAIL (rules violated)
 *   2  usage / input error
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  evaluateTraceGate,
  formatGateReport,
  defaultGateConfig,
} from '../src/shared/gate/performance-gate.ts';
import type { GateConfig } from '../src/shared/gate/performance-gate.ts';

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json' || arg === '-j') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-v') flags.version = true;
    else if (arg.startsWith('--config=')) flags.config = arg.slice('--config='.length);
    else if (arg === '--config') flags.config = argv[++i];
    else if (arg.startsWith('--report=')) flags.report = arg.slice('--report='.length);
    else if (arg === '--report') flags.report = argv[++i];
    else if (arg.startsWith('--threshold=')) flags.threshold = arg.slice('--threshold='.length);
    else positional.push(arg);
  }
  return { positional, flags };
}

function printHelp() {
  console.log(`node-verdict check — CI performance gate

Usage:
  node-verdict check <trace.json|trace.ndv> [options]

Options:
  --config <file>       JSON file overriding gate thresholds
  --json                Output machine-readable JSON result
  --report <file.md>    Write a markdown report to the given file
  --threshold=k=v       Override a single threshold (e.g. p99MaxMs=250)
  --version, -v         Print the CLI version
  --help, -h            Show this help

Exit codes:
  0  gate PASS
  1  gate FAIL (a rule was violated)
  2  usage or input error
`);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    console.log(readVersion());
    process.exit(0);
  }

  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  // Support both `node-verdict check <file>` and `node-verdict <file>`.
  const fileArg = positional[0] === 'check' ? positional[1] : positional[0];
  const file = fileArg;
  if (positional.length === 0 || (positional[0] === 'check' && positional.length === 1)) {
    console.error('error: missing trace file. Run `node-verdict check --help`.');
    process.exit(2);
  }
  if (!file) {
    console.error('error: missing trace file.');
    process.exit(2);
  }

  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch (err) {
    console.error(`error: cannot read file ${file}: ${(err as Error).message}`);
    process.exit(2);
  }

  // .ndv files are binary; everything else is treated as text JSON.
  const content: string | ArrayBuffer = /\.ndv$/i.test(file)
    ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    : raw.toString('utf-8');

  const config: Partial<GateConfig> = {};
  if (typeof flags.config === 'string') {
    try {
      Object.assign(config, JSON.parse(readFileSync(flags.config, 'utf-8')));
    } catch (err) {
      console.error(`error: cannot read config ${flags.config}: ${(err as Error).message}`);
      process.exit(2);
    }
  }
  if (typeof flags.threshold === 'string') {
    const parts = flags.threshold.split('=');
    if (parts.length === 2 && parts[0] in defaultGateConfig) {
      (config as Record<string, unknown>)[parts[0]] = Number(parts[1]);
    } else {
      console.error(`error: invalid threshold override "${flags.threshold}". Expected one of: p99MaxMs, n1SqlMaxCount, eventLoopDelayMaxMs`);
      process.exit(2);
    }
  }

  let result;
  try {
    result = evaluateTraceGate(content, config);
  } catch (err) {
    console.error(`error: failed to analyze trace: ${(err as Error).message}`);
    process.exit(2);
  }

  const sourceName = file.split(/[\\/]/).pop();
  const report = formatGateReport(result, sourceName);

  if (flags.report) {
    try {
      writeFileSync(resolve(flags.report), report);
    } catch (err) {
      console.error(`error: cannot write report ${flags.report}: ${(err as Error).message}`);
      process.exit(2);
    }
  }

  if (flags.json) {
    console.log(JSON.stringify({ passed: result.passed, rules: result.rules, metrics: result.metrics }, null, 2));
  } else {
    console.log(report);
  }

  process.exit(result.passed ? 0 : 1);
}

main();
