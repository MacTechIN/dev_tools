// Sends a few sample events so the dashboard has something to show.
// Usage: SERVER=http://localhost:4100 LOGIN_ID=admin PASSWORD=... node scripts/send-sample-events.mjs
const server = process.env.SERVER ?? "http://localhost:4100";
const loginId = process.env.LOGIN_ID ?? "admin";
const password = process.env.PASSWORD;
if (!password) {
  console.error("PASSWORD 환경 변수가 필요합니다.");
  process.exit(1);
}

async function post(path, body, token) {
  const res = await fetch(server + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const { token } = await post("/api/device-tokens", { loginId, password, label: "sample-script" });
const session = `sample-${Date.now()}`;
const base = (kind, data = {}, tool = "claude-code") => ({
  id: `${session}-${kind}-${Math.random().toString(36).slice(2)}`,
  tool,
  session,
  at: new Date().toISOString(),
  branch: "req/REQ-TSK-005-expire-claims",
  kind,
  data,
});
const result = await post(
  "/api/events",
  {
    events: [
      base("session.start", { toolVersion: "sample" }),
      base("turn.start"),
      base("file.change", { paths: ["apps/server/src/claims.ts", "apps/server/src/jobs/expire.ts"] }),
      base("test.result", { passed: 2, failed: 1, requirementIds: ["REQ-TSK-005"] }),
      base("git.commit", { hash: "abc1234", subject: "Add claim expiry job (REQ-TSK-005)" }, "git"),
      base("file.change", { paths: ["apps/server/src/claims.ts"] }),
    ],
  },
  token,
);
console.log("보냈습니다:", result);
