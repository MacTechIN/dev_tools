# dev_tools 웹앱

dev_tools의 제품 코드다. 이 폴더만으로 빌드하고 배포한다. 제품의 정의와 설계는 상위 폴더의 `README.md`와 `docs/`에 있다.

## 지금 되는 것

- ID와 비밀번호 로그인, 첫 로그인 때 비밀번호 바꾸기
- 관리자의 팀원 추가, 역할 변경, 쉬게 하기, 임시 비밀번호 발급 (인원 수 제한 없음)
- 컴퓨터용 토큰 발급과 끊기
- 공통 형식의 활동 이벤트 수집 (프롬프트와 코드 본문은 저장하지 않음)
- 실시간 화면: 홈(지금 우리 팀), 활동 흐름, 설정
- 연결 명령(`devtools connect`)과 Claude Code, Codex CLI 어댑터. 세션, 지시, 파일 변경, 명령, 브랜치와 커밋이 자동으로 들어온다

아직 없는 것: 맡기(claim), 갭 탐지, 팀 대화방, 출시, 테스트 결과 수집.

## 구성

```
apps/server        서버 (Fastify, SQLite). 빌드된 화면과 연결 명령 파일도 함께 내보낸다
apps/web           화면 (React, Vite)
packages/shared    공통 이벤트 형식, 타입, 상태 계산 규칙
packages/adapters  도구별 변환 함수와 실제 도구에서 받은 hook 표본(fixtures)
packages/cli       devtools 명령. 빌드하면 파일 하나(dist/devtools.mjs)
scripts            시험용 스크립트
```

## 팀원의 컴퓨터 연결

각 팀원이 자기 컴퓨터의 프로젝트 폴더에서 한 번 실행한다. Node.js 22 이상이 필요하다.

```bash
curl -fsSL -o devtools.mjs https://<서버>/devtools.mjs
node devtools.mjs connect --server https://<서버>
```

- ID와 비밀번호를 한 번 묻고, 비밀번호 대신 이 컴퓨터용 토큰만 `~/.config/devtools/`에 저장한다. 임시 비밀번호인 동안에는 먼저 브라우저에서 비밀번호를 바꿔야 한다.
- 설치된 `claude`, `codex`를 찾아 hook을 넣는다. 특정 도구만 넣으려면 `--tools claude-code` 처럼 지정한다.
- Claude Code: 이미 열린 세션은 다시 시작해야 기록이 시작된다.
- Codex: 처음 열 때 새 hook을 신뢰할지 묻는다. 승인해야 기록이 시작된다.
- 프롬프트, 응답, 파일 내용, 명령 문자열은 컴퓨터 밖으로 나가지 않는다. 파일 경로와 명령의 종류(테스트, 빌드, 기타)만 보낸다.

| 명령 | 하는 일 |
|---|---|
| `node ~/.config/devtools/bin/devtools.mjs status` | 연결 상태와 아직 보내지 못한 기록 수 |
| `node ~/.config/devtools/bin/devtools.mjs disconnect` | 이 프로젝트의 연결만 끊기. `--all`이면 전부 끊고 토큰 폐기 |

## 개발

Node.js 22 이상이 필요하다.

```bash
npm install

# 터미널 1: 서버 (http://localhost:4100)
ADMIN_ID=admin ADMIN_PASSWORD=<8자 이상> npm run dev:server

# 터미널 2: 화면 (http://localhost:5173, /api는 서버로 넘어간다)
npm run dev:web
```

| 명령 | 하는 일 |
|---|---|
| `npm test` | 전체 테스트 |
| `npm test -w @devtools/server -- auth` | 서버 테스트 중 파일 이름에 `auth`가 들어간 것만 |
| `npm test -w @devtools/server -- -t "REQ-ADM-008"` | 이름에 그 요구사항 ID가 들어간 테스트만 |
| `npm run typecheck` | 타입 검사 |
| `npm run build` | 화면, 연결 명령, 서버를 빌드 |
| `npm start` | 빌드한 서버 실행 |

화면에 활동을 채워 보려면 서버를 띄운 뒤 시험용 스크립트를 실행한다.

```bash
PASSWORD=<관리자 비밀번호> npm run sample-events
```

## 설정

환경 변수로 한다. `.env.example`에 설명이 있다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `4100` | 서버가 듣는 포트 |
| `DATA_DIR` | `./data` | SQLite 파일을 두는 폴더 |
| `ADMIN_ID`, `ADMIN_PASSWORD`, `ADMIN_NAME` | 없음 | 팀원이 한 명도 없을 때 이 값으로 관리자를 만든다 |
| `COOKIE_SECURE` | `false` | HTTPS 뒤에서 쓸 때 `true` |
| `WEB_DIST` | `apps/web/dist` | 빌드된 화면의 위치 |
| `CLI_BUNDLE` | `packages/cli/dist/devtools.mjs` | `/devtools.mjs`로 내려줄 연결 명령 파일 |

## 배포

서버는 프로세스 하나이고 데이터는 파일 하나(`DATA_DIR/devtools.sqlite`)다.

### 컨테이너로

```bash
cp .env.example .env        # ADMIN_PASSWORD를 채운다
docker compose up -d --build
```

데이터는 `devtools-data` 볼륨에 남는다. 새 버전은 같은 명령으로 올린다.

### Node.js로 직접

```bash
npm ci
npm run build
ADMIN_ID=admin ADMIN_PASSWORD=<8자 이상> DATA_DIR=/var/lib/devtools npm start
```

환경 변수 대신 명령으로 관리자를 만들 수도 있다. 임시 비밀번호가 출력된다.

```bash
DATA_DIR=/var/lib/devtools npm run create-admin -- <ID> <이름>
```

### 배포한 뒤 확인

1. `curl http://<서버>:4100/api/health`가 `{"ok":true}`를 돌려준다.
2. 브라우저에서 관리자로 로그인된다.
3. 설정에서 팀원을 추가하면 임시 비밀번호가 나온다.
4. 서버를 다시 시작해도 로그인과 기록이 남아 있다.
5. `curl -I http://<서버>:4100/devtools.mjs`가 200을 돌려준다.

### 운영할 때

- 회사 밖에서 접속하게 하려면 HTTPS를 처리하는 프록시 뒤에 두고 `COOKIE_SECURE=true`로 설정한다.
- 실시간 전송(`/api/stream`)은 오래 열려 있는 연결이다. 프록시에서 응답 버퍼링을 끄고 제한 시간을 넉넉히 둔다.
- 백업은 서버를 멈추고 `DATA_DIR`을 복사한다.

지금은 이 절차를 손으로 한다. 출시 방법서(`release.yml`)와 실행기에 의한 자동 배포는 개발 계획의 6~7단계에서 만든다(`../docs/release_delivery.md`).
