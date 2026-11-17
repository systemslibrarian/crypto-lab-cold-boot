// Bundles scripts/measure.ts and runs it. The lab's source imports modules
// without file extensions, which is what Vite expects and what plain Node
// cannot resolve, so the measurement harness goes through the same bundler the
// shipped build uses (rolldown, via Vite) rather than a second module system
// with its own resolution rules.
import { rolldown } from 'rolldown';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'cold-boot-measure-'));
const bundle = await rolldown({ input: 'scripts/measure.ts', platform: 'node' });
await bundle.write({ dir, format: 'esm' });
await bundle.close();
await import(pathToFileURL(join(dir, 'measure.mjs')).href).catch(() =>
  import(pathToFileURL(join(dir, 'measure.js')).href),
);
