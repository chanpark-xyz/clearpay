import { NextResponse } from "next/server";
import { getPayment } from "@/lib/store";
import { executePayment } from "@/lib/executor";

export const maxDuration = 600;

export async function POST(req: Request) {
  const { paymentId } = await req.json();
  const p = await getPayment(String(paymentId));
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await executePayment(p));
}
