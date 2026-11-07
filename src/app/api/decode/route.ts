import { NextResponse } from "next/server";
import { vp } from "@/lib/vp";

export const maxDuration = 300;

/** A designated wallet (e.g. taxoffice) decodes the disclosure attached to a transfer tx. */
export async function POST(req: Request) {
  const { name, evmTxHash, plane = "auto" } = await req.json();
  try {
    const info = await vp("txinfo", String(evmTxHash));
    const cosmos = String(info.cosmosHash ?? "");
    if (!cosmos) return NextResponse.json({ error: "cosmos tx hash not found", info }, { status: 404 });
    const decoded = await vp("decode", String(name), cosmos, String(plane));
    return NextResponse.json({ info, decoded });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
