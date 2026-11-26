import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // The shared package ships TypeScript source, so it must be bundled in.
  noExternal: [/^@devtools\/shared/, "zod"],
});
