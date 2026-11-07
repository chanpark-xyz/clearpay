import { promises as fs } from "node:fs";
import path from "node:path";
import type { DisclosureProfile } from "./policy";

export interface Payment {
  id: string;
  createdAt: string;
  kind: "donation" | "salary" | "vendor" | "gift" | "other";
  from: string;
  to: string;
  amountOkrw: number;
  memo: string;
  profile: DisclosureProfile;
  tax?: { category: string; note: string; benefitOkrw: number | null };
  status: "proposed" | "executing" | "done" | "failed";
  txs: { action: string; hash: string; explorer: string }[];
  error?: string;
}

const file = path.join(process.cwd(), "data", "db.json");
type Db = { payments: Payment[] };

export async function readDb(): Promise<Db> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return { payments: [] }; }
}
export async function writeDb(db: Db) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(db, null, 2));
}
export async function upsertPayment(p: Payment) {
  const db = await readDb();
  const i = db.payments.findIndex((x) => x.id === p.id);
  if (i >= 0) db.payments[i] = p; else db.payments.unshift(p);
  await writeDb(db);
  return p;
}
export async function getPayment(id: string) {
  return (await readDb()).payments.find((p) => p.id === id);
}
