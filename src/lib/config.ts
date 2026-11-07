export const cfg = {
  /** "api" (OpenAI-compatible HTTP) | "codex" (local Codex CLI, ChatGPT subscription auth) | "rules" */
  llmProvider: process.env.LLM_PROVIDER ?? (process.env.LLM_API_KEY ? "api" : "rules"),
  codexModel: process.env.CODEX_MODEL ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  llmModel: process.env.LLM_MODEL ?? "gpt-5.2",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  vpDir: require("node:path").resolve(process.cwd(), process.env.VP_DIR ?? "../maroo-privacy-testnet"),
  explorer: "https://explorer-testnet.maroo.io",
};

/** Demo wallets (test-only keys live in VP_DIR/keys). 1 tOKRW = 1만 원으로 표기. */
export const WALLETS = {
  donor1: { label: "김민준 (나)", role: "self", desc: "직장인. 세입자이자 기부자" },
  donor2: { label: "박상민 (집주인)", role: "counterparty", desc: "월세 수취" },
  parent: { label: "어머니", role: "counterparty", desc: "용돈 수취" },
  freelancer: { label: "이지은 (프리랜서 디자이너)", role: "counterparty", desc: "외주비 수취" },
  charity: { label: "행복한 유기견 보호소", role: "recipient", desc: "지정기부금 단체" },
  taxoffice: { label: "국세청 (홈택스)", role: "verifier", desc: "증빙 수신" },
} as const;
export type WalletName = keyof typeof WALLETS;
