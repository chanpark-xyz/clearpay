import OpenAI from "openai";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { cfg, WALLETS } from "./config";
import { PRIVACY_POLICIES, visibility, type DisclosureProfile } from "./policy";
import { upsertPayment, readDb, type Payment } from "./store";

const client = () => new OpenAI({ baseURL: cfg.llmBaseUrl, apiKey: cfg.llmApiKey || "missing" });

const SYSTEM = `당신은 "ClearPay 송금 비서"입니다. 사용자가 일상에서 돈을 보낼 때(월세, 부모님 용돈, 프리랜서 외주비, 기부, 경조사비, 병원비 등)
(1) 한국 세법상 어떤 거래인지 분류하고, (2) 세액공제·신고·증빙에 필요한 만큼만 공개 범위를 설계하고, (3) 마루(Maroo) 원화 스테이블코인
테스트넷의 Verifiable Privacy(VP)로 tOKRW를 보냅니다. 데모에서는 1 tOKRW = 1만 원으로 읽습니다 (예: 50 tOKRW = 50만 원, 1,000 tOKRW = 1천만 원).

VP 공개 다이얼 (체인 자체에는 금액·당사자가 절대 보이지 않음):
1) privacyPolicy — 공개 payload에 담을 필드: all-private | amount | to | amount-to | from | amount-from | from-to | amount-from-to
2) disclosureMode — 그 payload를 누가 읽는가: none(아무도) | public(누구나) | recipient-encrypted(지정 지갑의 공개키 보유자만, disclosureTo 필수)
증빙이 필요하면 amount-from-to 를 recipient-encrypted 로 taxoffice 에 보낸다. 이것이 온체인 영수증이다.

지갑(이름 → 역할): ${Object.entries(WALLETS).map(([k, v]) => `${k} → ${v.label} (${v.desc})`).join(", ")}
보내는 지갑은 특별한 말이 없으면 donor1(김민준, 나).

세법 규칙 (아래 숫자를 그대로 사용, 임의로 바꾸지 말 것):
- 기부금(지정기부금 단체): 세액공제 15%, 1천만 원(1,000 tOKRW) 초과분은 30%. 기부금 영수증 필요 → taxoffice 지정 공개.
- 월세: 세액공제 15% (총급여 5,500만 원 이하는 17%), 연 월세액 1,000만 원 한도. 임대차계약·이체 증빙 필요 → taxoffice 지정 공개. 집주인에게는 금액 외 공개 불필요.
- 프리랜서 외주비(사업소득): 지급자가 3.3% 원천징수(소득세 3% + 지방소득세 0.3%) 후 지급, 지급명세서 제출. 실지급액 = 금액 × 0.967 → taxoffice 지정 공개 (amount-from-to).
- 가족 생활비·용돈: 사회통념상 생활비는 증여세 비과세. 성인 직계존비속 간 증여는 10년 합산 5천만 원(5,000 tOKRW)까지 비과세. → all-private + none. 기록은 self-view로 남는다고 안내.
- 경조사비: 개인 간은 과세 없음. 법인 접대비 손금은 건당 20만 원(20 tOKRW) 한도. → from-to 를 public 으로 (명부), 금액 비공개.
- 의료비: 세액공제 15% (총급여 3% 초과분). 병원 결제 증빙 → taxoffice 지정 공개.
- 1천만 원(1,000 tOKRW) 이상 송금은 종류와 무관하게 taxoffice 지정 공개를 강하게 권고.
- 사용자가 공개 범위를 명시하면 사용자 우선. 금액이나 수취인이 불명확하면 실행하지 말고 되묻는다.

절차: 요청을 읽고 propose_payment 로 제안서를 만든다 (taxCategory, taxNote, taxBenefitOkrw 포함: 예상 공제액은 위 비율로 계산, 없으면 null).
제안 후 "세법상 무엇이고, 누가 무엇을 보게 되는지"를 두세 문장으로 설명하고 실행 여부를 묻는다. 사용자가 확인하면 execute_payment.
한국어로 짧고 분명하게. 사용자에게 말할 때 금액은 원 단위로 쓴다 (예: 50 tOKRW → "50만 원", 공제 7.5 → "7만 5천 원"). JSON 필드의 amountOkrw·taxBenefitOkrw 는 tOKRW 숫자 그대로.`;

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "propose_payment",
      description: "결제 제안서를 만든다. 공개 범위(privacyPolicy, disclosureMode, disclosureTo)를 결정해 저장하고 미리보기를 돌려준다.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["donation", "salary", "vendor", "gift", "other"] },
          from: { type: "string", enum: Object.keys(WALLETS) },
          to: { type: "string", enum: Object.keys(WALLETS) },
          amountOkrw: { type: "number" },
          memo: { type: "string" },
          privacyPolicy: { type: "string", enum: PRIVACY_POLICIES },
          disclosureMode: { type: "string", enum: ["none", "public", "recipient-encrypted"] },
          disclosureTo: { type: "string", enum: Object.keys(WALLETS), description: "recipient-encrypted일 때 복호화 권한을 갖는 지갑" },
          rationale: { type: "string", description: "왜 이 공개 범위인지 한 문장" },
          taxCategory: { type: "string", description: "세법상 분류" },
          taxNote: { type: "string", description: "증빙 요건·공제 포인트" },
          taxBenefitOkrw: { type: ["number", "null"], description: "예상 공제·절세액 tOKRW" },
        },
        required: ["kind", "from", "to", "amountOkrw", "privacyPolicy", "disclosureMode", "rationale", "taxCategory", "taxNote"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_payment",
      description: "사용자가 확인한 제안서를 실제로 체인에 실행한다 (예치 → 비공개 전송). 시간이 1~3분 걸린다.",
      parameters: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_payments",
      description: "지금까지의 결제 제안/실행 목록을 본다.",
      parameters: { type: "object", properties: {} },
    },
  },
];


