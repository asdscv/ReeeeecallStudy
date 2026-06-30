# Deployment Runbook

> 이 프로젝트의 **모든 배포 표면**(웹 · 모바일 OTA · 모바일 네이티브 스토어)을 어떻게 내보내는지에 대한 단일 권위 문서.
> 스토어 제출(1회성 자격증명 셋업 + 트러블슈팅)은 별도로 → [`STORE_SUBMISSION.md`](./STORE_SUBMISSION.md).
> 최초 작성: 2026-06-30.

---

## 0. 한눈에 — 무엇이 어디로 배포되나

```
                 git push / PR merge → main
                          │
        ┌─────────────────┼─────────────────────────────┐
        │                 │                              │
   [웹 + Worker]      [모바일 OTA]                  [모바일 네이티브]
   Cloudflare Git    EAS Update                     EAS Build + Submit
   (자동, main push)  (deploy-mobile.yml,            (수동 트리거/로컬)
                      packages/mobile|shared 변경 시)  → TestFlight / Play
        │                 │                              │
  reeeeecallstudy.xyz   설치된 1.0.2 빌드            App Store / Google Play
```

**핵심 원칙**
- **릴리스 플로우**: `feature → develop → main` (전부 PR). 웹·모바일 배포 트리거는 전부 **main push** 기준.
- **OTA vs 네이티브**: JS/자산만 바뀌면 **OTA로 충분**. 네이티브 코드/설정(android·ios·app.json·app.config.js)이 바뀌면 **네이티브 빌드 + 스토어 제출** 필요.
- **runtimeVersion = appVersion (현재 `1.0.2`)**. OTA 업데이트는 **동일 runtimeVersion으로 설치된 빌드에만** 도달한다. 네이티브 변경을 OTA로 내보낼 수 없는 이유.

### 프로젝트 식별자 (자주 필요)
| 항목 | 값 |
|---|---|
| EAS account / project slug | `asdscv` / `reeeeecall-study` |
| EAS projectId | `31c2c126-f26c-4b75-aa03-6255e68a6032` |
| Updates URL | `https://u.expo.dev/31c2c126-f26c-4b75-aa03-6255e68a6032` |
| iOS bundleId / ASC App ID | `com.reeeeecall.study` / `6761741123` |
| Android package | `com.reeeeecall.study` |
| 웹 도메인 | `https://reeeeecallstudy.xyz` |
| Cloudflare Worker name | `reeeeecallstudy` (`wrangler.jsonc`) |

> ⚠️ Git/GitHub 작업은 `gh` 계정 **asdscv**로 한다(푸시 후에도 asdscv 활성 유지). EAS는 `~/.expo/state.json` 세션(asdscv) 사용.

---

## 1. 웹 (+ Cloudflare Worker)

웹은 **Cloudflare Worker + 정적 자산**(`wrangler.jsonc`: `main: ./worker.js`, `assets.directory: ./packages/web/dist`)이다. `worker.js` + `worker-modules/`가 봇/SEO(사이트맵·hreflang·robots·JSON-LD·인사이트 콘텐츠)를 서버사이드로 처리하고, 일반 사용자에겐 SPA 자산을 서빙한다.

### 배포 방법 — 자동 (별도 명령 불필요)
- **Cloudflare Git 통합**이 `main` 브랜치를 watch → push 시 **자동 빌드 + 배포**.
- `.github/workflows`에 웹 배포 스텝은 **없다**(Cloudflare가 직접 함). `wrangler deploy`를 CI에서 돌리지 않는다.
- 즉 **develop → main PR을 머지하면 웹이 자동 재배포**된다.

### 배포 확인
```bash
# 사용자 뷰
curl -sI https://reeeeecallstudy.xyz/ | head -1            # HTTP/2 200 기대
# Worker(SEO) 동작 — Googlebot으로 인사이트 hreflang 확인
curl -s -A "Googlebot/2.1" https://reeeeecallstudy.xyz/insight | grep -o 'hreflang="[a-z-]*"' | sort -u
#   → en / ko / x-default 만 나오면 locale-policy(인덱싱 한·영 한정)가 살아있는 것
```
> 로컬 sandbox에서 `curl`이 `000`이면 도메인 오타(`.study`가 아니라 **`.xyz`**)거나 egress 차단. python `urllib`로도 확인 가능.

---

## 2. 모바일 OTA (EAS Update)

JS 번들·이미지·로직만 바뀐 경우. 네이티브 리빌드 없이 **설치된 앱에 즉시** 코드 전달.

### 2-1. 자동 (main push)
워크플로 `.github/workflows/deploy-mobile.yml`:
- **트리거**: `main` push 중 `packages/mobile/**` 또는 `packages/shared/**` 변경 시.
- **decide 잡**이 OTA vs 네이티브 자동 판정:
  - `packages/mobile/(android|ios|app.json|app.config.js)` 변경 → `native`
  - 그 외 → `ota`
- **ota 잡**: `eas update --branch production --environment production --message "<커밋 제목>" --non-interactive`
- `EXPO_TOKEN` GitHub secret 필요(설정돼 있음). 없으면 스킵.

