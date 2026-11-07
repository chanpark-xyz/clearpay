import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cfg } from "./config";

const run = promisify(execFile);

export type VpResult = Record<string, unknown>;

/** Runs maroo-privacy-testnet/scripts/vp.sh and returns the last JSON line. */
export async function vp(cmd: string, ...args: string[]): Promise<VpResult> {
  const script = `${cfg.vpDir}/scripts/vp.sh`;
  const { stdout, stderr } = await run(script, [cmd, ...args], {
    maxBuffer: 1 << 24,
    timeout: 15 * 60 * 1000,
  });
  const lines = stdout.trim().split("\n");
  const last = lines[lines.length - 1];
  try {
    return { ...(JSON.parse(last) as VpResult), _log: stderr.slice(-4000) };
  } catch {
    throw new Error(`vp.sh ${cmd} returned non-JSON: ${last}\n${stderr.slice(-2000)}`);
  }
}

export const toAtokrw = (okrw: number | string) =>
  (BigInt(Math.round(Number(okrw) * 1e6)) * 10n ** 12n).toString();
export const fromAtokrw = (a: string | bigint) => Number(BigInt(a) / 10n ** 12n) / 1e6;
