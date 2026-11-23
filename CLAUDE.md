# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

2027.03.01 풀코스 마라톤(목표 3:20:00) 대비 14주 훈련 기록·분석 대시보드. 저장소 전체가 단일 파일 `marathon2027_dashboard.html` (인라인 CSS + 바닐라 JS, 외부 라이브러리·빌드·패키지 매니저 없음). UI 문구는 모두 한국어.

## 실행 / 테스트

- 빌드·린트 도구 없음. 브라우저로 파일을 직접 열어 확인
- 테스트: `node --test tests/csv.test.mjs tests/github.test.mjs` (단일 테스트: `--test-name-pattern "왕복"`). 의존성 없음
  - 테스트는 HTML 안 스크립트를 주석 표식(`const KEY=...` ~ `// ---------- 저장`, `// ---------- 한글 CSV 저장/불러오기` ~ `// 아티팩트 downloads`, `// ---------- GitHub 동기화 (API)` ~ `// ---------- GitHub 동기화 (화면)`)으로 잘라 `vm`에서 평가하므로, 이 표식 주석을 바꾸면 테스트도 함께 수정해야 함
  - GitHub API 테스트는 가짜 `fetch`를 주입 (`ghGet`/`ghPut`의 마지막 인자)
- 브라우저 E2E: `node tests/e2e.chrome.mjs` — Headless Chrome을 DevTools Protocol로 직접 구동(의존성 없음, `CHROME` 환경변수로 경로 지정). 폼 입력·CSV 저장/불러오기·GitHub 동기화 전 흐름 검증
  - `confirm`은 자동 승인, 다운로드는 `a.click` 가로채기, GitHub API는 `localStorage('__mockgh')`에 상태를 두는 가짜 서버(새로고침 후에도 유지, 토큰 `test-token`·저장소 `me/DATA`만 허용)
  - 페이지의 최상위 `let`/`const`(`S`, `gh`, `toCSV` 등)를 `Runtime.evaluate`로 직접 참조하므로 이름을 바꾸면 E2E도 수정
  - vm에서 나온 객체는 `plain()`(JSON 왕복)을 거쳐야 `deepStrictEqual` 비교가 됨
- 배포: GitHub Pages (`main` 브랜치 루트). https://baekdoosanlee.github.io/MARATOHON_FULL_TRAINING/ — `index.html`은 대시보드로 리다이렉트만 함
- Claude Artifact로도 게시되는 것을 전제로 작성됨 (`window.claude.use('downloads')` 사용, 미지원 환경에서는 Blob 다운로드로 폴백)

## 아키텍처 (스크립트 블록 기준)

- **상수/계획 데이터** (스크립트 상단): `START`(2026-11-23, 월요일)·`RACE`, 주차별 `PLAN_KM`/`PLAN_LONG`(14개 원소), `PHASE_IDX`(주차→단계 0~3), `SESSION_PLAN`(단계별 요일 세션), `GOAL`(초 단위 목표 기록), `TYPES`(훈련 종류 → [한글명, 색상])
  - 계획을 바꿀 때는 이 배열들의 길이(14주)와 `barSvg`의 `N=14`, `sessionPlanHtml`의 `cur>13` 검사, `PHASE_IDX` 경계를 함께 맞춰야 함
- **주차 계산**: `weekOf(date)` = `START` 기준 일수 차 / 7. 주는 월~일. 날짜 문자열은 `YYYY-MM-DD`이며 `toDate`로 로컬 자정 Date로 변환 (UTC 파싱 회피 목적)
- **상태 `S`**: `{logs:[], races:[]}` 하나뿐인 전역 상태. `localStorage` 키 `marathon2027_v2`에 자동 저장
- **파일 저장/불러오기**: 한글 CSV(`toCSV`/`fromCSV`, UTF-8 BOM, `구분` 열로 훈련/대회기록 구분, 종류는 `TYPES`의 한글명). 시간은 엑셀 재저장 시 변형 방지를 위해 항상 `h:mm:ss`. 불러오기는 머리글 이름 기준이라 열 순서 무관. `{`로 시작하는 파일은 구버전 JSON 백업으로 보고 `normalize()` 경로 사용
  - 로그/대회 레코드에 필드를 추가하면 `CSV_COLS`·`toCSV`·`fromCSV` 세 곳을 함께 수정
- **GitHub 자동 저장**: 브라우저에서 GitHub Contents API로 별도 private 데이터 저장소의 CSV(기본 `training_log.csv`)를 직접 커밋. 대시보드 저장소(public)에는 기록을 두지 않음
  - 설정(저장소·경로·브랜치·토큰·`sha`·`dirty`)은 `localStorage` 키 `marathon2027_gh`
  - `save()`가 호출될 때마다 `ghSchedule()` → 1.5초 디바운스 후 `ghPush()`. GitHub에서 받은 데이터를 로컬에 쓸 때는 재업로드 방지를 위해 `save(false)`
  - 페이지 로드 시 `dirty`면 로컬 변경을 먼저 push, 아니면 GitHub 기록으로 로컬을 대체(GitHub가 기준)
  - `sha` 불일치(409/422)는 자동 병합하지 않고 사용자에게 불러오기/덮어쓰기 선택을 요구
  - 저장 키·데이터 스키마 변경 시 기존 사용자 데이터 호환성 고려 필요 (구버전 로그는 `mainKm`/`wu`/`cd`가 없을 수 있어 `mainKmOf()` 같은 폴백 사용)
- **로그 레코드**: `km`은 워밍업+본운동+쿨다운 합계(주간 거리 집계용), `mainKm`·`sec`은 본운동만(페이스 계산용). `KEY_TYPES`(언덕·인터벌·변속주·템포·MP·대회)에 한해 `wu`/`cd`/`reps`/`target` 필드 입력·저장
- **렌더링**: 프레임워크 없이 `render()`가 각 `*Html()` 함수의 문자열을 `innerHTML`로 전체 재렌더. 데이터 변경 후에는 항상 `save(); render();` 순서. 사용자 입력 문자열은 반드시 `esc()` 처리
- **차트**: `barSvg`(주간 계획 vs 실제), `lineSvg`(페이스/심박 추이)로 SVG 문자열 직접 생성
- **기록 예측**: `predLast()` — 가장 마지막 대회 기록(`S.races`의 마지막 원소)에 Riegel 공식(지수 1.06) 적용. 대회가 없으면 초기값으로 2026-11-15 하프 기록을 삽입
- 삭제 핸들러는 인라인 onclick용으로 `window.delLog`/`window.delRace`에 노출
