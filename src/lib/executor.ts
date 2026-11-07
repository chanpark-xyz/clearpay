import { vp, toAtokrw } from "./vp";
import { cfg } from "./config";
import { upsertPayment, type Payment } from "./store";

type Tx = { action: string; hash: string; explorer: string };
const tx = (r: Record<string, unknown>): Tx => ({
  action: String(r.action), hash: String(r.transactionHash), explorer: `${cfg.explorer}/tx/${r.transactionHash}`,
});

/**
 * Executes a proposed payment on Maroo testnet:
 *   1. deposit public tOKRW from `from` into the shielded pool (public tx, amount visible)
 *   2. shielded transfer to `to`'s shielded address with the chosen privacy policy / disclosure
 * Both tx hashes are stored on the payment.
 */
export async function executePayment(p: Payment): Promise<Payment> {
  p.status = "executing"; p.error = undefined; await upsertPayment(p);
  try {
    const amt = toAtokrw(p.amountOkrw);
    const bal = await vp("balance", p.from);
    if (BigInt(String(bal.atokrw)) < BigInt(amt) + 10n ** 18n) {
      throw new Error(`잔액 부족: ${p.from} 공개 잔액 ${(Number(BigInt(String(bal.atokrw)) / 10n ** 12n) / 1e6).toLocaleString()} tOKRW < 요청 ${p.amountOkrw.toLocaleString()} + 가스`);
    }
    const toAddr = await vp("addr", p.to);
    const dep = await vp("deposit", p.from, amt);
    p.txs.push(tx(dep)); await upsertPayment(p);

    const args = [p.from, String(toAddr.shielded), amt, p.profile.privacyPolicy, p.profile.disclosureMode];
    if (p.profile.disclosureMode === "recipient-encrypted" && p.profile.disclosureTo) {
      const pk = await vp("dpubkey", p.profile.disclosureTo);
      const key = (pk.public_key_hex ?? pk.disclosure_pubkey ?? pk.pubkey) as string | undefined;
      if (!key) throw new Error(`disclosure pubkey not found: ${JSON.stringify(pk)}`);
      args.push(key);
    }
    const tr = await vp("transfer", ...args);
    p.txs.push(tx(tr));
    p.status = "done";
  } catch (e) {
    p.status = "failed"; p.error = String((e as Error).message ?? e).slice(0, 2000);
  }
  await upsertPayment(p);
  return p;
}

/** Recipient executes (withdraws) funds to its transparent address: public, auditable spending. */
export async function withdraw(name: string, amountOkrw: number, recipient: string) {
  const r = await vp("withdraw", name, toAtokrw(amountOkrw), recipient);
  return tx(r);
}
