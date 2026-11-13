// Kit asset-preview: bundles the game's own effect code for the VFX view.  node build_vfx.mjs <entry.ts> <out.js>
// Called by build_preview.py. <entry.ts> is the project's vfx_entry.ts (next to this file): it imports the effect
// functions from the game's src/ and sets window.GAME_FX (see vfx_entry.example.ts and KIT.md).
// esbuild comes from the project's node_modules (this file sits in <project>/.office-desk/preview/).
// Bundling rules, same as a playable built by webpack (template-pla):
//   phaser                      -> window.Phaser (the page loads the project's node_modules/phaser/dist/phaser.min.js)
//   @smoud/playable-sdk, */tracking/* -> no-op: the preview never sends tracking events nor opens a store
//   .atlas                      -> base64 data URI (asset/inline), .png/.webp/.jpg/.ttf -> data URI, .json -> object
//   sounds                      -> "" (the VFX view is silent)
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [entry, out] = process.argv.slice(2);
if (!entry || !out) { console.error('usage: node build_vfx.mjs <entry.ts> <out.js>'); process.exit(2); }

const loaders = {
  name: 'preview-loaders',
  setup(b) {
    b.onResolve({ filter: /^phaser$/ }, () => ({ path: 'phaser', namespace: 'stub' }));
    b.onLoad({ filter: /^phaser$/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'module.exports = window.Phaser;' }));
    b.onResolve({ filter: /^@smoud\/playable-sdk|(^|\/)tracking\// }, (a) => ({ path: a.path, namespace: 'noop' }));
    b.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({
      loader: 'js',
      contents: `const n = new Proxy(function () {}, { get: (t, k) => (k === '__esModule' ? false : k === Symbol.toPrimitive ? () => '' : n),
        apply: () => n, construct: () => n }); module.exports = n;`,
    }));
    b.onLoad({ filter: /\.atlas$/ }, (a) => ({
      loader: 'js',
      contents: `export default ${JSON.stringify('data:text/plain;base64,' + readFileSync(a.path).toString('base64'))};`,
    }));
    b.onLoad({ filter: /\.(mp3|wav|ogg|m4a)$/ }, () => ({ loader: 'js', contents: 'export default "";' }));
  },
};

await build({
  entryPoints: [path.resolve(entry)],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  outfile: out,
  minify: true,
  logLevel: 'error',
  plugins: [loaders],
  // build-time globals of playable-scripts, in case game code reads them
  define: { AD_NETWORK: '"preview"', AD_PROTOCOL: '"none"', GOOGLE_PLAY_URL: '""', APP_STORE_URL: '""' },
  loader: { '.json': 'json', '.png': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.ttf': 'dataurl', '.woff2': 'dataurl' },
});