/** Rule-based fallback when no LLM key is configured (keeps the demo alive offline). */
function ruleBased(text: string): Record<string, unknown> | null {
  const t = text.toLowerCase();
  const amt = Number((text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/) ?? [])[1]);
  if (!amt) return null;
  const tax = (category: string, note: string, benefitOkrw: number | null) => ({ taxCategory: category, taxNote: note, taxBenefitOkrw: benefitOkrw });
  const toTax = { privacyPolicy: "amount-from-to", disclosureMode: "recipient-encrypted", disclosureTo: "taxoffice" };
  if (/월세|집주인|임대/.test(t)) return { kind: "other", from: "donor1", to: "donor2", amountOkrw: amt, memo: text, ...toTax, rationale: "월세 세액공제 증빙은 국세청만 열 수 있게 붙이고, 집주인·대중에게는 금액을 숨깁니다.", ...tax("월세 세액공제", "임대차계약서와 이체 증빙이 필요하며 연 1,000만 원 한도. 총급여 5,500만 원 이하면 17%.", Math.round(amt * 0.15 * 100) / 100) };
  if (/용돈|어머니|부모|엄마|아버지|생활비/.test(t)) return { kind: "other", from: "donor1", to: "parent", amountOkrw: amt, memo: text, privacyPolicy: "all-private", disclosureMode: "none", rationale: "가족 생활비는 증여세 비과세라 아무에게도 공개할 필요가 없습니다. 기록은 self-view로만 남습니다.", ...tax("증여(비과세 생활비)", "성인 직계 간 증여는 10년 합산 5천만 원까지 비과세. 그 이하라 신고 불필요.", null) };
  if (/외주|프리랜서|디자인|용역|인건비/.test(t)) return { kind: "vendor", from: "donor1", to: "freelancer", amountOkrw: amt, memo: text, ...toTax, rationale: "사업소득 지급은 지급명세서 대상이라 국세청만 금액·당사자를 열 수 있게 하고, 경쟁사·대중에게는 단가를 숨깁니다.", ...tax("사업소득 (원천징수 3.3%)", `3.3% 원천징수 후 실지급 ${Math.round(amt * 0.967 * 100) / 100} tOKRW. 지급명세서 제출.`, null) };
  if (/기부|후원|보호소/.test(t)) return { kind: "donation", from: "donor1", to: "charity", amountOkrw: amt, memo: text, ...toTax, rationale: "기부금 영수증을 국세청 키로만 열 수 있게 붙이고, 대중에게는 기부자·금액을 숨깁니다.", ...tax("지정기부금", "세액공제 15% (1천만 원 초과분 30%). 기부금 영수증 필요.", Math.round((amt <= 1000 ? amt * 0.15 : 150 + (amt - 1000) * 0.3) * 100) / 100) };
  if (/축의|부의|경조|결혼|장례/.test(t)) return { kind: "gift", from: "donor1", to: "donor2", amountOkrw: amt, memo: text, privacyPolicy: "from-to", disclosureMode: "public", rationale: "누가 냈는지는 명부로 공개하고 금액은 숨깁니다.", ...tax("경조사비 (개인 간 비과세)", "개인 간 경조사비는 과세 없음. 법인 접대비 손금은 건당 20만 원 한도.", null) };
  if (/병원|의료|진료|약값/.test(t)) return { kind: "other", from: "donor1", to: "donor2", amountOkrw: amt, memo: text, ...toTax, rationale: "의료비 세액공제 증빙만 국세청에 보내고 진료 사실은 대중에게 숨깁니다.", ...tax("의료비 세액공제", "총급여 3% 초과분부터 15% 공제.", Math.round(amt * 0.15 * 100) / 100) };
  return { kind: "other", from: "donor1", to: "donor2", amountOkrw: amt, memo: text, privacyPolicy: "all-private", disclosureMode: "none", rationale: "기본값: 전부 비공개.", ...tax("해당 없음", "", null) };
}

