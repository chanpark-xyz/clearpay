import { NextResponse } from "next/server";
import { agentTurn } from "@/lib/agent";
import { executePayment } from "@/lib/executor";

export const maxDuration = 600;

export async function POST(req: Request) {
  const { history = [], message } = await req.json();
  try {
    const out = await agentTurn([...history, { role: "user", content: String(message) }], executePayment);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
