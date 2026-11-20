// Writes sample PDFs to samples/ for trying the app by hand.
import { writeFile, mkdir } from 'node:fs/promises';
import { loadEngine } from './pdfium-node.js';
import { buildDeck, buildScan } from './fixtures.js';
import { buildShowcase } from './showcase.js';

const engine = await loadEngine();
const dir = new URL('../samples/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('slide-deck.pdf', dir), buildDeck(engine));
await writeFile(new URL('scanned-page.pdf', dir), buildScan(engine));
await writeFile(new URL('before-after.pdf', dir), buildShowcase(engine));
console.log('Wrote samples/slide-deck.pdf, samples/scanned-page.pdf, and samples/before-after.pdf');