/** Free-text LLM call (receipt summaries etc.). codex -> plain exec; api -> chat; rules -> null. */
export async function llmText(prompt: string): Promise<string | null> {
  if (cfg.llmProvider === "codex") {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clearpay-codex-"));
    const out = path.join(dir, "last.txt");
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", dir, "-o", out];
    if (cfg.codexModel) args.push("-m", cfg.codexModel);
    args.push(prompt);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
      let err = ""; child.stderr.on("data", (d) => { err += String(d); }); child.stdout.on("data", () => {});
      const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("codex timeout")); }, 150_000);
      child.on("error", (e) => { clearTimeout(t); reject(e); });
      child.on("close", (c) => { clearTimeout(t); c === 0 ? resolve() : reject(new Error(err.slice(-800))); });
    });
    return fs.readFile(out, "utf8");
  }
  if (cfg.llmProvider === "api" && cfg.llmApiKey) {
    const r = await client().chat.completions.create({ model: cfg.llmModel, messages: [{ role: "user", content: prompt }] });
    return r.choices[0].message.content ?? "";
  }
  return null;
}

export type AgentEvent = { role: "assistant" | "tool"; content: string; name?: string; payment?: Payment };

async function execTool(name: string, args: Record<string, unknown>, executor: (p: Payment) => Promise<Payment>) {
  if (name === "propose_payment") {
    const profile: DisclosureProfile = {
      privacyPolicy: args.privacyPolicy as DisclosureProfile["privacyPolicy"],
      disclosureMode: args.disclosureMode as DisclosureProfile["disclosureMode"],
      disclosureTo: args.disclosureTo as string | undefined,
      rationale: String(args.rationale ?? ""),
    };
    const p: Payment = {
      id: `pay_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      kind: args.kind as Payment["kind"],
      from: String(args.from), to: String(args.to),
      amountOkrw: Number(args.amountOkrw), memo: String(args.memo ?? ""),
      profile, status: "proposed", txs: [],
      tax: args.taxCategory ? { category: String(args.taxCategory), note: String(args.taxNote ?? ""), benefitOkrw: args.taxBenefitOkrw == null ? null : Number(args.taxBenefitOkrw) } : undefined,
    };
    await upsertPayment(p);
    return { result: { paymentId: p.id, preview: visibility(profile), payment: p }, payment: p };
  }
  if (name === "execute_payment") {
    const db = await readDb();
    const p = db.payments.find((x) => x.id === args.paymentId);
    if (!p) return { result: { error: "no such payment" } };
    const done = await executor(p);
    return { result: { status: done.status, txs: done.txs, error: done.error }, payment: done };
  }
  if (name === "list_payments") {
    const db = await readDb();
    return { result: db.payments.slice(0, 10).map((p) => ({ id: p.id, kind: p.kind, from: p.from, to: p.to, amountOkrw: p.amountOkrw, status: p.status, profile: p.profile })) };
  }
  return { result: { error: "unknown tool" } };
}


type Structured = { action: string; reply: string; paymentId: string | null; proposal: Record<string, unknown> | null };

async function buildStructuredPrompt(history: ChatCompletionMessageParam[]) {
  const db = await readDb();
  const recent = db.payments.slice(0, 5).map((p) => `${p.id}: ${p.from}→${p.to} ${p.amountOkrw} ${p.kind} [${p.profile.privacyPolicy}/${p.profile.disclosureMode}${p.profile.disclosureTo ? "→" + p.profile.disclosureTo : ""}] ${p.status}`).join("\n") || "(없음)";
  const convo = history.map((m) => `${m.role === "user" ? "사용자" : "에이전트"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n");
  return `${SYSTEM}

도구 대신 아래 형식의 JSON 객체 하나로만 답한다. 다른 텍스트·마크다운 금지.
{"action":"reply"|"propose"|"execute","reply":"사용자에게 보여줄 한국어 답변 2~4문장","paymentId":string|null,
 "proposal":null|{"kind":"donation"|"salary"|"vendor"|"gift"|"other","from":지갑이름,"to":지갑이름,"amountOkrw":number,"memo":string,
   "privacyPolicy":"all-private"|"amount"|"to"|"amount-to"|"from"|"amount-from"|"from-to"|"amount-from-to",
   "disclosureMode":"none"|"public"|"recipient-encrypted","disclosureTo":지갑이름|null,"rationale":string,
   "taxCategory":string,"taxNote":string,"taxBenefitOkrw":number|null}}
- 결제 요청이 명확하면 action="propose" + proposal + reply(세법상 무엇인지, 누가 무엇을 보게 되는지, 실행 여부 질문).
- 사용자가 직전 제안을 실행하라고 하면(네/응/실행/보내) action="execute" + paymentId(최근 제안 중 status=proposed).
- 정보가 부족하거나 일반 질문이면 action="reply".

최근 제안/결제:
${recent}

대화:
${convo}`;
}

async function runCodexJson(prompt: string): Promise<Structured> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clearpay-codex-"));
  const out = path.join(dir, "last.json");
  const schema = path.join(process.cwd(), "src", "lib", "codex-schema.json");
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-C", dir, "--output-schema", schema, "-o", out];
  if (cfg.codexModel) args.push("-m", cfg.codexModel);
  args.push(prompt);
  // stdin must be closed: codex exec waits for piped stdin to reach EOF otherwise.
  await new Promise<void>((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += String(d); });
    child.stdout.on("data", () => { /* progress */ });
    const t = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("codex exec timeout")); }, 150_000);
    child.on("error", (e) => { clearTimeout(t); reject(e); });
    child.on("close", (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`codex exec exit ${code}: ${err.slice(-1500)}`)); });
  });
  return JSON.parse(await fs.readFile(out, "utf8")) as Structured;
}

