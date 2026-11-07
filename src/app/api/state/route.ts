import { NextResponse } from "next/server";
import { WALLETS, cfg } from "@/lib/config";
import { vp, fromAtokrw } from "@/lib/vp";
import { readDb } from "@/lib/store";


export async function GET(req: Request) {
  const url = new URL(req.url);
  const withNotes = url.searchParams.get("notes") === "1";
  const names = Object.keys(WALLETS);
  const wallets = await Promise.all(
    names.map(async (n) => {
      const [a, b] = await Promise.all([vp("addr", n), vp("balance", n)]);
      let shielded: unknown = null;
      if (withNotes) {
        try {
          const r = await vp("notes", n);
          const notes = r.notes as { summary?: { spendable_by_asset?: Record<string, string>; spendable_count?: number } };
          const spend = notes?.summary?.spendable_by_asset ?? {};
          const total = Object.values(spend).reduce((acc, v) => acc + BigInt(v), 0n);
          shielded = { okrw: fromAtokrw(total), count: notes?.summary?.spendable_count ?? 0 };
        } catch (e) { shielded = { error: String(e) }; }
      }
      return { name: n, ...WALLETS[n as keyof typeof WALLETS], evm: a.evm, shieldedAddr: a.shielded, okrw: fromAtokrw(String(b.atokrw)), shielded };
    }),
  );
  let pool: unknown = null;
  try { pool = await vp("pool"); } catch (e) { pool = { error: String(e) }; }
  const db = await readDb();
  return NextResponse.json({ wallets, pool, payments: db.payments, provider: cfg.llmProvider });
}
