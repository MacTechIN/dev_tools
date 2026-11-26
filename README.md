# dev_tools

여러 개발자가 각자 생성형 AI 개발툴(Codex, Claude, KIMI 등)을 쓰며 한 프로젝트를 함께 만들 때, 프로젝트 현황과 빠진 부분을 실시간으로 보여 주고 누가 무엇을 맡을지는 사람이 정하게 하는 협업 도구.

- **Dev_Dashboard**: 팀 전체의 AI 작업 현황을 한 화면에서 실시간으로 본다.
- **갭 탐지**: AI가 프로젝트에서 빠진 부분을 찾아 근거와 함께 후보로 보여 준다.
- **사람이 맡는다**: 개발자가 빈 곳을 확인하고 직접 맡는다. AI가 일을 배정하지 않는다.
- **팀 대화방**: 일하던 화면을 떠나지 않고 팀원과 이야기한다.
- **출시와 전달**: 출시 방법서를 실행기가 수행해 테스트, 생성, 전달, 설치, 운영 확인을 자동으로 한다. 내보낼지는 사람이 승인한다.

## 현재 상태

개발 1단계를 진행하고 있다. 제품 코드는 [`webapp/`](webapp/)에 있고 그 폴더만으로 빌드하고 배포한다.

- **되는 것**: 로그인, 팀원 관리, 활동 이벤트 수집, 실시간 화면(홈, 활동 흐름, 설정), 컨테이너 배포
- **아직 없는 것**: AI 개발툴 어댑터와 연결 명령, 맡기, 갭 탐지, 팀 대화방, 출시 자동화

어댑터가 없어 실제 AI 개발툴의 활동은 아직 들어오지 않는다. 단계별 현황은 `development_plan.md`의 "진행 현황"에 있다.

## 문서

읽는 순서대로 적었다.

| 문서 | 내용 |
|---|---|
| [`dev_tools_definition.md`](dev_tools_definition.md) | 정의서. 무엇을 왜 만드는가, 범위, 원칙 |
| [`docs/process.html`](docs/process.html) | 전체 프로세스도 (개발 12단계와 출시 5단계) |
| [`docs/ui_concept.html`](docs/ui_concept.html) | UI 개념도. 화면 구성과 쉬운 말 |
| [`docs/requirements.md`](docs/requirements.md) | 요구사항 명세서. ID가 붙은 요구사항 132개 |
| [`docs/tech_design.md`](docs/tech_design.md) | 기술 설계서. 구조, 데이터 모델, API, 연동 |
| [`development_plan.md`](development_plan.md) | 개발 계획서. 단계별 작업과 완료 기준 |
| [`docs/conventions.md`](docs/conventions.md) | 개발 규칙. 브랜치, 커밋, 테스트, AI 개발툴 사용 |
| [`docs/decisions.md`](docs/decisions.md) | 결정 기록. 확정된 것과 남은 것 |
| [`docs/release_delivery.md`](docs/release_delivery.md) | 완성 이후의 테스트, 생성, 전달, 설치 확인과 그 자동화 |
| [`webapp/README.md`](webapp/README.md) | 웹앱의 실행, 테스트, 배포 방법 |
| [`dev_direction.md`](dev_direction.md) | 개발 방향. 정의서 분석과 방향의 근거 |
| [`research.md`](research.md) | 조사 보고서. 관련 오픈소스, 모델, 제품, 논문 |

HTML 문서는 내려받아 브라우저로 연다.

## 다음에 할 일

1. `docs/release_delivery.md`의 자동화 방식을 최종 점검한다.
2. Claude Code와 Codex CLI의 hook 형식을 실제 도구에서 확인하고 어댑터와 연결 명령을 만든다.
3. 요구사항을 `webapp/spec/`으로 옮기고 갭 탐지 사전 실험을 시작한다.

## AI 개발툴로 이 저장소를 다룰 때

`CLAUDE.md`(Claude Code)와 `AGENTS.md`(Codex 등)에 지침이 있다.