/** OpenAI-compatible JSON mode (works with A.X K2, which does not reliably emit tool calls). */
async function runApiJson(prompt: string): Promise<Structured> {
  const r = await client().chat.completions.create({
    model: cfg.llmModel,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const txt = r.choices[0].message.content ?? "{}";
  const m = txt.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : txt) as Structured;
}

/** Structured provider turn (codex or api): one JSON decision per turn, then act on it. */
async function structuredTurn(
  history: ChatCompletionMessageParam[],
  executor: (p: Payment) => Promise<Payment>,
): Promise<{ messages: ChatCompletionMessageParam[]; events: AgentEvent[] }> {
  const prompt = await buildStructuredPrompt(history);
  const r = cfg.llmProvider === "codex" ? await runCodexJson(prompt) : await runApiJson(prompt);
  const events: AgentEvent[] = [];
  if (r.action === "propose" && r.proposal) {
    const args2 = { ...r.proposal, disclosureTo: r.proposal.disclosureTo ?? undefined };
    const { payment } = await execTool("propose_payment", args2, executor);
    events.push({ role: "tool", name: "propose_payment", content: "", payment });
  } else if (r.action === "execute") {
    const db = await readDb();
    const id = r.paymentId && db.payments.some((p) => p.id === r.paymentId) ? r.paymentId : db.payments.find((p) => p.status === "proposed")?.id;
    if (id) {
      const { payment } = await execTool("execute_payment", { paymentId: id }, executor);
      events.push({ role: "tool", name: "execute_payment", content: "", payment });
      if (payment?.status === "done") r.reply = `보냈어요. ${payment.txs.filter((t) => t.action !== "prepare_dummy").map((t) => `${t.action}: ${t.explorer}`).join(" / ")}`;
      else if (payment) r.reply = `실행 실패: ${(payment.error ?? "").split("\n").filter((l) => /Error|잔액|error/.test(l)).slice(-1)[0] ?? payment.error}`;
    } else {
      r.reply = "실행할 제안이 없어요. 먼저 보낼 내용을 말해 주세요.";
    }
  }
  events.push({ role: "assistant", content: r.reply ?? "" });
  return { messages: [...history, { role: "assistant", content: r.reply ?? "" }], events };
}

/** One agent turn: runs the tool loop until the model answers in text. */
export async function agentTurn(
  history: ChatCompletionMessageParam[],
  executor: (p: Payment) => Promise<Payment>,
): Promise<{ messages: ChatCompletionMessageParam[]; events: AgentEvent[] }> {
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM }, ...history];
  const events: AgentEvent[] = [];
  if (cfg.llmProvider === "codex") return structuredTurn(history, executor);
  if (cfg.llmProvider === "api" && cfg.llmApiKey) return structuredTurn(history, executor);
  if (cfg.llmProvider === "rules" || !cfg.llmApiKey) {
    const last = history[history.length - 1];
    const text = typeof last?.content === "string" ? last.content : "";
    const args = ruleBased(text);
    if (!args) {
      events.push({ role: "assistant", content: "(LLM 키 없음 · 규칙 모드) 금액과 수취인을 포함해 말씀해 주세요. 예: 보호소에 30 기부, 영수증 필요" });
      return { messages: history, events };
    }
    const { result, payment } = await execTool("propose_payment", args, executor);
    events.push({ role: "tool", name: "propose_payment", content: JSON.stringify(result), payment });
    events.push({ role: "assistant", content: `(규칙 모드) ${String(args.rationale)} 카드의 "이대로 실행"을 누르면 체인에 실행합니다.` });
    return { messages: history, events };
  }
  for (let i = 0; i < 6; i++) {
    const r = await client().chat.completions.create({ model: cfg.llmModel, messages, tools, tool_choice: "auto" });
    const m = r.choices[0].message;
    messages.push(m as ChatCompletionMessageParam);
    if (!m.tool_calls?.length) {
      events.push({ role: "assistant", content: m.content ?? "" });
      break;
    }
    for (const tc of m.tool_calls) {
      if (tc.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }
      const { result, payment } = await execTool(tc.function.name, args, executor);
      events.push({ role: "tool", name: tc.function.name, content: JSON.stringify(result), payment });
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return { messages: messages.slice(1), events };
}
