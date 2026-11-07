"use client";
import { useEffect, useRef, useState } from "react";

type Tx = { action: string; hash: string; explorer: string };
type Profile = { privacyPolicy: string; disclosureMode: string; disclosureTo?: string; rationale: string };
type Payment = { id: string; createdAt: string; kind: string; from: string; to: string; amountOkrw: number; memo: string; profile: Profile; tax?: { category: string; note: string; benefitOkrw: number | null }; status: string; txs: Tx[]; error?: string };
type Wallet = { name: string; label: string; role: string; evm: string; shieldedAddr: string; okrw: number };
type State = { wallets: Wallet[]; pool: { reserve?: { module_balance?: string }; tree?: unknown[][] }; payments: Payment[]; provider: string };
type Msg = { role: "user" | "assistant" | "tool"; content: string; name?: string; payment?: Payment };
type Check = { loading?: boolean; ok?: boolean; amount?: string | null; from?: string; to?: string; error?: string };
type Field = "amount" | "from" | "to";
type Lens = "public" | "to" | "taxoffice" | "me";

/** Templates: clicking fills the phone input (the user still presses send). */
const TEMPLATES = [
  { id: "rent", icon: "🏠", title: "월세", msg: "이번 달 월세 50 집주인 박상민에게. 월세 세액공제 받고 싶어요", tax: "월세 세액공제 15~17%", to: "donor2", profile: { privacyPolicy: "amount-from-to", disclosureMode: "recipient-encrypted", disclosureTo: "taxoffice" }, match: /월세/ },
  { id: "allowance", icon: "👩", title: "부모님 용돈", msg: "어머니께 용돈 30 보내줘", tax: "증여세 비과세", to: "parent", profile: { privacyPolicy: "all-private", disclosureMode: "none" }, match: /증여|용돈|생활비/ },
  { id: "freelance", icon: "🎨", title: "외주비", msg: "프리랜서 이지은에게 로고 디자인 외주비 100", tax: "원천징수 3.3%", to: "freelancer", profile: { privacyPolicy: "amount-from-to", disclosureMode: "recipient-encrypted", disclosureTo: "taxoffice" }, match: /사업소득|원천|외주/ },
  { id: "donation", icon: "🐶", title: "기부", msg: "유기견 보호소에 30 기부. 연말정산 영수증 필요해요", tax: "기부금 세액공제 15%", to: "charity", profile: { privacyPolicy: "amount-from-to", disclosureMode: "recipient-encrypted", disclosureTo: "taxoffice" }, match: /기부/ },
  { id: "gift", icon: "💐", title: "축의금", msg: "친구 결혼식 축의금 10 박상민에게. 누가 냈는지는 남겨도 돼", tax: "개인 간 비과세", to: "donor2", profile: { privacyPolicy: "from-to", disclosureMode: "public" }, match: /경조|축의|부의/ },
];
const FIELD_KO: Record<Field, string> = { amount: "금액", from: "보내는 사람", to: "받는 사람" };
const ACTION_KO: Record<string, string> = { deposit: "공개 예치", final_transfer: "비공개 전송", withdraw: "공개 출금" };
/** 1 tOKRW = 10,000원 (demo convention) */
const won = (okrw: number) => `${Math.round(okrw * 10000).toLocaleString()}원`;
const fmtA = (a?: string | null) => (a ? (Number(BigInt(a) / 10n ** 12n) / 1e6).toLocaleString() : "-");
const fieldsOf = (p: Pick<Profile, "privacyPolicy">) => new Set<Field>(p.privacyPolicy === "all-private" ? [] : (p.privacyPolicy.split("-") as Field[]));
const audienceOf = (p: Pick<Profile, "disclosureMode" | "disclosureTo">, label: (n?: string) => string) =>
  p.disclosureMode === "public" ? { key: "public", text: "누구나" } : p.disclosureMode === "recipient-encrypted" ? { key: "designated", text: `${label(p.disclosureTo)}만` } : { key: "none", text: "아무도" };
const templateOf = (p: Payment) => TEMPLATES.find((s) => s.match.test(p.tax?.category ?? "") || s.match.test(p.memo)) ?? null;
const statusKo = (s: string) => (s === "done" ? "완료" : s === "executing" ? "보내는 중" : s === "failed" ? "실패" : "제안");

