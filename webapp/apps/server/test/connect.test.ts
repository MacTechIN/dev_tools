import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { ADMIN, deviceToken, event, login, startApp } from "./helpers";

test("REQ-ADM-005: a computer can revoke its own token, and it stops working at once", async () => {
  const t = await startApp();
  const token = await deviceToken(t.app, ADMIN.loginId, ADMIN.password, "laptop");
  const keep = await deviceToken(t.app, ADMIN.loginId, ADMIN.password, "desktop");
  const auth = (tk: string) => ({ authorization: `Bearer ${tk}` });

  const res = await t.app.inject({ method: "DELETE", url: "/api/device-tokens/self", headers: auth(token) });
  expect(res.statusCode).toBe(200);
  const after = await t.app.inject({ method: "POST", url: "/api/events", headers: auth(token), payload: { events: [event("e1", "turn.start")] } });
  expect(after.statusCode).toBe(401);
  // The member's other computers stay connected.
  const other = await t.app.inject({ method: "GET", url: "/api/me", headers: auth(keep) });
  expect(other.statusCode).toBe(200);

  // A browser login has no device token to revoke.
  const cookie = await login(t.app, ADMIN.loginId, ADMIN.password);
  const web = await t.app.inject({ method: "DELETE", url: "/api/device-tokens/self", headers: { cookie } });
  expect(web.statusCode).toBe(400);
  await t.close();
});

test("REQ-ADM-001: the server hands out the devtools command without login", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devtools-bundle-"));
  const bundle = path.join(dir, "devtools.mjs");
  fs.writeFileSync(bundle, "#!/usr/bin/env node\nconsole.log('hi');\n");
  const t = await startApp(":memory:", bundle);
  const res = await t.app.inject({ method: "GET", url: "/devtools.mjs" });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("javascript");
  expect(res.body).toContain("console.log");
  await t.close();

  const missing = await startApp();
  expect((await missing.app.inject({ method: "GET", url: "/devtools.mjs" })).statusCode).toBe(404);
  await missing.close();
  fs.rmSync(dir, { recursive: true });
});
