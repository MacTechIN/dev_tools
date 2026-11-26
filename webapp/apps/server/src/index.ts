import fs from "node:fs";
import path from "node:path";
import { buildApp, ensureAdmin } from "./app";
import { loadConfig } from "./config";
import { openDb } from "./db";

const config = loadConfig();
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
const { app, store } = await buildApp({ db, config });

const admin = await ensureAdmin(store, config);
if (admin === "created") console.log(`관리자 계정을 만들었습니다: ${config.admin!.loginId}`);
if (admin === "weak") console.log("ADMIN_PASSWORD는 8자 이상이어야 합니다. 관리자 계정을 만들지 않았습니다.");
if (admin === "missing") {
  console.log("팀원이 아직 없습니다. ADMIN_ID와 ADMIN_PASSWORD를 설정해 다시 시작하거나 create-admin 명령을 실행하세요.");
}

await app.listen({ port: config.port, host: config.host });
console.log(`dev_tools 서버가 떴습니다: http://localhost:${config.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
