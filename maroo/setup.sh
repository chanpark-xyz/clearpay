#!/usr/bin/env bash
# One-shot setup for a fresh machine (Apple Silicon macOS 26+ or Linux x86-64/arm64).
# Creates ../maroo-privacy-testnet with marood v0.11.1, the VP proving bundle, test wallets, and prints addresses to fund.
#   bash maroo/setup.sh            # install + create 6 demo wallets
#   bash maroo/setup.sh attest     # after funding: register EAS attestation for the sending wallets
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VP_DIR="${VP_DIR:-$(cd "$HERE/.." && pwd)/../maroo-privacy-testnet}"
mkdir -p "$VP_DIR"/{bin,artifacts,calls,keys,client,scripts,eas}
cp "$HERE/vp.sh" "$VP_DIR/scripts/vp.sh"; chmod +x "$VP_DIR/scripts/vp.sh"
export PATH="/opt/homebrew/bin:$HOME/.foundry/bin:$VP_DIR/bin:$PATH"

step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
# Load cleargive/.env.local so WALLET_*_KEY (and LLM_*) are visible here.
ENV_FILE="$(cd "$HERE/.." && pwd)/.env.local"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

if [ "${1:-}" = "attest" ]; then
  step "EAS attestation (needs tOKRW for gas)"
  for n in donor1 donor2 charity taxoffice; do "$VP_DIR/scripts/vp.sh" attest "$n"; done
  exit 0
fi

step "tools"
command -v jq >/dev/null || { echo "jq가 필요합니다 (brew install jq)"; exit 1; }
command -v cast >/dev/null || { echo "Foundry cast가 필요합니다: brew install foundry  (또는 https://getfoundry.sh)"; exit 1; }

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) T=darwin-arm64; SHA=0f06bad57f57802df7bc4f9f5521ba0632b97969dd19bcdf5bb7df971b8b6a21;;
  Linux/x86_64) T=linux-amd64; SHA=6f525ecece54c4f9976ca19f0e71e83e2c6d39952d2f59ed0821e74ff86cbd0b;;
  Linux/aarch64|Linux/arm64) T=linux-arm64; SHA=95a458be3b634f5c7d13584f66c8d5a8607bab149af6ec283103c6bac66ddd18;;
  *) echo "지원하지 않는 OS/CPU"; exit 1;;
esac
if [ ! -x "$VP_DIR/bin/marood" ]; then
  step "marood v0.11.1 ($T)"
  curl -fL --retry 2 "https://asset.delightlabs.io/maroo/release/marood-v0.11.1-$T.tar.gz" -o "$VP_DIR/marood.tar.gz"
  printf '%s  %s\n' "$SHA" "$VP_DIR/marood.tar.gz" | shasum -a 256 -c -
  tar -xzf "$VP_DIR/marood.tar.gz" -C "$VP_DIR/bin" marood && chmod 755 "$VP_DIR/bin/marood"
fi
if [ ! -f "$VP_DIR/artifacts/maroo-v0.11-privacy-artifacts/artifacts/privacy_zk_manifest.json" ]; then
  step "VP proving bundle (289MB)"
  curl -fL --retry 2 https://asset.delightlabs.io/maroo/release/maroo-v0.11-privacy-artifacts.tar.gz -o "$VP_DIR/artifacts.tar.gz"
  printf '%s  %s\n' d652e914e2e64f8d82bfa7dcec365e7a039cf30c326c85d216422b97f934c659 "$VP_DIR/artifacts.tar.gz" | shasum -a 256 -c -
  tar -xzf "$VP_DIR/artifacts.tar.gz" -C "$VP_DIR/artifacts"
fi
"$VP_DIR/bin/marood" version --home "$VP_DIR/client"

step "demo wallets (test-only keys in $VP_DIR/keys, never commit)"
for n in donor1 donor2 parent freelancer charity taxoffice; do
  var="WALLET_$(printf '%s' "$n" | tr '[:lower:]' '[:upper:]')_KEY"
  if [ -n "${!var:-}" ]; then echo "  $n: using $var from .env.local"; continue; fi
  if [ ! -f "$VP_DIR/keys/$n.json" ]; then cast wallet new --json > "$VP_DIR/keys/$n.json"; echo "  $n: generated keys/$n.json"; fi
done
"$VP_DIR/scripts/vp.sh" import >/dev/null
: > "$VP_DIR/ADDRESSES.txt"
for n in donor1 donor2 parent freelancer charity taxoffice; do "$VP_DIR/scripts/vp.sh" addr "$n" | tee -a "$VP_DIR/ADDRESSES.txt"; done

cat <<MSG

다음 단계
1) https://faucet.maroo.io 에서 tOKRW를 받아 아래 주소로 보내세요 (donor1 2,000 이상 / donor2·charity·taxoffice 각 300 이상 권장).
   본인 지갑을 그대로 쓰려면 .env.local 의 WALLET_DONOR1_KEY 등에 개인키를 넣고 이 스크립트를 다시 실행하세요.
$(jq -r '"   \(.name)\t\(.evm)"' "$VP_DIR/ADDRESSES.txt")
2) 잔액이 들어오면:  bash maroo/setup.sh attest
3) cleargive/.env.local 에 LLM 키 입력 후:  pnpm install && pnpm dev --port 3077
MSG
