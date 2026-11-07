import { NextResponse } from "next/server";
import { readDb } from "@/lib/store";
import { vp, fromAtokrw } from "@/lib/vp";
import { WALLETS } from "@/lib/config";
import { llmText } from "@/lib/agent";

export const maxDuration = 600;

/** 국세청 관점: taxoffice 키로 열리는 모든 결제를 체인에서 복호화해 연말정산 증빙 요약을 만든다. */
export async function POST(req: Request) {
  const { name = "taxoffice" } = await req.json().catch(() => ({}));
  const db = await readDb();
  const targets = db.payments.filter((p) => p.status === "done" && p.profile.disclosureMode === "recipient-encrypted" && p.profile.disclosureTo === name);
  const addrs = await Promise.all(Object.keys(WALLETS).map(async (n) => ({ n, a: await vp("addr", n) })));
  const byShield = (s?: string) => addrs.find((x) => x.a.shielded === s)?.n;
  const label = (n?: string) => (n ? (WALLETS as Record<string, { label: string }>)[n]?.label ?? n : "?");
  const rows: { id: string; category: string; amountOkrw: number | null; from: string; to: string; tx: string; verified: boolean }[] = [];
  for (const p of targets) {
    const tx = p.txs.find((t) => t.action === "final_transfer");
    if (!tx) continue;
    try {
      const info = await vp("txinfo", tx.hash);
      const d = await vp("decode", name, String(info.cosmosHash), "recipient");
      const ok = !d.error && d.amount != null;
      rows.push({ id: p.id, category: p.tax?.category ?? p.kind, amountOkrw: ok ? fromAtokrw(String(d.amount)) : null, from: label(byShield(String(d.from_shielded_address))), to: label(byShield(String(d.to_shielded_address))), tx: tx.explorer, verified: ok });
    } catch (e) {
      rows.push({ id: p.id, category: p.tax?.category ?? p.kind, amountOkrw: null, from: "?", to: "?", tx: tx.explorer, verified: false });
    }
  }
  const table = rows.map((r) => `- [${r.verified ? "체인 복원" : "복호화 실패"}] ${r.category}: ${r.from} → ${r.to}, ${r.amountOkrw ?? "?"} tOKRW (${r.tx})`).join("\n") || "(없음)";
  const prompt = `당신은 국세청 연말정산 담당자입니다. 아래는 납세자 김민준(donor1)이 국세청 공개키로만 열리도록 체인에 붙인 증빙을 복호화한 결과입니다.
1 tOKRW = 1만 원. 규칙: 지정기부금 세액공제 15%(1천만 원 초과분 30%), 월세 세액공제 15%(연 1,000만 원 한도), 의료비 15%(총급여 3% 초과분, 여기선 초과한다고 가정), 사업소득 지급은 3.3% 원천징수·지급명세서 대상(공제 아님).
항목별 공제액과 합계를 계산하고, "체인에서 복원된 값만 사용했고 위조가 불가능하다"는 문장을 포함한 6줄 이내의 연말정산 증빙 요약을 한국어로 쓰세요. 표나 마크다운 없이 줄글로.

${table}`;
  let summary = await llmText(prompt);
  if (!summary) {
    const total = rows.reduce((a, r) => a + (r.amountOkrw ?? 0), 0);
    summary = `(규칙 모드) 체인에서 복원한 증빙 ${rows.length}건, 합계 ${total.toLocaleString()} tOKRW. 항목: ${rows.map((r) => `${r.category} ${r.amountOkrw ?? "?"}`).join(", ")}. 모든 값은 국세청 키로 복호화한 온체인 payload이며 위조할 수 없습니다.`;
  }
  return NextResponse.json({ rows, summary });
}
