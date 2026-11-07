import { NextResponse } from "next/server";
import { readDb, writeDb } from "@/lib/store";

/** DELETE ?id=… removes a proposed/failed record (done records are on-chain and stay). */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const db = await readDb();
  const p = db.payments.find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (p.status === "done") return NextResponse.json({ error: "on-chain record cannot be removed" }, { status: 400 });
  db.payments = db.payments.filter((x) => x.id !== id);
  await writeDb(db);
  return NextResponse.json({ ok: true });
}