> 주의: docs/gitignore/worker 등 **모바일·shared 외** 변경만 있는 main push는 이 워크플로가 **트리거되지 않는다**. 그땐 아래 수동 트리거.

### 2-2. 수동 트리거 (워크플로 디스패치)
```bash
gh workflow run deploy-mobile.yml --ref main -f mode=ota     # 강제 OTA
gh workflow run deploy-mobile.yml --ref main -f mode=native  # 강제 네이티브 빌드
gh workflow run deploy-mobile.yml --ref main -f mode=auto    # 자동 판정
# 진행 확인
gh run list --workflow=deploy-mobile.yml --limit 3
gh run view <run-id> --json status,conclusion,jobs
```

### 2-3. 로컬에서 직접 OTA (대안)
```bash
cd packages/mobile
eas update --branch production --message "설명" --non-interactive
```

### 배포 확인 (production 브랜치에 ios+android 둘 다 올라갔는지)
[`STORE_SUBMISSION.md` §EAS GraphQL 진단](./STORE_SUBMISSION.md#부록-eas-graphql-로-상태-진단) 의 레시피로
`updateBranchByName(name:"production")`의 최신 `updates`를 조회 → **같은 `group` 으로 ios·android 두 줄**이 방금 시각에 찍혀야 정상.

---

## 3. 모바일 네이티브 (EAS Build → 스토어 제출)

네이티브 코드/설정 변경, 또는 **스토어에 새 빌드를 올려야 할 때**. 빌드와 제출은 분리돼 있다.

### 3-1. 빌드 (EAS Build, 클라우드)
```bash
cd packages/mobile
eas build --platform all --profile production --non-interactive    # ios + android
eas build --platform ios --profile production                      # 개별
```
- `deploy-mobile.yml`의 `native-build` 잡도 동일하게 `eas build --platform all --profile production --no-wait` 실행(자동 판정이 native일 때). **단 제출은 자동화돼 있지 않다**(주석상 `submit-mobile.yml` 게이트를 참조하나 해당 워크플로는 미존재) → **제출은 아래처럼 로컬에서 수동**.
- 빌드 프로파일: `eas.json`의 `build.production` (ios `autoIncrement`, android `app-bundle`). 사이드로드용 APK는 `production-apk`.

### 3-2. 제출 (EAS Submit) — 상세는 STORE_SUBMISSION.md
```bash
cd packages/mobile
# 최신 빌드 자동 선택
eas submit --platform android --profile production --latest --non-interactive
eas submit --platform ios     --profile production --latest --non-interactive
# 특정 빌드 지정 (id는 GraphQL/대시보드에서 확인)
eas submit --platform ios --profile production --id <BUILD_ID> --non-interactive
```
- **Android**: `eas.json`에 서비스계정 키 연결돼 있음 → 바로 Play **internal** 트랙 draft 업로드. (키/권한 셋업은 STORE_SUBMISSION.md) — ✅ 2026-06-30 통과(빌드 35).
- **iOS**: EAS 서버 저장 ASC API 키 사용 → ASC/TestFlight 업로드. — ✅ 2026-06-30 통과(빌드 44). **단 Apple 계정 게이트(특히 업데이트된 License Agreement 미동의)가 있으면 `"Something went wrong"`으로 조용히 실패**하니, 새로 막히면 STORE_SUBMISSION.md §2-2부터 확인.

> 제출 성공 ≠ 사용자 배포. iOS는 TestFlight, Android는 Play **internal draft** 까지만 자동. 실제 출시는 각 콘솔에서 트랙 롤아웃 + 심사(수 시간~수일)가 추가로 필요.

---

## 4. 표준 릴리스 절차 (develop → main → 전 표면 배포)

```bash
# 0) 작업은 feature 브랜치 → develop PR (생략 가능: 이미 develop에 있으면)
# 1) develop → main 릴리스 PR
gh pr create --base main --head develop --title "release: ..." --body "..."
#    CI(6개 체크) green 확인 후
gh pr merge <PR#> --merge           # ⚠️ develop은 영구 브랜치 → --delete-branch 쓰지 말 것
# 2) main push 결과 자동 트리거:
#    - 웹/Worker: Cloudflare Git 자동 재배포
#    - 모바일: deploy-mobile.yml (packages/mobile|shared 변경 시에만)
# 3) 모바일 변경 없는 main push였다면 OTA 수동 트리거:
gh workflow run deploy-mobile.yml --ref main -f mode=ota
# 4) 로컬 develop/main 동기화
git checkout main && git pull --ff-only origin main
git checkout develop && git pull --ff-only origin develop
# 5) 확인: 웹 curl(§1), OTA group(§2-3), (필요시) 스토어 제출(§3-2)
```

---

## 5. 참고 문서
- **스토어 제출 1회성 셋업 + 트러블슈팅**: [`STORE_SUBMISSION.md`](./STORE_SUBMISSION.md)
- 스토어 등록정보(스크린샷/설명/등급): `../MOBILE/STORE_METADATA.md`
- 릴리스 단계 원안(초안): `../MOBILE/10-PHASE-7-RELEASE.md`
- Apple/Google 공식 스토어 정책 원문 덤프(참고용): `../MOBILE/DEPLOY_GUIDE/ios`, `../MOBILE/DEPLOY_GUIDE/andorid`
