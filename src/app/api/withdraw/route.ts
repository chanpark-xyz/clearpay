import { NextResponse } from "next/server";
import { withdraw } from "@/lib/executor";
import { vp } from "@/lib/vp";

export const maxDuration = 600;

export async function POST(req: Request) {
  const { name, amountOkrw, recipient } = await req.json();
  try {
    const to = recipient ?? String((await vp("addr", String(name))).bech32);
    return NextResponse.json(await withdraw(String(name), Number(amountOkrw), to));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
