# 네이티브 스토어 제출 — 셋업 & 트러블슈팅

> `eas submit` 로 iOS(App Store/TestFlight) · Android(Google Play)에 빌드를 올리는 **1회성 자격증명 셋업**과, 실제로 막혔던 **계정 게이트/권한 함정**을 정리한 문서.
> 일상 명령은 [`README.md` §3](./README.md#3-모바일-네이티브-eas-build--스토어-제출).
> 작성: 2026-06-30 (실제 제출을 뚫으며 기록).
>
> ✅ **2026-06-30 양쪽 제출 성공 확정** — iOS 빌드 44 → App Store Connect/TestFlight,
> Android 빌드 35 → Play internal(draft). 아래 §2-2(iOS)·§3-3(Android)에 **무엇이 막혔고
> 무엇이 풀었는지** 확정 기록.

---

## 1. 큰 그림 — 무엇이 자동이고 무엇이 사람 손인가

| 단계 | 자동화 | 비고 |
|---|---|---|
| EAS Build (네이티브 바이너리) | ✅ 코드/CI | 클라우드 빌드, 자격증명 EAS 보관 |
| `eas submit` 업로드 자체 | ✅ 코드 | iOS=TestFlight, Android=Play internal draft |
| **스토어 계정 게이트/자격증명 1회 셋업** | ❌ **콘솔 수동** | 계정 소유자만 가능 (아래) |
| 트랙 롤아웃 + 심사 → 사용자 도달 | ❌ 콘솔 수동 + 심사 | 수 시간~수일 |

핵심: **"코드로 제출 자동화"는 양쪽 다 가능**하지만, 각 스토어의 **1회성 계정 게이트**(Apple 약관·DSA / Google Play 권한 부여)는 콘솔 소유자만 풀 수 있다. 한 번 풀면 이후엔 명령 한 줄.

---

## 2. iOS — App Store Connect

### 2-1. 셋업 (1회)
| 항목 | 값/위치 |
|---|---|
| ASC App ID | `6761741123` (`eas.json` → `submit.production.ios.ascAppId`) |
| ASC API Key | EAS 서버 보관 (`[Expo] EAS Submit ePMykaounl`, Key ID `3WP682B9A8`, issuer `d27e6eb1-13fa-49f1-b93d-03aadcdae8f0`) |
| Apple Team issuer | `d27e6eb1-…` (이 팀의 모든 ASC 키가 공유하는 issuer) |

제출 명령:
```bash
cd packages/mobile
eas submit --platform ios --profile production --latest --non-interactive
```

### 2-2. ⚠️ Apple 계정 게이트 — "Something went wrong" 의 진짜 원인
`eas submit`이 **바이너리 업로드 전 단계에서 `"Something went wrong when submitting your app to Apple App Store Connect"`** 로 실패하고 **EAS가 상세 로그를 안 남기면**, 거의 항상 **계정 레벨 게이트**다. (4~5월엔 정상이던 제출이 6월에 갑자기 조용히 실패 → 게이트가 새로 생긴 것.)

> ✅ **2026-06-30 확정된 실제 원인 = License Agreement 미동의.** 5번 연속 동일 실패
> (`error:null`, 로그 없음)였는데, **Account Holder(jiyong park)가 업데이트된 Apple
> Developer Program License Agreement를 Accept** + DSA trader 선언 완료 후
> `eas submit --platform ios --profile production --latest` 가 **한 번에 통과**:
> `"✔ Submitted your app to Apple App Store Connect! Your binary has been successfully
> uploaded"` → 빌드 44가 TestFlight 처리 큐로. **새 자격증명 0개** — EAS 저장 ASC 키는
> 멀쩡했고, 계정 게이트만 풀면 됐다. 즉 아래 1번이 1순위인 이유가 실증됨.

App Store Connect → **Business** / developer.apple.com/account 에서 아래를 **전부** 해소:

App Store Connect → **Business** / developer.apple.com/account 에서 아래를 **전부** 해소:

1. **Apple Developer Program License Agreement (최우선)**
   - "...has been updated and needs to be reviewed. ... the **Account Holder must review and accept**" 노란 배너가 있으면 → **Account Holder 계정으로 로그인해 Accept**. 다른 역할은 동의 불가. **이게 제출을 막는 1순위.**
2. **Digital Services Act (DSA) — trader 선언** (EU 배포 시)
   - 상업 앱(구독/IAP)이고 EU 배포하면 **"I'm a trader"** 선택 → 주소·전화·이메일(공개 표시) + **Name Identification Document**(사업자등록증 등, 문서 언어를 실제 언어로) 업로드. 제출 후 한동안 **"In Review"**(검토 중이어도 TestFlight 업로드는 보통 가능, EU 배포만 보류).
   - EU 불필요/연락처 공개 회피 → "not a trader / don't plan to distribute in the EU" (EU만 빠지고 나머지 정상, 나중에 변경 가능).
3. **현지법 compliance** (예: "Under South Korea Law... Complete Compliance Requirements") 처리.
4. **Paid Apps Agreement** — 구독/IAP를 **실제 작동**시키려면 필요(legal entity + 은행/세금). 단 **TestFlight 업로드 자체는 안 막음** → 나중에 처리 가능.

→ 게이트 해소 후 `eas submit` 재시도하면 통과.

### 2-3. 대안 — EAS 우회 직접 업로드 (altool)
EAS가 원인을 안 보여줄 때, 빌드 IPA를 **App Store Connect에 직접 업로드**하며 **진짜 Apple 에러를 그 자리에서** 볼 수 있다. 단 **앱이 속한 팀(issuer `d27e6eb1`)의 유효한 ASC API 키**가 필요:
1. ASC → Users and Access → **Integrations → App Store Connect API** → **새 Team 키(App Manager 역할)** 생성 → `.p8` 다운로드 + **Key ID** + 상단 **Issuer ID** 확보.
2. `xcrun altool`(Xcode 설치 시 사용 가능)로 IPA 업로드.

> 함정: 저장소 루트의 `AuthKey_FH3RYWY8BQ.p8`(gitignore됨)는 **다른 Apple 팀** 키라 이 앱(issuer `d27e6eb1`)엔 못 쓴다 — 직접 테스트 시 ASC API가 **401 NOT_AUTHORIZED** 반환(검증 완료). 반드시 앱 팀의 키를 쓸 것.

---

## 3. Android — Google Play

### 3-1. 셋업 (1회) — ✅ 완료된 구성
| 항목 | 값/위치 |
|---|---|
| 서비스계정 | `eas-play-publisher@reeeeecallstudy.iam.gserviceaccount.com` (GCP project `reeeeecallstudy`) |
| 키 파일 | `packages/mobile/google-service-account.json` (**gitignore**: `google-service-account*.json`) |
| eas.json 연결 | `submit.production.android.serviceAccountKeyPath: "./google-service-account.json"` |
| 트랙 | `internal`, releaseStatus `draft` |

제출 명령:
```bash
cd packages/mobile
eas submit --platform android --profile production --latest --non-interactive
# 성공 시: "✔ Submitted your app to Google Play Store!  All done!"  → Play internal 트랙 draft
```

### 3-2. 서비스계정 키를 처음부터 만드는 절차 (재현용)
**두 시스템을 헷갈리지 말 것 — 이게 핵심 함정이었다.**

**(A) Google Cloud Console** (`console.cloud.google.com`) — 키 *생성*
1. 프로젝트 선택/생성(아무거나 — 서비스계정 그릇).
2. **Google Play Android Developer API** 활성화: `apis/library/androidpublisher.googleapis.com` → Enable.
3. **IAM & Admin → Service Accounts** → **CREATE SERVICE ACCOUNT** (이름 `eas-play-publisher`, 역할 부여 단계는 건너뜀).
4. 생성된 SA → **Keys** 탭 → **Add key → Create new key → JSON** → 다운로드. **이 JSON이 키 파일.**

**(B) Google Play Console** (`play.google.com/console`) — 출시 *권한* 부여 ← **별개 사이트!**
5. 계정 **최상위** **Users and permissions**(특정 앱 안 아님) → **Invite new users**.
6. (A)의 서비스계정 **이메일** 붙여넣기 → 권한 **Admin(all)** 또는 최소 **Release to testing tracks** + 해당 앱 접근 → **Invite**(서비스계정 자동 수락, 1~2분 전파).

### 3-3. ⚠️ "missing the necessary permissions" 의 원인
```
✖ The service account is missing the necessary permissions to submit the app to Google Play Store.
```
= **키(GCP)는 됐는데 (B) Play Console 권한 부여를 안 한 것.** GCP 서비스계정 화면에서 "소유자"로 보여도 그건 **GCP 내부 관리권한**일 뿐, **Play 출시권한과 무관**하다. 위 (B)5~6을 해야 풀린다. (Play Users&permissions에서 SA가 **활성(Active)** 으로 보이면 OK.)

### 3-4. 기타 함정
- **신규 앱 최초 업로드**: 앱이 Play에 한 번도 출시된 적 없으면, 트랙에 따라 **첫 AAB는 콘솔에서 수동 업로드**해야 할 수 있음(이후 API 정상). 우리 케이스는 internal 트랙 API 업로드 성공.
- `releaseStatus: draft` → 자동 출시 안 됨. Play Console에서 internal 트랙 draft를 **검토 후 롤아웃**해야 테스터에 도달.

---

## 부록: EAS GraphQL 로 상태 진단

`eas submission:list` 등 일부 서브커맨드가 CLI 버전에 따라 없음. 대신 **EAS GraphQL API 직접 조회**가 가장 확실하다.

```python
# 인증: ~/.expo/state.json 의 sessionSecret + 반드시 브라우저 User-Agent
#   (plain urllib UA → Cloudflare error 1010 차단됨)
import json, urllib.request
secret = json.load(open('/Users/<you>/.expo/state.json'))['auth']['sessionSecret']
UA = "Mozilla/5.0 ... Chrome/124.0 Safari/537.36"
def gql(q, v=None):
    req = urllib.request.Request("https://api.expo.dev/graphql",
        data=json.dumps({"query": q, "variables": v or {}}).encode(),
        headers={"Content-Type":"application/json","expo-session":secret,"User-Agent":UA})
    return json.load(urllib.request.urlopen(req, timeout=30))

APPID = "31c2c126-f26c-4b75-aa03-6255e68a6032"
```

유용한 쿼리:
```graphql
# 최신 빌드 id (제출에 필요) — platform: IOS | ANDROID
query($id:String!){ app{ byId(appId:$id){
  builds(filter:{platform:IOS}, limit:1, offset:0){ id appVersion appBuildVersion status } } } }

# 제출 이력 (status: ERRORED/FINISHED, 빌드 업로드 여부)
query($id:String!){ app{ byId(appId:$id){
  submissions(filter:{platform:IOS}, limit:10, offset:0){ id status createdAt appStoreConnectBuildUpload{ __typename } } } } }

# 제출 상세 + 내부 job 로그 URL (실패 원인 추적)
query($id:ID!){ submissions{ byId(submissionId:$id){
  status error{ errorCode message } jobRun{ logFileUrls } } } }

# OTA 최신 업데이트 (production 브랜치) — ios/android 둘 다 찍혔는지
query($id:String!){ app{ byId(appId:$id){
  updateBranchByName(name:"production"){ updates(limit:4, offset:0){ createdAt platform runtimeVersion group message } } } } }

# 계정의 ASC API 키 issuer/keyId
query($a:String!){ account{ byName(accountName:$a){ appStoreConnectApiKeys{ keyIdentifier issuerIdentifier name } } } }
```

> iOS 제출이 ERRORED인데 `error:null` + `logFiles:[]` 이면 EAS가 원인을 안 잡은 것 → §2-2 계정 게이트 의심. `jobRun.logFileUrls`(서명된 GCS URL)는 EAS 전용 압축 포맷이라 평문이 아닐 수 있음.

---

## 요약 체크리스트
- [x] iOS: License Agreement 동의 → (EU면) DSA trader → 현지법 compliance → `eas submit ios` — **2026-06-30 통과(빌드 44→TestFlight)**
- [x] Android: SA 키 생성(GCP) → **Play Console에서 SA 이메일 권한 부여** → `eas submit android` — **2026-06-30 통과(빌드 35→internal draft)**
- [ ] 제출 성공 후: 각 콘솔에서 트랙 롤아웃 + 심사 (사용자 도달은 별도) ← **여기 남음**
  - iOS: TestFlight 처리 완료 후 테스터 추가 / App Store 정식출시는 스토어 등록정보+심사
  - Android: internal 트랙 **draft → rollout** (Play Console "출시 시작" 또는 Play API로 release status를 `completed`로 commit)

---

## 부록 B: Google Play API 로 상태 확인 / 롤아웃 (서비스계정 키)

서비스계정 키(`google-service-account.json`)로 Play Developer API 직접 호출. **읽기/롤아웃 모두 코드로** 가능.
```python
# RS256 JWT(iss=client_email, scope=androidpublisher, aud=oauth2.googleapis.com/token)
#   → POST oauth2.googleapis.com/token (grant_type=jwt-bearer) → access_token
# 그 토큰으로 androidpublisher v3:
#   POST   /androidpublisher/v3/applications/{pkg}/edits                → editId
#   GET    .../edits/{editId}/tracks/internal                          → releases[].status / versionCodes
#   GET    .../edits/{editId}/bundles                                  → 업로드된 versionCode 목록
#   (롤아웃) PATCH/PUT track 으로 release status "draft"→"completed" 후
#   POST   .../edits/{editId}:commit                                   → 내부 테스터에 출시
#   (읽기만) DELETE .../edits/{editId}                                 → edit 폐기
# pkg = com.reeeeecall.study
```
> 확인 예(2026-06-30): internal 트랙 release `1.0.2` status=`draft` versionCodes=`[35]`,
> 업로드 번들 `[9,15,16,22,23,27,31,33,34,35]` (신규 앱 아님 → API 업로드 정상).
