import path from "node:path";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  cookieSecure: boolean;
  /** Folder holding the built dashboard; served if it exists. */
  webDist: string;
  /** The built `devtools` command, served at /devtools.mjs if it exists. */
  cliBundle: string;
  sessionDays: number;
  admin?: { loginId: string; name: string; password: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? "./data");
  const admin =
    env.ADMIN_ID && env.ADMIN_PASSWORD
      ? { loginId: env.ADMIN_ID, name: env.ADMIN_NAME || env.ADMIN_ID, password: env.ADMIN_PASSWORD }
      : undefined;
  return {
    port: Number(env.PORT ?? 4100),
    host: env.HOST ?? "0.0.0.0",
    dbPath: path.join(dataDir, "devtools.sqlite"),
    cookieSecure: env.COOKIE_SECURE === "true",
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : path.resolve(import.meta.dirname, "../../web/dist"),
    cliBundle: env.CLI_BUNDLE
      ? path.resolve(env.CLI_BUNDLE)
      : path.resolve(import.meta.dirname, "../../../packages/cli/dist/devtools.mjs"),
    sessionDays: 30,
    admin,
  };
}
