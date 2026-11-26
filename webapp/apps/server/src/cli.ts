import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { hashPassword, tempPassword } from "./security";
import { Store } from "./store";

// Usage: node dist/cli.js create-admin <loginId> [name]
const [command, loginId, name] = process.argv.slice(2);
if (command !== "create-admin" || !loginId) {
  console.error("사용법: create-admin <ID> [이름]");
  process.exit(1);
}

const config = loadConfig();
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const store = new Store(openDb(config.dbPath));
if (store.memberByLoginId(loginId)) {
  console.error(`이미 있는 ID입니다: ${loginId}`);
  process.exit(1);
}
const password = tempPassword();
store.createMember({
  loginId,
  name: name ?? loginId,
  passwordHash: await hashPassword(password),
  roles: ["admin", "lead", "dev"],
  mustChangePassword: true,
});
console.log(`관리자 계정을 만들었습니다.\n  ID: ${loginId}\n  임시 비밀번호: ${password}\n첫 로그인 때 비밀번호를 바꾸게 됩니다.`);
