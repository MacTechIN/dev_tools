import { defineConfig } from "tsup";

// One self-contained file: members download it from the server and run it with Node.js.
export default defineConfig({
  entry: { devtools: "src/main.ts" },
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  target: "node22",
  platform: "node",
  clean: true,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node" },
});
