# 관련 기술·방법 조사 보고서

- 기준 문서: `dev_tools_definition.md`
- 조사일: 2026-11-18
- 조사 방식: 조사 에이전트 4개를 병렬로 실행(GitHub, Hugging Face, 웹 검색, 학술 문헌)한 뒤 결과를 종합

## 1. 결론 요약

1. **컨셉 전체를 구현한 제품이나 연구는 찾지 못했다.** 팀 가시성, 작업 claim, worktree 격리, 요구사항 추적은 각각 따로 존재하지만, "AI가 빠진 부분을 찾아 보여 주고 사람이 골라 맡는" 흐름을 하나로 묶은 것은 없었다.
2. **차별점은 네 가지다.** (1) 각 개발자의 로컬 CLI 세션을 팀 단위로 실시간 표시, (2) Claude Code·Codex·Kimi·Gemini를 함께 다루는 벤더 중립, (3) AI 기반 갭 탐지, (4) 사람이 claim하는 흐름. 업계는 반대로 "에이전트에게 위임"하는 방향으로 가고 있다.
3. **가장 어려운 부분은 갭 탐지다.** 최신 연구도 "검색 후 LLM 판정" 방식이 실무 수준에 못 미친다고 스스로 밝히고, LLM이 구현된 코드를 "미구현"으로 잘못 판정하는 경향이 보고됐다. 갭은 근거를 붙인 "후보"로 보여 주고 사람이 확정하는 설계가 맞다. 이는 정의서의 "Human이 결정" 원칙과 일치한다.
4. **구성요소는 대부분 재사용할 수 있다.** claim 저장소(beads), 세션 수집(각 CLI의 hooks와 OpenTelemetry), 에이전트 연동(MCP 서버), 코드 인덱스(codegraph 등), 스펙 형식(spec-kit, OpenSpec)이 후보다.
5. **가장 큰 위험은 플랫폼 흡수와 통합 표면의 불안정이다.** GitHub, Linear, Jira, Warp가 인접 기능을 빠르게 내고 있고, CLI 도구 자체가 교체되고 있다(Kimi CLI는 archived, Gemini CLI는 소비자 플랜에서 Antigravity CLI로 대체).

## 2. 신뢰도 표기

- 표기가 없는 항목은 조사 에이전트가 해당 페이지나 API를 직접 열어 확인한 것이다.
- **[미확인]** 은 검색 결과 요약만 봤거나 페이지를 열지 못한 항목이다. 의사결정에 쓰기 전에 다시 확인해야 한다.
- GitHub 별 수와 마지막 push 날짜는 2026-11-18 GitHub API 기준이다.
- 모델 벤치마크 점수는 모두 모델 카드의 자체 보고다.
- 9장의 "권장 방향"은 조사 결과를 바탕으로 한 제안이며 검증된 사실이 아니다.

## 3. 컨셉 정리

정의서가 미완성이므로, 조사는 아래 세 가지 기능을 전제로 진행했다.

| 기능 | 내용 |
|---|---|
| Dev_Dashboard | 여러 개발자와 각자의 AI 도구 세션을 포함한 프로젝트 현황을 실시간으로 표시 |
| 갭 탐지 | AI가 프로젝트에서 빠져 있거나 담당자가 없는 부분을 찾아냄 |
| 사람이 결정하는 claim | 개발자가 대시보드에서 빠진 부분을 확인하고 맡아 끝낸 뒤 다음 부분으로 이동 |

## 4. 경쟁 지형

### 4.1 상용 제품

