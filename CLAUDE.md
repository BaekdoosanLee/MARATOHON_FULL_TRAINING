# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

2027.03.01 풀코스 마라톤(목표 3:20:00) 대비 14주 훈련 기록·분석 대시보드. 저장소 전체가 단일 파일 `marathon2027_dashboard.html` (인라인 CSS + 바닐라 JS, 외부 라이브러리·빌드·패키지 매니저 없음). UI 문구는 모두 한국어.

## 실행 / 테스트

- 빌드·린트·테스트 도구 없음. 브라우저로 파일을 직접 열어 확인
- Claude Artifact로도 게시되는 것을 전제로 작성됨 (`window.claude.use('downloads')` 사용, 미지원 환경에서는 Blob 다운로드로 폴백)
- 자동화 테스트가 없으므로 로직 변경 시 브라우저에서 입력·저장·불러오기 흐름을 직접 검증해야 함

## 아키텍처 (스크립트 블록 기준)

- **상수/계획 데이터** (스크립트 상단): `START`(2026-11-23, 월요일)·`RACE`, 주차별 `PLAN_KM`/`PLAN_LONG`(14개 원소), `PHASE_IDX`(주차→단계 0~3), `SESSION_PLAN`(단계별 요일 세션), `GOAL`(초 단위 목표 기록), `TYPES`(훈련 종류 → [한글명, 색상])
  - 계획을 바꿀 때는 이 배열들의 길이(14주)와 `barSvg`의 `N=14`, `sessionPlanHtml`의 `cur>13` 검사, `PHASE_IDX` 경계를 함께 맞춰야 함
- **주차 계산**: `weekOf(date)` = `START` 기준 일수 차 / 7. 주는 월~일. 날짜 문자열은 `YYYY-MM-DD`이며 `toDate`로 로컬 자정 Date로 변환 (UTC 파싱 회피 목적)
- **상태 `S`**: `{logs:[], races:[]}` 하나뿐인 전역 상태. `localStorage` 키 `marathon2027_v2`에 자동 저장, JSON 파일 저장/불러오기 지원. 불러온 데이터는 반드시 `normalize()` 통과
  - 저장 키·데이터 스키마 변경 시 기존 사용자 데이터 호환성 고려 필요 (구버전 로그는 `mainKm`/`wu`/`cd`가 없을 수 있어 `mainKmOf()` 같은 폴백 사용)
- **로그 레코드**: `km`은 워밍업+본운동+쿨다운 합계(주간 거리 집계용), `mainKm`·`sec`은 본운동만(페이스 계산용). `KEY_TYPES`(언덕·인터벌·변속주·템포·MP·대회)에 한해 `wu`/`cd`/`reps`/`target` 필드 입력·저장
- **렌더링**: 프레임워크 없이 `render()`가 각 `*Html()` 함수의 문자열을 `innerHTML`로 전체 재렌더. 데이터 변경 후에는 항상 `save(); render();` 순서. 사용자 입력 문자열은 반드시 `esc()` 처리
- **차트**: `barSvg`(주간 계획 vs 실제), `lineSvg`(페이스/심박 추이)로 SVG 문자열 직접 생성
- **기록 예측**: `predLast()` — 가장 마지막 대회 기록(`S.races`의 마지막 원소)에 Riegel 공식(지수 1.06) 적용. 대회가 없으면 초기값으로 2026-11-15 하프 기록을 삽입
- 삭제 핸들러는 인라인 onclick용으로 `window.delLog`/`window.delRace`에 노출
