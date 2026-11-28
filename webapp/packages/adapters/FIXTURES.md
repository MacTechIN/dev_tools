# hook 표본

실제 도구가 hook에 넘긴 JSON을 그대로 모은 것이다. 파일 이름이 도구 버전이다. 어댑터 테스트가 이 표본으로 변환 결과를 확인한다.

| 파일 | 받은 방법 |
|---|---|
| `claude-code/fixtures/2.1.332.jsonl` | Claude Code 2.1.332에서 파일 만들기, 명령 실행, 실패하는 명령을 시킨 한 세션의 모든 hook 입력 (10개) |
| `codex/fixtures/0.166.0.jsonl` | Codex CLI 0.166.0의 `SessionStart`, `UserPromptSubmit`, `SessionEnd`. 도구 이벤트는 사용 한도 때문에 아직 받지 못함 |
| `codex/fixtures/schemas-0.166.0/` | Codex 0.166.0 실행 파일에 들어 있는 hook 입력 JSON 스키마 |

- 받은 날: 2026-11-27
- 개인 경로는 `/work/demo`, `/home/dev/...`로 바꿨다. 그 밖의 내용은 고치지 않았다.
- 새 버전에서 필드가 바뀌면 새 버전 이름으로 파일을 더하고, 이전 파일은 지우지 않는다.
