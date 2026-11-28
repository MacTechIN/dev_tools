/** Every message the devtools command prints. */
export const M = {
  usage: `사용법:
  devtools connect --server <주소> [--tools claude-code,codex] [--login-id <ID>] [--project <폴더>]
  devtools disconnect [--project <폴더>] [--all]
  devtools status

connect   이 컴퓨터의 AI 개발툴을 dev_tools에 연결합니다. ID와 비밀번호로 한 번 로그인하고,
          비밀번호 대신 이 컴퓨터용 토큰만 저장합니다.
disconnect  connect가 넣은 설정만 되돌립니다.
status    연결 상태와 아직 보내지 못한 기록 수를 보여 줍니다.`,
  askLoginId: "ID: ",
  askPassword: "비밀번호: ",
  needServer: "--server <주소>가 필요합니다. 예: devtools connect --server https://devtools.example.com",
  badServer: (s: string) => `서버 주소가 올바르지 않습니다: ${s}`,
  unreachable: (s: string) => `서버에 연결할 수 없습니다: ${s}`,
  invalidCredentials: "ID나 비밀번호가 맞지 않습니다.",
  tooMany: "로그인 시도가 너무 많습니다. 1분 뒤에 다시 하세요.",
  mustChange: "임시 비밀번호를 쓰고 있습니다. 브라우저에서 로그인해 비밀번호를 바꾼 뒤 다시 연결하세요.",
  loginFailed: (status: number) => `로그인하지 못했습니다(응답 ${status}).`,
  noTools: "연결할 AI 개발툴을 찾지 못했습니다. claude 또는 codex가 설치돼 있는지 확인하거나 --tools로 지정하세요.",
  unknownTool: (t: string) => `지원하지 않는 도구입니다: ${t} (지원: claude-code, codex)`,
  otherServer: (s: string) => `이 컴퓨터는 이미 다른 서버(${s})에 연결돼 있습니다. 먼저 devtools disconnect --all 을 실행하세요.`,
  reuseToken: "이 컴퓨터용 토큰이 이미 있어 그대로 씁니다.",
  tokenRevoked: "저장된 토큰이 더 이상 유효하지 않아 다시 로그인합니다.",
  connected: (name: string, root: string) => `${name} 님, 연결했습니다. 프로젝트: ${root}`,
  installed: (tool: string, file: string) => `  - ${tool}: ${file}`,
  codexTrust:
    "Codex는 새로 넣은 hook을 처음 실행하기 전에 신뢰할지 묻습니다. Codex를 열어 승인해야 기록이 시작됩니다.",
  claudeRestart: "이미 열려 있는 Claude Code 세션은 다시 시작해야 기록이 시작됩니다.",
  notConnected: "이 컴퓨터는 아직 연결돼 있지 않습니다.",
  projectNotConnected: (root: string) => `이 프로젝트는 연결돼 있지 않습니다: ${root}`,
  disconnected: (root: string) => `연결을 끊었습니다: ${root}`,
  allDisconnected: "모든 연결을 끊고 이 컴퓨터용 토큰을 폐기했습니다.",
  revokeFailed: "서버에 닿지 못해 토큰을 폐기하지 못했습니다. 웹 화면의 설정 > 내 컴퓨터 연결에서 끊어 주세요.",
  status: (server: string, loginId: string) => `서버: ${server}\nID: ${loginId}`,
  statusProject: (root: string, tools: string) => `프로젝트: ${root} (${tools})`,
  pending: (n: number) => `보내지 못한 기록: ${n}개`,
  queueFull: "보내지 못한 기록이 너무 많아 새 기록을 버렸습니다. 서버 연결을 확인하세요.",
  unauthorized: "서버가 이 컴퓨터용 토큰을 거부했습니다. devtools connect 를 다시 실행하세요.",
};
