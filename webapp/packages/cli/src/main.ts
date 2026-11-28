import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import type { Tool } from "@devtools/shared";
import { homeDir, loadConfig } from "./config";
import { connect, disconnect, UserError } from "./connect";
import { runHook } from "./hook";
import { M } from "./messages";
import { flush, pendingCount } from "./queue";

function ask(question: string, hidden: boolean): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Print the question but not the typed characters.
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    let shown = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!shown) {
        write(s);
        shown = true;
      }
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

/** Copies the running bundle to a fixed place so hooks keep working if the download is deleted. */
function installSelf(home: string): string {
  const current = path.resolve(process.argv[1] ?? "");
  if (!current.endsWith(".mjs")) throw new UserError("빌드한 devtools.mjs 파일로 실행하세요.");
  const target = path.join(home, "bin", "devtools.mjs");
  if (current !== target) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(current, target);
    fs.chmodSync(target, 0o700);
  }
  return target;
}

function startFlush() {
  const child = spawn(process.execPath, [path.resolve(process.argv[1] ?? ""), "flush"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const home = homeDir();

  if (command === "hook") {
    // Called by the AI tool for every hook. Prints nothing (some tools add hook output to the
    // conversation) and always succeeds (REQ-COL-011).
    try {
      const input = fs.readFileSync(0, "utf8");
      if (runHook({ home, tool: rest[0] ?? "", input }).length > 0) startFlush();
    } catch {
      // ignore
    }
    return 0;
  }

  if (command === "flush") {
    const cfg = loadConfig(home);
    if (cfg) await flush(home, cfg).catch(() => undefined);
    return 0;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      server: { type: "string" },
      tools: { type: "string" },
      "login-id": { type: "string" },
      project: { type: "string" },
      all: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const dir = path.resolve(values.project ?? process.cwd());
  const log = (line: string) => console.log(line);

  switch (command) {
    case "connect": {
      if (!values.server) throw new UserError(M.needServer);
      await connect({
        home,
        server: values.server,
        dir,
        tools: values.tools ? (values.tools.split(",").map((t) => t.trim()).filter(Boolean) as Tool[]) : undefined,
        loginId: values["login-id"],
        password: process.env.DEVTOOLS_PASSWORD,
        ask,
        log,
        node: process.execPath,
        script: installSelf(home),
      });
      return 0;
    }
    case "disconnect":
      await disconnect({ home, dir, all: values.all ?? false, log });
      return 0;
    case "status": {
      const cfg = loadConfig(home);
      if (!cfg) {
        log(M.notConnected);
        return 1;
      }
      log(M.status(cfg.server, cfg.loginId));
      for (const p of cfg.projects) log(M.statusProject(p.root, p.tools.join(", ")));
      const result = await flush(home, cfg);
      if (result === "unauthorized") log(M.unauthorized);
      log(M.pending(pendingCount(home)));
      return 0;
    }
    default:
      log(M.usage);
      return command === undefined || command === "help" || command === "--help" ? 0 : 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof UserError || (err instanceof Error && err.name === "TypeError") ? err.message : err);
    process.exit(1);
  },
);
