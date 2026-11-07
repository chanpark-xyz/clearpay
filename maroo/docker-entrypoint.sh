#!/usr/bin/env bash
# Container start: import WALLET_*_KEY into the marood keyring (or generate test wallets), print addresses, start Next.js.
set -euo pipefail
export PATH="/root/.foundry/bin:$VP_DIR/bin:$PATH"
for n in donor1 donor2 parent freelancer charity taxoffice; do
  var="WALLET_$(printf '%s' "$n" | tr '[:lower:]' '[:upper:]')_KEY"
  if [ -z "${!var:-}" ] && [ ! -f "$VP_DIR/keys/$n.json" ]; then cast wallet new --json > "$VP_DIR/keys/$n.json"; echo "[entrypoint] generated test key for $n (fund it via faucet.maroo.io)"; fi
done
"$VP_DIR/scripts/vp.sh" import >/dev/null || true
for n in donor1 donor2 charity taxoffice; do "$VP_DIR/scripts/vp.sh" addr "$n" | jq -r '"[entrypoint] \(.name)  \(.evm)"'; done
if [ "${AUTO_ATTEST:-0}" = "1" ]; then for n in donor1 donor2 charity taxoffice; do "$VP_DIR/scripts/vp.sh" attest "$n" || true; done; fi
exec pnpm start -- --port "${PORT:-3000}" --hostname "${HOSTNAME:-0.0.0.0}"
