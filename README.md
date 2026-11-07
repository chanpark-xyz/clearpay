# 모두의 송금비서 ClearPay — 세금은 챙기고, 금액은 숨기고

OBA.RUN Season 2 · Maroo Verifiable Privacy × SKT A.X K2

> 세금 생각만 하면 머리 아픈 보통 사람을 위해, AI가 알아서 대신 공제를 챙기고 꼭 알아야 할 상대에게만 내용을 공개하는 송금비서입니다.
>
> "이번 달 월세 50만 원 집주인에게. 세액공제 받고 싶어요." → 세무 비서(SKT A.X K2)가 세법 분류·예상 공제·공개 범위를 정하고, Maroo 테스트넷에서 tOKRW가 실제로 움직입니다. 국세청만 자기 키로 증빙을 엽니다.

## 문제와 답
월세·용돈·외주비·기부·경조사비처럼 평소 보내는 돈에는 각각 세금 규칙과 "누가 알아야 하는가"가 다릅니다.
Maroo Verifiable Privacy(VP)는 거래마다 **무엇을**(금액·보내는 이·받는 이) **누구에게**(아무도·누구나·지정 키) 공개할지 고를 수 있지만,
8×3 조합을 일반 사용자가 고를 수는 없습니다. ClearPay는 LLM이 그 다이얼을 세법에 맞게 돌리고, 실행 전에 "누가 무엇을 보는지"를 보여 줍니다.

- **나**: 한 문장으로 보냄. 세법 분류와 예상 공제액을 바로 봄.
- **받는 쪽**: 자기 지갑에서 금액 확인. 그 외 정보 노출 없음.
- **국세청**: 지정 공개된 증빙만 자기 키로 복호화 → 연말정산 요약을 체인에서 복원해 생성.
- **대중**: 체인에는 커밋먼트만. 공개로 지정한 항목(예: 축의금 명부)만 보임.

## 빠른 시작 (데모 세팅)
필요한 비밀값은 **.env.local 한 파일**에만 넣습니다. 저장소에는 올라가지 않습니다.

```bash
# 요구: macOS 26+(Apple Silicon) 또는 Linux x86-64/arm64, Node 20+, pnpm, jq, Foundry cast
brew install foundry jq            # macOS
git clone https://github.com/chanpark-xyz/clearpay && cd clearpay
cp .env.example .env.local         # ① AI 키  ② (선택) 지갑 개인키  ③ VP_DIR
bash maroo/setup.sh                # marood v0.11.1 + 증명 파일(289MB) 설치, 지갑 준비, 주소 출력
#   → faucet.maroo.io 에서 tOKRW를 받아 donor1 주소로 2,000 이상 송금
bash maroo/setup.sh attest         # 송신 지갑 EAS attestation 등록 (최초 1회)
pnpm install && pnpm dev --port 3077   # http://localhost:3077
```

### .env.local 구조
| 키 | 설명 |
|---|---|
| `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | AI. 기본은 SKT A.X K2(OpenAI 호환). 키가 비면 규칙 모드, `codex`면 로컬 Codex CLI |
| `WALLET_DONOR1_KEY` … `WALLET_TAXOFFICE_KEY` | 지갑 개인키(0x…). 비우면 setup.sh가 테스트 키를 생성해 `../maroo-privacy-testnet/keys/`에 둡니다 |
| `VP_DIR` | marood·증명 파일·키링 위치 (기본 `../maroo-privacy-testnet`) |

역할: `donor1` 보내는 사람(잔액 필요) · `donor2` 집주인 · `parent` 어머니 · `freelancer` 프리랜서 · `charity` 기부단체 · `taxoffice` 국세청(증빙 복호화 키).
키를 바꾸면 `maroo/setup.sh`를 다시 실행하면 키링에 반영됩니다. 터널로 외부에 열 때는 `cloudflared tunnel --url http://localhost:3077`.

## 데모 순서 (3분)
1. 오른쪽 **기본 시나리오**에서 "월세"를 누른다 → 왼쪽 폰에 세무 비서의 제안 카드 (세액공제 15%, 국세청에만 👁👁👁).
2. "이대로 보내기" → 예치·증명·비공개 전송 단계가 진행되고 Explorer 링크가 붙는다 (약 20초).
3. **누가 무엇을 보나**에서 인물을 바꿔 본다: 대중은 🔒🔒🔒, 집주인은 금액만, 국세청은 전부. "국세청 입장에서 체인 검증"을 누르면 실제로 복호화된 값이 나오고, "다른 사람 키로 시도"는 거부된다.
4. "축의금"을 보내면 대중에게 보내는 이·받는 이만 공개되고 금액은 숨는다 (명부).
5. **국세청 · 연말정산**에서 "증빙 요약 생성" → 체인에서 복원한 금액으로 공제액 계산.