/** Who sees what — one row per audience. Much more intuitive than per-field icons. */
function Audience({ profile, to, label, compact = false }: { profile: Pick<Profile, "privacyPolicy" | "disclosureMode" | "disclosureTo">; to?: string; label: (n?: string) => string; compact?: boolean }) {
  const f = fieldsOf(profile);
  const names = (["amount", "from", "to"] as Field[]).filter((k) => f.has(k)).map((k) => FIELD_KO[k]);
  const all = names.length === 3 ? "전부" : names.join("·");
  const rows: { icon: string; who: string; sees: string | null }[] = [
    { icon: "🌐", who: "대중", sees: profile.disclosureMode === "public" && names.length ? all : null },
    { icon: "👤", who: to ? label(to) : "받는 사람", sees: "금액" },
    { icon: "🏛️", who: "국세청", sees: profile.disclosureMode === "recipient-encrypted" && profile.disclosureTo === "taxoffice" && names.length ? all : null },
  ];
  return (
    <div className={`aud ${compact ? "compact" : ""}`}>
      {rows.map((r) => (
        <div key={r.who} className={`aud-row ${r.sees ? "open" : "lock"}`}>
          <span className="aud-who">{r.icon} {r.who}</span>
          <span className="aud-sees">{r.sees ? `👁 ${r.sees}` : "🔒 비공개"}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | "think" | "exec">(false);
  const [state, setState] = useState<State | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("public");
  const [checks, setChecks] = useState<Record<string, Record<string, Check>>>({});
  const [receipt, setReceipt] = useState<{ rows: { id: string; category: string; amountOkrw: number | null; from: string; to: string; verified: boolean }[]; summary: string } | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refresh = async () => { const r = await fetch("/api/state"); setState(await r.json()); };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { const t = setInterval(refresh, busy === "exec" ? 3000 : 20000); return () => clearInterval(t); }, [busy]);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  const label = (n?: string) => state?.wallets.find((w) => w.name === n)?.label ?? n ?? "?";
  const short = (n?: string) => label(n).split(" (")[0];
  const payments = state?.payments ?? [];
  const open = payments.find((p) => p.id === openId) ?? msgs.slice().reverse().find((m) => m.payment?.id === openId)?.payment;

  const useTemplate = (t: { id: string; msg: string }) => { setInput(t.msg); setPicked(t.id); setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; } }, 0); };
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput(""); setBusy("think"); if (inputRef.current) inputRef.current.style.height = "auto";
    setMsgs((m) => [...m, { role: "user", content: text }]);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history, message: text }) });
      const j = await r.json();
      if (j.error) setMsgs((m) => [...m, { role: "assistant", content: `오류: ${j.error}` }]);
      else { setHistory(j.messages); setMsgs((m) => [...m, ...j.events]); }
    } finally { setBusy(false); refresh(); }
  };
  const execute = async (id: string) => {
    setBusy("exec");
    setMsgs((m) => m.map((x) => (x.payment?.id === id ? { ...x, payment: { ...x.payment!, status: "executing" } } : x)));
    try {
      const r = await fetch("/api/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: id }) });
      const p: Payment = await r.json();
      setMsgs((m) => m.map((x) => (x.payment?.id === id ? { ...x, payment: p } : x)));
      setMsgs((m) => [...m, { role: "assistant", content: p.status === "done" ? "보냈어요. 체인에 기록됐고 증빙은 지정한 키로만 열립니다. 오른쪽 내역을 눌러 누가 무엇을 보는지 확인해 보세요." : `실패했어요: ${(p.error ?? "").split("\n").filter((l) => /잔액|Error|error/.test(l)).slice(-1)[0] ?? p.error}` }]);
    } finally { setBusy(false); refresh(); }
  };
  const verify = async (p: Payment, who: "public" | "designated" | "wrong") => {
    const hash = p.txs.find((t) => t.action === "final_transfer")?.hash; if (!hash) return;
    const byShield = (a?: string) => state?.wallets.find((w) => w.shieldedAddr === a)?.label.split(" (")[0] ?? (a ? a.slice(0, 14) + "…" : undefined);
    const name = who === "public" ? "taxoffice" : who === "designated" ? (p.profile.disclosureTo ?? "taxoffice") : (p.to === "donor2" ? "freelancer" : "donor2");
    const plane = who === "public" ? "public" : "recipient";
    setChecks((c) => ({ ...c, [p.id]: { ...(c[p.id] ?? {}), [who]: { loading: true } } }));
    const r = await fetch("/api/decode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, evmTxHash: hash, plane }) });
    const j = await r.json(); const d = j.decoded ?? {};
    const res: Check = d.error || j.error ? { ok: false, error: d.error ?? j.error } : { ok: true, amount: d.amount ? won(Number(fmtA(d.amount).replace(/,/g, ""))) : null, from: byShield(d.from_shielded_address), to: byShield(d.to_shielded_address) };
    setChecks((c) => ({ ...c, [p.id]: { ...(c[p.id] ?? {}), [who]: res } }));
  };
  const remove = async (id: string) => {
    await fetch(`/api/payment?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setMsgs((m) => m.filter((x) => x.payment?.id !== id)); setOpenId(null); refresh();
  };
  const makeReceipt = async () => {
    setReceiptBusy(true);
    try { const r = await fetch("/api/receipt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "taxoffice" }) }); setReceipt(await r.json()); }
    finally { setReceiptBusy(false); }
  };

  return (
    <main className="wrap">
      <header className="top">
        <div><h1>ClearPay</h1><div className="muted">세무 비서에게 말하면, 세금 증빙에 필요한 만큼만 공개하고 보냅니다</div></div>
        <div className="row small"><span className="badge">LLM {state?.provider === "api" ? "SKT A.X K2" : state?.provider ?? "…"}</span><span className="badge">Maroo Testnet · 1 tOKRW = 1만 원</span><span className="legend">👁 보임 · 🔒 비공개</span></div>
      </header>

      <div className="stage">
        <div className="phone">
          <div className="notch" />
          <div className="phead"><div className="avatar">세</div><div><b>세무 비서</b><div className="small muted">{busy === "think" ? "입력 중…" : busy === "exec" ? "체인에 보내는 중…" : "온라인"}</div></div></div>
          <div className="plog" ref={logRef}>
            {msgs.length === 0 && <div className="bubble assistant">안녕하세요, 세무 비서예요. 월세·용돈·외주비·기부처럼 평소 보내는 돈을 말해 주세요. 세법상 뭔지, 공제는 얼마인지, 누구에게 뭘 공개할지 정해서 보내 드릴게요.</div>}
            {msgs.map((m, i) => m.role === "tool"
              ? (m.payment ? <PayCard key={i} p={m.payment} label={short} onOpen={() => setOpenId(m.payment!.id)} onExecute={execute} busy={!!busy} /> : null)
              : <div key={i} className={`bubble ${m.role}`}>{m.content}</div>)}
            {busy === "think" && <div className="bubble assistant typing"><span /><span /><span /></div>}
          </div>
          <div className="quick">{TEMPLATES.map((s) => <button key={s.id} className={`chip ${picked === s.id ? "on" : ""}`} onClick={() => useTemplate(s)} disabled={!!busy}>{s.icon} {s.title}</button>)}</div>
          <div className="pinput">
            <textarea ref={inputRef} value={input} rows={1} onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }} placeholder="메시지 (Shift+Enter 줄바꿈)" disabled={!!busy} />
            <button className="send" onClick={() => send(input)} disabled={!!busy}>↑</button>
          </div>
        </div>

        <section className="board">
          <div className="sechead"><h3>템플릿</h3><span className="muted small">누르면 왼쪽 입력창에 문장이 들어갑니다. 고쳐서 보내세요</span></div>
          <div className="scen">
            {TEMPLATES.map((s) => {
              const n = payments.filter((p) => p.status === "done" && templateOf(p)?.id === s.id).length;
              return (
                <button key={s.id} className={`scard ${picked === s.id ? "on" : ""}`} onClick={() => useTemplate(s)} disabled={!!busy}>
                  <div className="row between"><span className="icon">{s.icon}</span>{n > 0 && <span className="count">{n}건</span>}</div>
                  <b>{s.title}</b>
                  <div className="small muted">{s.tax}</div>
                  <div className="tpl-msg">“{s.msg}”</div>
                  <Audience profile={s.profile} to={s.to} label={short} compact />
                  <div className="tpl-cta">{picked === s.id ? "✓ 입력창에 들어갔어요" : "✎ 입력창에 넣기"}</div>
                </button>
              );
            })}
          </div>

          <div className="sechead"><h3>처리 내역</h3><span className="muted small">누르면 상세와 관점별 보기</span></div>
          <div className="timeline">
            {payments.filter((p) => p.status !== "proposed").length === 0 && <div className="muted small">아직 보낸 내역이 없어요.</div>}
            {payments.filter((p) => p.status !== "proposed").slice(0, 10).map((p) => {
              const s = templateOf(p);
              return (
                <button key={p.id} className={`trow ${p.status}`} onClick={() => { setOpenId(p.id); setLens("public"); }}>
                  <span className="icon">{s?.icon ?? "💸"}</span>
                  <span className="tmain"><b>{won(p.amountOkrw)}</b> <span className="muted">→ {short(p.to)}</span><div className="small muted">{p.tax?.category ?? p.kind}{p.tax?.benefitOkrw != null ? ` · 예상 공제 ${won(p.tax.benefitOkrw)}` : ""}</div></span>
                  <Audience profile={p.profile} to={p.to} label={short} compact />
                  <span className={`status ${p.status}`}>{statusKo(p.status)}</span>
                </button>
              );
            })}
          </div>

          <div className="sechead"><h3>국세청 · 연말정산</h3><span className="muted small">국세청 키로 열리는 증빙을 체인에서 복원해 공제액 계산</span></div>
          <div className="card">
            <div className="row"><button className="primary" onClick={makeReceipt} disabled={receiptBusy}>{receiptBusy ? "복호화·집계 중…" : "증빙 요약 생성"}</button></div>
            {receipt && (
              <div className="receipt">
                {receipt.rows.map((r) => <div className="kv small" key={r.id}><span>{r.verified ? "✓" : "✗"} {r.category} · {r.from.split(" (")[0]} → {r.to.split(" (")[0]}</span><b>{r.amountOkrw != null ? won(r.amountOkrw) : "복호화 실패"}</b></div>)}
                <div className="summary">{receipt.summary}</div>
              </div>
            )}
          </div>
        </section>
      </div>

      {open && <Detail p={open} lens={lens} setLens={setLens} checks={checks[open.id] ?? {}} verify={verify} short={short} onClose={() => setOpenId(null)} onExecute={execute} onDelete={remove} busy={!!busy} />}
    </main>
  );
}

function Detail({ p, lens, setLens, checks, verify, short, onClose, onExecute, onDelete, busy }: { p: Payment; lens: Lens; setLens: (l: Lens) => void; checks: Record<string, Check>; verify: (p: Payment, who: "public" | "designated" | "wrong") => void; short: (n?: string) => string; onClose: () => void; onExecute: (id: string) => void; onDelete: (id: string) => void; busy: boolean }) {
  const f = fieldsOf(p.profile);
  const t = templateOf(p);
  const defs: Record<Lens, { who: string; sub: string; icon: string; can: boolean; self: boolean; check: "public" | "designated" | null }> = {
    public: { who: "대중", sub: "체인·공개 payload", icon: "🌐", can: p.profile.disclosureMode === "public", self: false, check: "public" },
    to: { who: short(p.to), sub: "받는 사람 · 자기 지갑", icon: t?.icon ?? "👤", can: true, self: true, check: null },
    taxoffice: { who: "국세청", sub: "지정 키로 복호화", icon: "🏛️", can: p.profile.disclosureMode === "recipient-encrypted" && p.profile.disclosureTo === "taxoffice", self: false, check: "designated" },
    me: { who: "나", sub: "self-view", icon: "🙂", can: true, self: true, check: null },
  };
  const L = defs[lens];
  const val = (k: Field) => (k === "amount" ? won(p.amountOkrw) : short(k === "from" ? p.from : p.to));
  const visible = (k: Field) => L.self || (L.can && f.has(k));
  const chk = L.check ? checks[L.check] : undefined;
  const wrong = checks.wrong;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>✕</button>
        <div className="sh-head">
          <span className="sh-icon">{t?.icon ?? "💸"}</span>
          <div>
            <div className="sh-amt">{won(p.amountOkrw)} <span className="muted small">({p.amountOkrw} tOKRW)</span></div>
            <div className="muted">{short(p.from)} → {short(p.to)} · {p.tax?.category ?? p.kind} · <span className={`status ${p.status}`}>{statusKo(p.status)}</span></div>
          </div>
        </div>
        {p.tax && <div className="taxbox">{p.tax.benefitOkrw != null && <b>예상 공제 {won(p.tax.benefitOkrw)}</b>}<span className="muted small">{p.tax.note}</span></div>}
        <div className="muted small" style={{ marginTop: 6 }}>{p.profile.rationale}</div>
        {p.status === "failed" && <div className="errbox"><b>실패 사유</b><div>{(p.error ?? "").split("\n").filter((l) => /잔액|Error|error|insufficient/.test(l)).slice(-1)[0] ?? p.error}</div><div className="muted small">체인에는 아무것도 기록되지 않았습니다 (사전 검사 또는 노드 거절).</div></div>}
        <div className="row" style={{ marginTop: 8 }}>
          {p.txs.filter((t) => ACTION_KO[t.action]).map((t) => <a key={t.hash} href={t.explorer} target="_blank" rel="noreferrer" className="tx">{ACTION_KO[t.action]} ↗</a>)}
          {p.status === "proposed" && <button className="primary" disabled={busy} onClick={() => onExecute(p.id)}>이대로 보내기</button>}
          {p.status !== "done" && p.status !== "executing" && <button disabled={busy} onClick={() => onDelete(p.id)}>기록 삭제</button>}
        </div>

        <h3>누가 무엇을 보나</h3>
        <div className="personas">
          {(Object.keys(defs) as Lens[]).map((k) => { const d = defs[k]; const n = d.self ? 3 : d.can ? f.size : 0; return (
            <button key={k} className={`persona ${lens === k ? "on" : ""}`} onClick={() => setLens(k)}>
              <span className="pav">{d.icon}</span><b>{d.who}</b><small>{n === 3 ? "전부 보임" : n === 0 ? "안 보임" : `${n}개 항목`}</small>
            </button>
          ); })}
        </div>
        <div className="receiptcard">
          <div className="rc-head"><span>{L.who} 입장에서 본 영수증</span><span className="muted small">{L.sub}</span></div>
          {(["amount", "from", "to"] as Field[]).map((k) => (
            <div key={k} className={`rc-row ${visible(k) ? "open" : "lock"}`}>
              <span className="rc-k">{FIELD_KO[k]}</span>
              <span className="rc-v"><span className={visible(k) ? "" : "blur"}>{val(k)}</span>{!visible(k) && <span className="lockpill">🔒 비공개</span>}</span>
            </div>
          ))}
          <div className="rc-foot muted small">{L.self ? "자기 지갑 노트에서 직접 읽음 (체인에는 없음)" : L.can ? (f.size ? `공개 payload를 ${L.who}가 복호화` : "공개할 필드가 없음") : "복호화 권한 없음 · 체인에는 커밋먼트만"}</div>
        </div>
        <div className="verify">
          {L.self ? <span className="muted small">{L.who}는 체인 검증 대상이 아닙니다 (자기 노트).</span> : (<>
            <button className="primary" disabled={p.status !== "done" || chk?.loading} onClick={() => verify(p, L.check!)}>{p.status !== "done" ? "보낸 뒤 검증 가능" : chk?.loading ? "체인에서 복호화 중…" : `${L.who} 입장에서 체인 검증`}</button>
            {chk && !chk.loading && (chk.ok ? <span className="ok">✓ 복원됨: {[chk.amount, chk.from, chk.to].filter(Boolean).join(" · ") || "공개 필드 없음"}</span> : <span className="bad">✗ 열 수 없음{L.can ? ` — ${chk.error}` : " (권한 없음)"}</span>)}
            {lens === "taxoffice" && p.profile.disclosureMode === "recipient-encrypted" && <button disabled={p.status !== "done" || wrong?.loading} onClick={() => verify(p, "wrong")}>{wrong?.loading ? "시도 중…" : "다른 사람 키로 시도"}</button>}
            {lens === "taxoffice" && wrong && !wrong.loading && <span className={wrong.ok ? "bad" : "ok"}>{wrong.ok ? "열림?!" : "✓ 제3자 키는 거부됨"}</span>}
          </>)}
        </div>
      </div>
    </div>
  );
}

function PayCard({ p, label, onOpen, onExecute, busy }: { p: Payment; label: (n?: string) => string; onOpen: () => void; onExecute: (id: string) => void; busy: boolean }) {
  const done = new Set(p.txs.map((t) => t.action));
  return (
    <div className={`paycard ${p.status}`} onClick={onOpen}>
      <div className="row between"><span className="small muted">{p.tax?.category ?? p.kind}</span><b className="pc-amt">{won(p.amountOkrw)}</b></div>
      <div className="small">{label(p.from)} → <b>{label(p.to)}</b>{p.tax?.benefitOkrw != null ? <span className="muted"> · 예상 공제 {won(p.tax.benefitOkrw)}</span> : null}</div>
      <Audience profile={p.profile} to={p.to} label={label} compact />
      {p.status === "proposed" && <button className="primary full" disabled={busy} onClick={(e) => { e.stopPropagation(); onExecute(p.id); }}>이대로 보내기</button>}
      {p.status === "executing" && <div className="steps small"><span className={`step ${done.has("deposit") ? "ok" : "active"}`}>예치</span><span className={`step ${done.has("final_transfer") ? "ok" : done.has("deposit") ? "active" : ""}`}>증명·전송</span></div>}
      {p.status === "done" && <div className="small ok">✓ 전송 완료 · 눌러서 상세</div>}
      {p.status === "failed" && <div className="small bad">✗ {(p.error ?? "").split("\n").filter((l) => /잔액|Error|error/.test(l)).slice(-1)[0] ?? "실패"}</div>}
    </div>
  );
}