| 제품 | 제공하는 것 | 컨셉 대비 빠진 것 | 출처 |
|---|---|---|---|
| GitHub Agent HQ / mission control | 여러 repo의 에이전트 작업 할당, 실시간 세션 로그, 중간 개입. Claude·Codex 서드파티 에이전트는 public preview | 한 사람이 자기 에이전트를 지휘하는 관점. GitHub 클라우드 에이전트만 대상 | [발표](https://github.blog/news-insights/company-news/welcome-home-agents/), [mission control](https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/) |
| Cursor Cloud Agents | 격리 VM 병렬 실행, 팀 멤버 read-only 열람 | Cursor 자체 에이전트만 대상 | [문서](https://cursor.com/docs/cloud-agents) |
| OpenAI Codex (enterprise) | Analytics 대시보드와 API, Team Tasks(예약·이벤트 트리거 작업) | Team Tasks는 자동화 작업이며 claim 보드가 아님 | [governance](https://learn.chatgpt.com/docs/enterprise/governance), [team-tasks](https://learn.chatgpt.com/codex/enterprise/team-tasks) |
| Claude Code | Analytics 대시보드, Agent view(백그라운드 세션 상태), Agent teams(공유 task list와 파일 락 기반 self-claim, experimental) | Analytics는 일 단위 사후 지표. Agent view는 1인·1머신. Agent teams는 세션 하나 안에서만 동작 | [analytics](https://code.claude.com/docs/en/analytics), [agent-view](https://code.claude.com/docs/en/agent-view), [agent-teams](https://code.claude.com/docs/en/agent-teams) |
| Devin | 코디네이터 Devin이 작업을 쪼개 여러 Devin에 병렬 위임 | 여러 사람 간 조율 없음 | [블로그](https://cognition.com/blog/devin-can-now-manage-devins) |
| Factory Missions | Mission Control에서 진행·마일스톤 확인과 개입 | 한 사람과 에이전트 군단 구도 | [문서](https://docs.factory.com/missions/running-cli) |
| Linear | 이슈를 에이전트에 위임, 팀원이 진행을 보고 개입 | 로컬 CLI 세션을 다루지 않음. 이슈는 사람이 만듦 | [agents](https://linear.app/docs/agents-in-linear) |
| Atlassian Agents in Jira | 에이전트를 assignee로 지정, 보드에 에이전트 작업 상태 표시, MCP로 서드파티 연결 | 갭 자동 탐지 없음 | [블로그](https://www.atlassian.com/blog/announcements/ai-agents-in-jira) |
| Warp Oz | Claude Code·Codex·Warp Agent를 한 control plane에서 실행·추적 | 클라우드 에이전트 중심. 로컬 세션 포함 여부 불명확 | [블로그](https://www.warp.dev/blog/multi-harness-cloud-agent-orchestration) |
| Conductor | Mac 앱. 여러 에이전트를 격리 workspace에서 병렬 실행 | 팀 기능 없음 | [사이트](https://www.conductor.build/) |

Codex 앱, Cursor 3 Agents Window, Devin Desktop, Conductor Cloud, Jira GA 일정, Graphite 인수 관련 내용은 **[미확인]** 이다.

### 4.2 오픈소스 중 가장 가까운 프로젝트

| 프로젝트 | 가진 것 | 빠진 것 |
|---|---|---|
| [multica-ai/multica](https://github.com/multica-ai/multica) (56.6k) | 팀 workspace, 사람과 에이전트가 함께 있는 보드, Kimi 포함 31개 에이전트 CLI 구동 | 갭 탐지 없음. "에이전트에 할당" 모델이며 각자의 세션을 관찰하지 않고 CLI를 직접 구동. 라이선스가 호스팅·상용 이용을 제한 |
| [gastownhall/beads](https://github.com/gastownhall/beads) (28.8k, MIT) | 원자적 claim, 준비된 작업 큐, 다중 작성자 동기화 | 코어에 실시간 대시보드 없음. 이슈를 누군가 등록해야 하므로 갭 발견 기능 없음 |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) (28.7k, Apache-2.0) | 에이전트 실행·worktree와 묶인 칸반 | 개발자 한 명이 자기 에이전트를 지휘하는 구조. 개발자 간 가시성 없음 |
| [agentlogs](https://github.com/agentlogs/agentlogs), [wandb/hivemind](https://github.com/wandb/hivemind), [ashlr-pulse](https://github.com/ashlrai/ashlr-pulse) | 팀 단위 세션 열람 | 사후 열람(트랜스크립트, 비용) 중심. 작업·claim 계층과 갭 탐지 없음. 모두 소규모 |
| [bearcove/tracey](https://github.com/bearcove/tracey) (259) | 스펙 요구사항과 코드·테스트를 주석으로 연결하고 미구현 요구사항을 보고. 웹 UI와 MCP 제공 | 코드에 수동 주석 필요. Rust 중심. 사람·세션·claim 개념 없음 |

vibe-kanban은 유지보수가 중단됐다는 검색 결과가 있었으나 최근 push 날짜와 맞지 않아 결론을 내리지 못했다.

## 5. 재사용 후보 (오픈소스)

### 5.1 작업 저장소와 claim

| 프로젝트 | 내용 | 별 / 라이선스 |
|---|---|---|
| [beads](https://github.com/gastownhall/beads) | 의존성 그래프 기반 이슈 트래커(Dolt). `bd ready`로 막히지 않은 작업 조회, `bd update <id> --claim`으로 담당자와 진행 상태를 원자적으로 설정 | 28.8k / MIT |
| [mcp_agent_mail_rust](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) | 에이전트 메일함, TTL이 있는 파일 lease, pre-commit 가드, 사람용 감독 웹 UI | 263 / "MIT+Rider" |
| [Backlog.md](https://github.com/MrLesk/Backlog.md) | 작업을 git 안의 Markdown 파일로 관리, 로컬 웹 칸반, MCP 서버 | 7.4k / MIT |
| [claude-task-master](https://github.com/eyaltoledano/claude-task-master) | PRD를 작업 그래프로 분해 | 28.4k / 라이선스 확인 필요 |

### 5.2 스펙 형식 (갭 탐지의 기준선)

| 프로젝트 | 내용 | 별 / 라이선스 |
|---|---|---|
| [github/spec-kit](https://github.com/github/spec-kit) | 스펙 주도 개발 도구(spec, plan, tasks) | 150k / MIT |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | 변경 제안 중심의 스펙 주도 개발 | 75k / MIT |
| [strictdoc](https://github.com/strictdoc-project/strictdoc) | `.sdoc` 파일 기반 요구사항 관리 | 452 / Apache-2.0 |

### 5.3 세션 관측

| 프로젝트 | 내용 | 별 / 라이선스 |
|---|---|---|
| [agents-observe](https://github.com/simple10/agents-observe) | Claude Code 세션과 서브에이전트의 실시간 대시보드 | 738 / MIT |
| [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | hooks가 이벤트를 서버와 대시보드로 전송 | 1.6k / 라이선스 없음(구조 참고만 가능) |
| [wesm/agentsview](https://github.com/wesm/agentsview) | 로컬 세션 보관·검색·비용 분석. 50개 이상 에이전트 파서를 표방 | 6.5k / MIT |
| [ccusage](https://github.com/ccusage/ccusage) | 로컬 로그에서 토큰·비용 집계 | 19.5k / 라이선스 확인 필요 |
| [claude-code-monitoring-guide](https://github.com/anthropics/claude-code-monitoring-guide) | Claude Code용 OpenTelemetry collector, Prometheus 설정 예시 | 392 |

### 5.4 코드 이해 (갭 탐지 입력)

| 프로젝트 | 내용 | 별 / 라이선스 |
|---|---|---|
| [codegraph](https://github.com/colbymchenry/codegraph) | 자동 동기화되는 코드 지식 그래프 | 78k / MIT |
| [code-review-graph](https://github.com/tirth8205/code-review-graph) | 로컬 영속 코드 그래프(MCP, CLI) | 32.8k / MIT |
| [serena](https://github.com/oraios/serena) | MCP 기반 심볼 단위 검색·편집 | 31.5k / 라이선스 확인 필요 |
| [code-graph-rag](https://github.com/vitali87/code-graph-rag) | 다언어 모노레포 대상 그래프 RAG | 5.4k / MIT |
| [repomix](https://github.com/yamadashy/repomix) | repo를 AI용 단일 파일로 묶음 | 29.3k / MIT |

### 5.5 격리와 프로토콜

| 프로젝트 | 내용 | 별 / 라이선스 |
|---|---|---|
| [worktrunk](https://github.com/max-sixty/worktrunk) | 병렬 에이전트용 git worktree CLI | 12.6k / Apache-2.0 |
| [MCP 스펙](https://github.com/modelcontextprotocol/modelcontextprotocol) | 네 도구 모두 지원. 갭 조회·claim·상태 보고를 MCP 서버로 노출하는 경로 | 9.7k |
| [agents.md](https://github.com/agentsmd/agents.md) | "작업 전 대시보드를 확인하고 claim하라"는 지침을 여러 도구에 주입하는 수단 | 25.6k / MIT |
| [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) | 에디터와 에이전트 사이 프로토콜. 에이전트를 구동하는 용도이며 실행 중인 세션 관찰용이 아님 | 4.7k / Apache-2.0 |
| [A2A](https://github.com/a2aproject/A2A) | 에이전트 간 프로토콜. 코딩 CLI의 지원 근거를 찾지 못해 당장 관련성 낮음 | 26.6k / Apache-2.0 |

## 6. 도구별 통합 지점

| | Claude Code | Codex CLI | Kimi Code CLI | Gemini CLI |
|---|---|---|---|---|
| Lifecycle hooks | 33개 이벤트, **HTTP POST 가능** | 14개 이벤트, command·mcp_tool | 20개 이벤트, command만 | 11개 이벤트, command만 |
| 프로젝트 단위 hook 배포 | `.claude/settings.json` | `.codex/hooks.json` | 불가(사용자별 설정) | `.gemini/settings.json` |
| OpenTelemetry | 메트릭·로그, 트레이스는 beta | 로그·메트릭 | 문서를 찾지 못함 | 로그·메트릭·트레이스 |
| Headless 스트림 | `-p --output-format stream-json` | `exec --json` | `-p --output-format stream-json` | 문서는 있으나 내용 미확인 |
| 로컬 서버 | Agent SDK, `claude agents --json` | App Server(JSON-RPC) | `kimi web` REST+WebSocket(beta) | ACP 모드 |
| MCP | 지원 | 지원 | 지원 | 지원 |
| AGENTS.md | 공식 목록에 없음 | 지원 | 미확인 | 지원 |

출처: [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Kimi Code hooks](https://moonshotai.github.io/kimi-code/en/customization/hooks.html), [Gemini CLI telemetry](https://geminicli.com/docs/cli/telemetry/), [Gemini CLI hooks](https://geminicli.com/docs/hooks/)

주의할 점은 다음과 같다.

- **세션 트랜스크립트 파일을 직접 파싱하는 것은 위험하다.** Claude Code 문서가 포맷이 내부용이며 버전마다 바뀐다고 경고한다. hooks와 OpenTelemetry를 계약으로 삼아야 한다.
- **이벤트 이름이 도구마다 다르다**(`claude_code.*`, `codex.*`, `gemini_cli.*`). 공통 필드는 세션 ID, 작업 디렉터리, 도구 호출 이벤트 정도여서 정규화 계층이 필요하다.
- **Kimi는 구 Kimi CLI가 archived 됐고 후속이 Kimi Code CLI다.** 프로젝트 단위 hook 파일이 없어 개발자마다 설치해야 한다.
- **Gemini CLI는 2026-06-18부터 무료·소비자 플랜에서 Antigravity CLI로 대체됐다.** 유료 API 키와 엔터프라이즈는 계속 쓸 수 있다. Antigravity CLI가 telemetry를 승계하는지는 확인하지 못했다. ([공지](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli))
- Hugging Face Hub의 [Agent Traces](https://huggingface.co/docs/hub/agent-traces)와 [Session Traces Format](https://huggingface.co/docs/hub/session-traces-format)은 Claude Code, Codex 등의 세션 JSONL을 다루는 단순 스키마를 제공하므로 내부 정규화 스키마의 참고 자료가 된다. Kimi와 Gemini는 지원 목록에 없다.

## 7. 갭 탐지 기술

### 7.1 접근 방식

조사 결과가 공통으로 가리키는 파이프라인은 다음과 같다.

1. 스펙을 원자적이고 검사 가능한 요구사항으로 분해한다.
2. 요구사항마다 임베딩과 리랭커로 후보 코드를 검색한다.
3. LLM이 "구현됨 / 부분 구현 / 없음"을 근거 파일·라인과 함께 판정한다.
4. 사람이 확인하고 claim 여부를 정한다.

임베딩 유사도만으로 "미구현"을 판정하는 방식은 권장되지 않는다. 결정적 방식으로는 tracey처럼 코드에 요구사항 ID 주석을 달아 커버리지를 계산하는 방법이 있으며, 두 방식을 함께 쓸 수 있다.

### 7.2 임베딩과 리랭커

| 모델 | 특징 | 라이선스 |
|---|---|---|
| [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) (4B, 8B도 있음) | 다국어, 32K 컨텍스트, 코드 검색 지원 명시. 월 다운로드 7.89M | Apache-2.0 |
| Qwen3-Reranker-0.6B / 4B / 8B | 검색 결과 재정렬 | Apache-2.0 |
| [nomic-embed-code](https://huggingface.co/nomic-ai/nomic-embed-code) | 7B 코드 전용 임베딩. GPU 필요 | Apache-2.0 |
| [F2LLM-v2](https://huggingface.co/codefuse-ai/F2LLM-v2-0.6B) (80M~14B) | 소형 모델은 로컬 CPU 인덱싱 후보. 코드 분야 SOTA 주장은 **[미확인]** | Apache-2.0 |
| [jina-code-embeddings-1.5b](https://huggingface.co/jinaai/jina-code-embeddings-1.5b), SFR-Embedding-Code | 코드 전용 | **CC-BY-NC-4.0 (상용 불가, 비교 기준으로만 사용)** |

기본 후보는 Qwen3-Embedding-0.6B와 Qwen3-Reranker 조합이다. 다만 MTEB 코드 탭의 현재 순위는 읽지 못했고, 한국어 스펙과 영어 코드 사이의 교차 언어 검색 성능도 확인하지 못했다.

### 7.3 로컬 실행 LLM

| 모델 | 특징 | 라이선스 |
|---|---|---|
| [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) | 262K 컨텍스트, vLLM·llama.cpp·Ollama 서빙 가능 | Apache-2.0 |
| [KAT-Coder-V2.5-Dev](https://huggingface.co/Kwaipilot/KAT-Coder-V2.5-Dev) | 35B MoE(활성 3B), 추론이 빠른 편 | Apache-2.0 |
| [Qwen3-Coder-Next](https://huggingface.co/Qwen/Qwen3-Coder-Next-GGUF) | 80B MoE(활성 3B), Q4 양자화가 48.4GB | Apache-2.0 |

개발자들이 이미 상용 CLI를 쓰고 있으므로, 판정 단계는 그 모델에 맡기고 로컬 LLM은 세션·diff 요약 같은 대량·저위험 작업에 두는 구성도 가능하다.

### 7.4 평가용 데이터셋

| 용도 | 데이터셋 |
|---|---|
| 갭 판정 | [ScaleAI/SWE-bench_Pro](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro): `requirements`, `interface`, `patch` 필드가 있어 patch 적용 전후로 "미구현/구현됨" 판정을 시험할 수 있음 |
| 작업 설명 → 관련 파일 검색 | [mteb/SWEbenchCodeRetrieval](https://huggingface.co/datasets/mteb/SWEbenchCodeRetrieval), [CoIR](https://huggingface.co/datasets/CoIR-Retrieval/cosqa) |
| 스펙 → 프로젝트 전체 | commit0/commit0 (목록만 확인) |
| diff·모듈 요약 | [commit-chronicle](https://huggingface.co/datasets/JetBrains-Research/commit-chronicle), [lca-module-summarization](https://huggingface.co/datasets/JetBrains-Research/lca-module-summarization) |
| 세션 로그 파싱·진행 판정 | [SWE-rebench-openhands-trajectories](https://huggingface.co/datasets/nebius/SWE-rebench-openhands-trajectories), [agent-traces 태그 데이터셋](https://huggingface.co/datasets?format=format%3Aagent-traces) |

Hugging Face에는 요구사항-코드 추적성 전용 데이터셋이 사실상 없었다. 학술 문헌도 구현 여부를 판정하는 공인 벤치마크가 없다고 본다. 자체 평가셋을 만들어야 한다.

## 8. 학술 근거

### 8.1 가장 가까운 선행 연구

| 논문 | 핵심 결과 | 시사점 |
|---|---|---|
| Long et al., 2026. ParallelPilot. arXiv 2609.33113 | 병렬 AI 코딩을 위한 PILOT(Planning, Isolating, Logging, Observing, Triaging) 도출. 계획 UI·로거·대시보드로 짧은 과제 처리량 63% 증가(N=16) | 가장 가까운 선행 연구지만 개발자 한 명 대상. PILOT은 대시보드 기능 점검표로 쓸 수 있음 |
| Khatua et al., 2026. CooperBench. arXiv 2601.13295 | 에이전트 둘이 협업하면 단독 작업보다 약 30% 낮은 성과. 모호한 메시지, 약속 불이행이 원인 | 에이전트끼리의 협상에 의존하지 말고, 약속을 사람이 소유한 기록 시스템의 claim으로 외부화 |
| Özaytürk & Buzluca, 2026. ESEM 2026. DOI 10.4230/LIPIcs.ESEM.2026.18 | 동료의 커밋·테스트 결과를 관찰한 에이전트가 격리된 에이전트보다 나음. 에이전트 둘만으로도 간섭이 급증 | 다른 개발자의 활동 요약을 각자의 에이전트 컨텍스트에 넣어 줄 가치가 있음 |
| Sarkar, 2026. arXiv 2606.19616 | git 기반 추가 전용 claim 로그로 중복 작업이 78%에서 0%로 감소 | 명시적 claim의 직접 근거. 단, 단독 저자의 미심사 프리프린트이며 초록만 확인 |
| Takerngsaksiri et al., 2024. HULA. arXiv 2411.12924 (ICSE SEIP 2025) | Atlassian에서 엔지니어가 에이전트의 계획과 코드를 검토하는 구조 | 사람이 체크포인트에서 승인하는 산업 사례 |
| Huang et al., 2025. arXiv 2512.14012 | 숙련 개발자는 통째로 위임하지 않고 계획과 감독으로 통제를 유지 | "사람이 결정, AI는 제시" 원칙을 지지 |

### 8.2 워크스페이스 인식 (대시보드의 이론적 기반)

| 논문 | 핵심 내용 |
|---|---|
| Dourish & Bellotti, 1992. CSCW '92. DOI 10.1145/143457.143468 | 공유 산출물을 통한 수동적 인식이 명시적 상태 보고보다 낫다 |
| Gutwin & Greenberg, 2002. DOI 10.1023/A:1021271517844 | 인식 요소는 누가, 무엇을, 어디서, 언제, 어떻게 |
| Biehl et al., 2007. FASTDash. CHI '07. DOI 10.1145/1240624.1240823 | 누가 어떤 파일을 열고 고치는지 보여 주는 팀 대시보드. Dev_Dashboard의 직계 선행 사례 |
| Sarma et al., 2012. Palantír. IEEE TSE. DOI 10.1109/TSE.2011.64 | 커밋 전 변경을 공유하면 충돌을 더 일찍 발견 |
| Brun et al., 2011. Crystal. ESEC/FSE '11. DOI 10.1145/2025113.2025139 | 백그라운드에서 미리 병합해 텍스트·빌드·테스트 충돌을 조기 경고 |
| Treude & Storey, 2010. ICSE '10. DOI 10.1145/1806799.1806854 | 대시보드는 프로젝트 수준 인식, 피드는 세부 이벤트에 적합 |

### 8.3 요구사항 추적과 갭 탐지

| 논문 | 핵심 내용 |
|---|---|
| Fuchß et al., 2025. LiSSA. ICSE 2025. DOI 10.1109/ICSE55347.2025.00186 | 검색 후 분류 방식이 기존 최고 성능을 넘지만, 저자들이 실무에 쓰기엔 부족하다고 밝힘 |
| Jin et al., 2025. arXiv 2508.12358 (ASE 2025 NIER) | LLM이 올바른 구현을 요구사항 미충족으로 자주 오판 |
| Zhou et al., 2026. arXiv 2605.17926 | 요구사항에서 규칙을 추출한 뒤 코드를 검사하는 2단계 방식이 산업 사례에서 탐지를 개선 |
| Hey et al., 2026. arXiv 2606.11834 (RE 2026 예정) | 요구사항의 결함이 추적 정확도를 떨어뜨림 |
| Luitel et al., 2024. Requirements Engineering 29(1). DOI 10.1007/s00766-024-00416-3 | 언어 모델로 누락된 요구사항의 단서를 찾음("요구사항 자체가 빠짐" 유형) |
| Korn et al., 2026. arXiv 2606.25550 | 구현 상태를 포함한 코드-요구사항 데이터셋을 LLM으로 만드는 것은 사람의 감독 없이는 아직 어려움 |

### 8.4 조율 이론과 작업 claim

| 논문 | 핵심 내용 |
|---|---|
| Malone & Crowston, 1994. ACM Computing Surveys. DOI 10.1145/174666.174668 | 조율은 활동 사이의 의존성을 관리하는 일. 갭 항목에는 의존 관계가 필요 |
| Cataldo et al., 2006. CSCW '06. DOI 10.1145/1180875.1180929 | 작업·파일 의존성에서 "누가 누구와 조율해야 하는지"를 계산 |
| Bolici et al., 2016. Cognitive Systems Research 38. DOI 10.1016/j.cogsys.2015.12.003 | 오픈소스 개발자는 공유 산출물에 남긴 흔적으로 조율(stigmergy) |
| Masood et al., 2020. Empirical Software Engineering. DOI 10.1007/s10664-020-09876-x | 자기 할당에는 쉬운 작업만 고르고 하기 싫은 작업이 방치되는 문제가 따름 |

### 8.5 생산성과 실패 양상

| 논문 | 핵심 내용 |
|---|---|
| Becker et al., 2025. arXiv 2507.09089 | 숙련 오픈소스 개발자 16명 대상 무작위 실험에서 AI 사용 시 19% 느려졌으나 본인은 약 20% 빨라졌다고 인식 |
| Cui et al., 2026. Management Science 72(11). DOI 10.1287/mnsc.2025.00535 | 개발자 4,867명 대상 세 실험에서 Copilot 사용 시 완료 작업 약 26% 증가 |
| Cemri et al., 2025. arXiv 2503.13657 | 다중 에이전트 실패 분류(MAST). 섣부른 완료 선언과 검증 누락이 주요 유형 |
| Zhang et al., 2025. arXiv 2505.00212 | 어느 에이전트가 언제 실패를 일으켰는지 자동으로 가려내는 성능은 낮음 |
| Dong et al., 2024. AgentOps. arXiv 2411.05285 | 에이전트 생애주기에서 추적할 산출물 분류. 세션 텔레메트리 스키마의 참고 자료 |

배경 문헌으로는 MetaGPT(arXiv 2308.00352), ChatDev(2307.07924), MAGIS(2403.17927), SWE-agent(2405.15793), OpenHands(2407.16741), SWE-bench(2310.06770), 그리고 서베이 He et al., TOSEM 2025 (DOI 10.1145/3712003)가 있다.

### 8.6 문헌이 다루지 않은 영역

- 여러 사람이 각자 에이전트를 쓰며 한 repo에서 일하는 상황에 대한 실증 연구를 찾지 못했다.
- 여러 벤더의 CLI를 가로지르는 공유 프로토콜이나 텔레메트리 스키마 연구가 없다.
- 에이전트가 코드를 바꾸는 동안 미구현 요구사항을 계속 추적하는 연구와, 부분 구현·스텁을 탐지하는 연구가 거의 없다.
- "AI가 제시하고 사람이 claim"하는 혼합 방식이 소유권과 책임에 미치는 영향은 연구되지 않았다.
- 에이전트 속도의 활동을 사람이 감당할 수 있게 집계하는 방법은 미해결이다.
- 한국 학술지(KCI, DBpia, RISS)에서는 관련 논문이 검색되지 않았다. 검색 도구의 한계일 수 있으므로 dbpia.co.kr과 kci.go.kr에서 직접 검색해 볼 필요가 있다.

## 9. 권장 방향 (제안)

조사 결과를 바탕으로 한 제안이다.

1. **상태는 자동으로 수집한다.** 개발자에게 진행 보고를 요구하지 않고 hooks, OpenTelemetry, git에서 누가·무엇을·어느 파일에서·언제 하는지를 가져온다. 자기 보고가 실제와 어긋난다는 실험 결과(Becker et al.)가 근거다.
2. **claim은 명시적이고 지속되는 기록으로 둔다.** 도구에 종속되지 않도록 repo 가까이에 두고 MCP 서버로 모든 CLI에 노출한다. beads의 원자적 claim 방식을 쓰거나 본뜬다.
3. **claim에는 만료를 둔다.** 락을 오래 쥐고 놓지 않는 문제가 Cursor와 Anthropic의 실험에서 모두 보고됐다. TTL과 heartbeat로 방치된 claim을 풀고, 오래 아무도 맡지 않은 갭을 눈에 띄게 한다.
4. **갭은 "후보"로 표시한다.** 근거 파일과 신뢰도를 붙이고, 테스트 결과를 가장 강한 완료 증거로 삼으며, 정밀도를 계속 측정한다.
5. **갭의 종류를 구분한다.** "요구사항이 구현되지 않음", "요구사항 자체가 빠짐", "담당자가 없음"은 탐지 방법이 서로 다르다.
6. **스펙을 먼저 구조화한다.** 갭 탐지의 품질은 스펙의 품질에 묶인다. spec-kit이나 OpenSpec 형식을 기준선으로 쓰는 방안을 검토한다.
7. **커밋 전 충돌을 미리 보여 준다.** 세션 간 파일 겹침과 백그라운드 사전 병합·테스트를 제공한다. worktree는 파일 충돌은 막지만 중복 작업은 막지 못한다.
8. **화면은 두 층으로 나눈다.** 프로젝트·갭 개요와 활동 피드를 분리한다. 실시간 전송은 읽기 전용 피드에 SSE를 쓰고 명령은 별도 HTTP 요청으로 보내는 구성이 일반적으로 권장된다(개인 블로그 수준의 근거).
9. **도구별 어댑터 계층을 둔다.** CLI가 교체되고 이벤트 스키마가 제각각이므로 정규화된 내부 이벤트 모델이 필요하다.

## 10. 위험과 미확인 사항

| 위험 | 내용 |
|---|---|
| 플랫폼 흡수 | GitHub, Linear, Jira, Warp가 인접 기능을 내고 있다. Claude Code의 agent teams가 세션 경계를 넘어 팀 공유로 확장되면 핵심 기능이 겹친다 |
| 통합 표면 불안정 | 트랜스크립트 포맷은 내부용이고 Kimi Server API는 experimental이다 |
| 도구 교체 | Kimi CLI와 Gemini CLI가 올해 모두 후속 제품으로 넘어갔다 |
| 갭 탐지 정확도 | 거짓 "미구현" 판정이 많을 수 있고, 스펙이 없는 프로젝트에서의 정확도는 근거를 찾지 못했다 |
| 프라이버시와 정책 | 프롬프트와 코드가 텔레메트리에 실린다. 기업 관리자가 HTTP hook URL을 제한할 수 있고, Agent SDK 기반 제품은 claude.ai 로그인을 제공할 수 없다 |
| 라이선스 | multica는 상용·호스팅 제한이 있고, claude-squad는 AGPL-3.0이며, 일부 임베딩 모델은 비상용 라이선스다 |

확인하지 못한 항목은 다음과 같다.

- MTEB 코드 분야의 현재 순위와 F2LLM-v2의 SOTA 주장
- 한국어 스펙과 영어 코드 사이의 검색 성능
- Antigravity CLI의 telemetry 지원 여부, Kimi의 AGENTS.md 지원 여부
- OpenTelemetry GenAI 시맨틱 컨벤션의 안정성 등급
- 4.1절에 [미확인]으로 적은 상용 제품 기능
- 학술 문헌 일부의 게재 학회명(논문 자체는 확인했으나 학회명은 재확인하지 못한 경우가 있음)
- 한국 학술지의 관련 연구 유무
