/**
 * A "disclosure profile" = the Maroo VP knobs for one shielded transfer.
 *  privacyPolicy : which fields are public on-chain for this transfer
 *  disclosureMode: none | public | recipient-encrypted (encrypted to one chosen pubkey)
 */
export type PrivacyPolicy =
  | "all-private" | "amount" | "to" | "amount-to"
  | "from" | "amount-from" | "from-to" | "amount-from-to";
export type DisclosureMode = "none" | "public" | "recipient-encrypted";

export interface DisclosureProfile {
  privacyPolicy: PrivacyPolicy;
  disclosureMode: DisclosureMode;
  /** wallet name whose disclosure pubkey receives the encrypted payload */
  disclosureTo?: string;
  rationale: string;
}

export const PRIVACY_POLICIES: PrivacyPolicy[] = [
  "all-private", "amount", "to", "amount-to", "from", "amount-from", "from-to", "amount-from-to",
];

/**
 * Who sees what. Verified on testnet (2026-11-07):
 *  - On-chain, a shielded transfer never reveals amount/from/to (only commitments + nullifiers).
 *  - privacyPolicy selects WHICH fields go into the disclosure payload attached to the transfer.
 *  - disclosureMode selects WHO can decode that payload:
 *      none                -> nobody (only sender self-view and recipient's own note)
 *      public              -> anyone (decode-disclosure --disclosure-plane public, no key)
 *      recipient-encrypted -> only the holder of the given disclosure pubkey
 */
export function disclosedFields(p: DisclosureProfile): ("amount" | "from" | "to")[] {
  return p.privacyPolicy === "all-private" ? [] : (p.privacyPolicy.split("-") as ("amount" | "from" | "to")[]);
}
export function visibility(p: DisclosureProfile) {
  const fields = disclosedFields(p);
  const label = fields.length ? fields.map((f) => ({ amount: "금액", from: "보내는 이", to: "받는 이" })[f]).join("·") : "없음";
  const audience = p.disclosureMode === "public" ? "누구나" : p.disclosureMode === "recipient-encrypted" ? `${p.disclosureTo ?? "지정 키"}만` : "아무도 (당사자 외)";
  return {
    onChain: "금액·보내는 이·받는 이 모두 비공개 (커밋먼트와 널리파이어만 기록)",
    disclosed: label,
    audience,
    sender: "전부 (self-view)",
    recipient: "받은 금액과 노트 (자기 지갑 동기화)",
    auditor: "체인 감사 키(epoch)로 법정 범위 내 열람",
  };
}