## 테스트넷에서 검증한 VP 동작 (2026-11-07)
| 항목 | 확인 결과 |
|---|---|
| 모델 | **UTXO(노트)**. 예치는 공개 tx, 풀 안 전송은 Groth16 증명(join-split 2x2), 출금은 공개 tx |
| 체인에 보이는 것 | 커밋먼트·널리파이어뿐. 금액·보내는 이·받는 이는 **항상** 비공개 |
| `--privacy-policy` | 공개 payload에 담을 필드 선택 (all-private / amount / to / amount-to / from / …) |
| `--disclosure-mode` | 그 payload를 누가 읽는가: `none` / `public`(키 없이 디코드) / `recipient-encrypted`(지정 공개키 보유자만) |
| 지정 공개 검증 | 국세청 키로 `decode-disclosure` → 금액·당사자 복원 ✅ / 다른 지갑 키 → `decryption failed` ✅ |
| 출금 제약 | 정확히 일치하는 노트 1개 필요(거스름돈 없음) → 자기 자신에게 비공개 전송으로 노트를 만든 뒤 출금(자동) |
| 증명 시간 | 예치 0.2s, 전송 0.5s (M-series Mac, 로컬 증명). 한 건 실행 7~25초 |

### 실제 거래 (Maroo Testnet, chain 450815)
| 단계 | tx |
|---|---|
| EAS attestation ×4 | `0x9fdbb2d4…96e5` `0x876256e9…908b` `0x4df81c39…e399` `0x5ffa8d60…0984` |
| 기부: 예치 30 → 비공개 전송 (국세청 지정 공개) | https://explorer-testnet.maroo.io/tx/0x8c8826b614841bef8c5c5211cb741b5dceb5f7b69dde710880723e8c0b7fb3fc → https://explorer-testnet.maroo.io/tx/0x948a8212eb4239131fe6c257a2b466979104ce49adde656b609369fd2546298d |
| 공개 모드 전송 (amount-to public) | https://explorer-testnet.maroo.io/tx/0xc791d87d313130c6f4c4ab050451870a2fafd24ba23ae67c9767b2d93e248832 |
| 축의금 (from-to public) | https://explorer-testnet.maroo.io/tx/0xc0899302ebb5fcd55eda23be018d383fb707010ef9591e8aaf0770ece3799aca |
| 월세 (amount-from-to → 국세청) | https://explorer-testnet.maroo.io/tx/0x8260314d960029c303d5189c3dbcb641b25e1debe32a7f54ffa07f463a9faa65 |
| 보호소 집행: 자기전송 → 공개 출금 10 | https://explorer-testnet.maroo.io/tx/0x2950b26baf02dc300e8479b669e3b1b5760edd31c2aa36c749b2eee5ae931b26 → https://explorer-testnet.maroo.io/tx/0x9d0a0905184171b1d4b08990080f71fe210a3c735a25b5fff4334c6c4dca0457 |

## 비밀값 처리
- 지갑 개인키와 AI 키는 `.env.local`(git 제외) 또는 저장소 밖 `keys/`에만 있습니다. 소스·화면·API 응답에는 주소, 잔액, 노트 합계, 복호화된 금액·당사자, tx 해시만 나갑니다.
- 노트 원문(비밀 스칼라)은 서버에서 합계만 계산하고 브라우저로 보내지 않습니다. CLI stderr도 응답에서 제거합니다.

## 구조
```
src/lib/agent.ts     세무 비서. LLM 3종: api(JSON 모드, A.X K2/OpenAI) · codex(로컬 Codex CLI) · rules(폴백)
                     세법 규칙(기부 15%/30%, 월세 15~17%, 원천징수 3.3%, 증여 5천만, 경조사 20만)을 프롬프트에 명시
src/lib/policy.ts    DisclosureProfile(privacyPolicy, disclosureMode, disclosureTo)
src/lib/executor.ts  잔액 확인 → 예치 → 비공개 전송(정책 플래그) / 출금
src/lib/vp.ts        maroo/vp.sh 호출 래퍼
src/app/api/*        state · chat · execute · withdraw · decode · receipt
src/app/page.tsx     폰 메신저 + 시나리오 카드 + 처리 내역 + 인물별 영수증 뷰 + 연말정산 요약
maroo/vp.sh          marood v0.11.1 + cast 래퍼 (addr balance pool attest deposit transfer withdraw notes dpubkey decode txinfo)
maroo/setup.sh       새 머신 세팅 (도구·지갑·EAS)
```

## 심사 질문에 대한 답
- **누구의 어떤 일이 쉬워졌나**: 납세자는 세법과 프라이버시 설정을 몰라도 한 문장으로 보내고, 국세청은 서류 없이 자기 키로 증빙을 열며, 거래 상대나 대중에게는 필요한 것만 보인다.
- **선택 기능**: Verifiable Privacy — 비공개 전송 + privacy-policy × disclosure-mode + 공개/지정 플레인 복호화 + 공개 출금. 실제 tOKRW 거래 10건 이상.
- **SKT**: 사용자 요청 → 세법 분류·공개 범위 설계(Action) → 결제(Pay). A.X K2는 OpenAI 호환 JSON 모드로 2초 내 응답.

## 솔직한 한계
- 지갑 키는 서버의 테스트 키. 실서비스는 EIP-712 `*WithAuthorization` 릴레이로 사용자 서명을 받아야 한다.
- 수취 총액의 온체인 합계 증명은 없다 (수취 지갑 노트 합 + 공개 출금으로 확인).
- 감사 키(audit plane) 복호화는 체인 감사 키 파일이 없어 시연하지 않았다.
- 세액공제 숫자는 데모용 단순화(총급여 구간·한도 생략).
