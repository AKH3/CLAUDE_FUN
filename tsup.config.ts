import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  splitting: true, // lazy subcommands -> hooks don't load the server/MCP SDK
  clean: true, // wipes dist/; build:ui runs afterwards and recreates dist/ui
  minify: true,
  sourcemap: false,
  noExternal: [/.*/], // ship one self-contained folder; no runtime deps
  define: { __VERSION__: JSON.stringify(version) },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
