import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, renderPage, pixelAt, DocBuilder } from './pdfium-node.js';
import { buildDeck, buildScan } from './fixtures.js';
import { classify, resolveActions, objectsInRect, DEFAULT_TOGGLES } from '../src/classify.js';
import {
  parsePageRanges, formatPageRanges, pageRuns, removePages, restorePages, keepOnlyPages, outputIndex, splitRuns, splitFileNames,
} from '../src/pages.js';
import { makeZip, crc32 } from '../src/zip.js';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sheetLayout, fitInCell, sheetCount, MM, normalizeMargins, shiftsPage, altersPage } from '../src/layout.js';

const engine = await loadEngine();
const deck = buildDeck(engine);
const scan = buildScan(engine);

const analyzeDeck = () => classify(engine.analyze(deck));
const find = (a, pred) => a.pages.flatMap((p) => p.objects).find(pred);
const byText = (a, s) => find(a, (o) => o.type === 'text' && o.text === s);
const isWhite = ([r, g, b]) => r > 245 && g > 245 && b > 245;

test('analyze lists objects with page-space bounds, including inside form XObjects', () => {
  const a = engine.analyze(deck);
  assert.equal(a.pages.length, 2);
  assert.equal(a.pages[0].width, 720);
  const note = byText(a, 'Note: figures are unaudited.');
  assert.ok(note.parent, 'callout text is nested in a form');
  // The form was placed at (40, 300); the text sits at (20, 45) inside it.
  assert.ok(Math.abs(note.bounds[0] - 61) < 2 && Math.abs(note.bounds[1] - 342) < 3, `bounds ${note.bounds}`);
});

test('classify finds backgrounds, pictures, light text and pale line art', () => {
  const a = analyzeDeck();
  const [p1, p2] = a.pages;
  const bg = p1.objects[0];
  assert.equal(bg.role, 'background');
  assert.equal(bg.confidence, 'high');
  assert.equal(find(a, (o) => o.page === 0 && o.type === 'image').role, 'image');
  assert.equal(byText(a, 'Quarterly Review').role, 'lightText');
  assert.equal(byText(a, '42').role, 'lightText');
  const bar = p1.byId.get(byText(a, '42').under[0]);
  assert.equal(bar.role, 'background');
  assert.equal(bar.confidence, 'low', 'chart bars behind labels are only possible backgrounds');
  assert.equal(find(a, (o) => o.page === 0 && o.type === 'path' && !o.fill).role, 'lightArt', 'white chart axis');

  assert.equal(p2.objects[0].role, 'background', 'heading banner');
  assert.equal(p2.objects[0].confidence, 'high');
  const callout = find(a, (o) => o.page === 1 && o.parent && o.type === 'path');
  assert.equal(callout.role, 'background');
  assert.equal(byText(a, 'Hidden white text on white').role, undefined, 'pale text on a white page is left alone');
  assert.equal(byText(a, 'Body copy in black stays exactly as it is.').role, undefined);
  assert.ok(!p1.scan && !p2.scan);
});

test('default actions remove backgrounds and pictures and blacken pale ink over removed backgrounds', () => {
  const a = analyzeDeck();
  const { actions } = resolveActions(a, DEFAULT_TOGGLES);
  const act = (o) => actions[o.id] || 'keep';
  assert.equal(act(a.pages[0].objects[0]), 'remove');
  assert.equal(act(find(a, (o) => o.page === 0 && o.type === 'image')), 'remove');
  assert.equal(act(byText(a, 'Quarterly Review')), 'black');
  assert.equal(act(byText(a, 'Units')), 'black');
  assert.equal(act(byText(a, '42')), 'keep', 'label stays white on its kept bar');
  assert.equal(act(byText(a, 'Note: figures are unaudited.')), 'black');
  assert.equal(act(byText(a, 'Hidden white text on white')), 'keep');
  assert.equal(act(find(a, (o) => o.page === 0 && o.type === 'path' && !o.fill)), 'black', 'white chart axis turns black');
});

test('user choices override toggles and ripple to the text above them', () => {
  const a = analyzeDeck();
  const bg = a.pages[0].objects[0];
  const bar = a.pages[0].byId.get(byText(a, '42').under[0]);
  const { actions } = resolveActions(a, DEFAULT_TOGGLES, { [bg.id]: 'keep', [bar.id]: 'remove' });
  assert.equal(actions[bg.id], undefined);
  assert.equal(actions[byText(a, 'Quarterly Review').id], undefined, 'title stays white on the kept background');
  assert.equal(actions[bar.id], 'remove');
  // Under the bar is the (kept) navy background, so the label stays white.
  assert.equal(actions[byText(a, '42').id], undefined);

  const whiteBg = resolveActions(a, DEFAULT_TOGGLES, { [bg.id]: 'white' }).actions;
  assert.equal(whiteBg[bg.id], 'white');
  assert.equal(whiteBg[byText(a, 'Quarterly Review').id], 'black');

  const textOff = resolveActions(a, { ...DEFAULT_TOGGLES, text: false }).actions;
  assert.equal(textOff[byText(a, 'Quarterly Review').id], undefined);
  assert.equal(textOff[find(a, (o) => o.page === 0 && o.type === 'path' && !o.fill).id], undefined, 'axis stays pale when the switch is off');
});

test('dark boxes hidden under a background picture are found too (texture over a dark panel)', () => {
  // Layout of phrack-72.pdf page 3: a dark box under a semi-transparent column texture, white text on top.
  const W = 612, H = 859;
  const dark = { r: 35, g: 30, b: 30, a: 255 };
  const white = { r: 255, g: 255, b: 255, a: 255 };
  const objects = [
    { id: '0:0', order: 0, type: 'path', bounds: [0, 0, 339, 344], fill: dark },
    { id: '0:1', order: 1, type: 'image', bounds: [0, 0, 339, 859] },
    { id: '0:2', order: 2, type: 'path', bounds: [0, 400, 339, 600], fill: white }, // light card
    { id: '0:3', order: 3, type: 'path', bounds: [0, 450, 100, 500], fill: dark }, // under the card
    { id: '0:4', order: 4, type: 'text', bounds: [50, 300, 290, 310], fill: white, renderMode: 0 },
    { id: '0:5', order: 5, type: 'text', bounds: [50, 700, 290, 710], fill: white, renderMode: 0 },
    { id: '0:6', order: 6, type: 'text', bounds: [10, 410, 90, 420], fill: dark, renderMode: 0 },
  ];
  const a = classify({ pages: [{ index: 0, width: W, height: H, objects }] });
  const [box, , , hidden, low, high] = a.pages[0].objects;
  assert.equal(box.role, 'background');
  assert.equal(box.confidence, 'high');
  assert.equal(hidden.role, undefined, 'a box hidden beneath an opaque light card is not a backdrop');
  const { actions } = resolveActions(a, DEFAULT_TOGGLES);
  assert.equal(actions['0:0'], 'remove');
  assert.equal(actions['0:1'], 'remove');
  assert.equal(actions[low.id], 'black', 'text over the dark box turns black once both layers go');
  assert.equal(actions[high.id], 'black');
});

test('removing a group drops its children from the edit list', () => {
  const a = analyzeDeck();
  const form = find(a, (o) => o.type === 'form');
  const { actions } = resolveActions(a, DEFAULT_TOGGLES, { [form.id]: 'remove' });
  assert.equal(actions[form.id], 'remove');
  assert.ok(!Object.keys(actions).some((id) => id.startsWith(form.id + '.')));
});

test('applied PDF renders printer-friendly and keeps real, selectable text', () => {
  const a = analyzeDeck();
  const out = engine.apply(deck, resolveActions(a, DEFAULT_TOGGLES).actions);
  const p1 = renderPage(engine, out, 0);
  assert.ok(isWhite(pixelAt(p1, 700, 390)), 'page background removed');
  assert.ok(isWhite(pixelAt(p1, 160, 160)), 'photo removed');
  assert.ok(!isWhite(pixelAt(p1, 425, 100)), 'chart bar kept');
  const p2 = renderPage(engine, out, 1);
  assert.ok(isWhite(pixelAt(p2, 580, 780)), 'banner removed');
  assert.ok(isWhite(pixelAt(p2, 300, 320)), 'callout box inside the form removed');
  assert.ok(!isWhite(pixelAt(p2, 200, 600)), 'table rule kept');

  const b = classify(engine.analyze(out));
  const title = byText(b, 'Quarterly Review');
  assert.ok(title, 'title is still a text object');
  assert.deepEqual([title.fill.r, title.fill.g, title.fill.b], [0, 0, 0]);
  assert.deepEqual(Object.values(byText(b, '42').fill).slice(0, 3), [255, 255, 255]);
  const axis = find(b, (o) => o.page === 0 && o.type === 'path' && !o.fill);
  assert.deepEqual([axis.stroke.r, axis.stroke.g, axis.stroke.b], [0, 0, 0], 'chart axis is black');
  assert.ok(byText(b, 'Note: figures are unaudited.'), 'nested text survives');
  assert.equal(b.pages[0].objects.filter((o) => o.type === 'image').length, 0);
});

test('empty edits return an equivalent document', () => {
  const out = engine.apply(deck, {});
  const a = engine.analyze(deck);
  const b = engine.analyze(out);
  assert.deepEqual(b.pages.map((p) => p.objects.length), a.pages.map((p) => p.objects.length));
});

test('area selection picks objects fully inside the rectangle, with or without text', () => {
  const a = analyzeDeck();
  const p1 = a.pages[0];
  // The chart area: bars, their labels and the axis line, but not the page background or the photo.
  const chart = [370, 50, 700, 260];
  const hits = objectsInRect(p1, chart);
  assert.ok(hits.includes(byText(a, '42')), 'bar label is inside');
  assert.ok(hits.includes(p1.byId.get(byText(a, '42').under[0])), 'bar is inside');
  assert.ok(!hits.includes(p1.objects[0]), 'page background only partly inside');
  assert.ok(!hits.some((o) => o.type === 'image'), 'photo is outside');
  assert.ok(hits.every((o, i) => i === 0 || hits[i - 1].order > o.order), 'topmost first');

  const noText = objectsInRect(p1, chart, { includeText: false });
  assert.ok(noText.length > 0 && noText.every((o) => o.type !== 'text'));
  assert.equal(noText.length, hits.filter((o) => o.type !== 'text').length);

  // Corner order does not matter; groups are never returned.
  assert.deepEqual(objectsInRect(p1, [700, 260, 370, 50]), hits);
  assert.ok(!objectsInRect(a.pages[1], [0, 0, 720, 1000]).some((o) => o.type === 'form'));
});

test('scanned pages are detected and their image is never auto-removed', () => {
  const a = classify(engine.analyze(scan));
  assert.equal(a.pages[0].scan, true);
  const img = find(a, (o) => o.type === 'image');
  assert.equal(img.role, 'scan');
  const { actions } = resolveActions(a, DEFAULT_TOGGLES);
  assert.equal(actions[img.id], undefined);
});

test('page ranges parse single pages, ranges and open ends', () => {
  const p = (t, n = 20) => parsePageRanges(t, n);
  assert.deepEqual(p('3').pages, [2]);
  assert.deepEqual(p('1-3, 7').pages, [0, 1, 2, 6]);
  assert.deepEqual(p('18-').pages, [17, 18, 19], 'runs to the last page');
  assert.deepEqual(p('-2').pages, [0, 1], 'starts at the first page');
  assert.deepEqual(p('5-3').pages, [2, 3, 4], 'reversed range');
  assert.deepEqual(p(' 2 – 4 ; 3 9  ').pages, [1, 2, 3, 8], 'en dash, spaces, semicolons, duplicates');
  assert.deepEqual(p('1 - 2').pages, [0, 1], 'spaces around the dash');
  assert.match(p('').error, /Type page numbers/);
  assert.match(p('21').error, /Page 21 does not exist \(this PDF has 20 pages\)/);
  assert.match(p('2-30').error, /Page 30 does not exist/);
  assert.match(p('0').error, /start at 1/);
  assert.match(p('abc').error, /not a page or a range/);
  assert.match(p('1-2-3').error, /not a page or a range/);
  assert.match(p('-').error, /not a page or a range/);
  assert.match(p('2', 1).error, /this PDF has 1 page\)/);
});

test('removed pages combine and map to positions in the download', () => {
  assert.equal(formatPageRanges([0, 1, 2, 6, 9, 10]), '1–3, 7, 10–11');
  assert.equal(formatPageRanges([]), '');
  assert.deepEqual(pageRuns([9, 0, 2, 1, 6, 10, 2]), [[0, 2], [6, 6], [9, 10]]);
  assert.deepEqual([...restorePages(new Set([1, 2, 3, 7]), [2, 3, 9])].sort(), [1, 7], 'restores part of a range');
  let removed = removePages(new Set(), [1, 2]);
  removed = removePages(removed, [2, 5]);
  assert.deepEqual([...removed].sort(), [1, 2, 5]);
  // Keep only pages 1-4: everything outside goes, and page 2/3 stay removed.
  const kept = keepOnlyPages(removed, [0, 1, 2, 3], 8);
  assert.deepEqual([...kept].sort(), [1, 2, 4, 5, 6, 7]);
  assert.equal(outputIndex(0, kept), 0);
  assert.equal(outputIndex(3, kept), 1);
  assert.equal(outputIndex(4, kept), -1);
});

test('apply leaves removed pages out and keeps edits on the others', () => {
  const a = analyzeDeck();
  const { actions } = resolveActions(a, DEFAULT_TOGGLES);
  const out = engine.apply(deck, actions, [0]);
  const b = classify(engine.analyze(out));
  assert.equal(b.pages.length, 1);
  assert.ok(byText(b, 'Body copy in black stays exactly as it is.'), 'page 2 is now page 1');
  assert.ok(!byText(b, 'Quarterly Review'), 'page 1 is gone');
  assert.ok(isWhite(pixelAt(renderPage(engine, out, 0), 580, 780)), 'page 2 edits still applied (banner removed)');

  const second = engine.apply(deck, {}, [1, 1, 99]);
  assert.equal(engine.analyze(second).pages.length, 1, 'duplicates and out-of-range indexes are ignored');
  assert.ok(byText(engine.analyze(second), 'Quarterly Review'));
  assert.throws(() => engine.apply(deck, {}, [0, 1]), /At least one page/);
});

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

test('sheet layout: 2 per sheet turns the sheet, 4 per sheet makes a 2 × 2 grid', () => {
  const two = sheetLayout(612, 792, 2, 18);
  assert.deepEqual([two.width, two.height, two.cols, two.rows], [792, 612, 2, 1], 'portrait pages side by side');
  const [left, right] = two.cells;
  near(left[0], 18, 'outer margin'); near(right[0] - left[2], 18, 'gap between pages'); near(two.width - right[2], 18, 'right margin');
  near(left[3], 612 - 18, 'top margin'); near(left[1], 18, 'bottom margin');

  const slides = sheetLayout(720, 405, 2, 0);
  assert.deepEqual([slides.width, slides.height, slides.cols, slides.rows], [405, 720, 1, 2], 'landscape pages stacked');
  assert.ok(slides.cells[0][1] > slides.cells[1][1], 'first page on top');

  const four = sheetLayout(612, 792, 4, 10);
  assert.deepEqual([four.width, four.height, four.cols, four.rows], [612, 792, 2, 2]);
  const [a, b, c] = four.cells;
  assert.ok(b[0] > a[0] && b[1] === a[1], 'second page right of the first');
  assert.ok(c[0] === a[0] && c[3] < a[1], 'third page below the first');

  assert.deepEqual(sheetLayout(612, 792, 1, 50).cells, [[50, 50, 562, 742]], 'one per sheet keeps the margin around the page');
  assert.deepEqual(sheetLayout(612, 792, 1, 0).cells, [[0, 0, 612, 792]], 'no margin fills the sheet');
  const huge = sheetLayout(612, 792, 4, 1000);
  assert.ok(huge.cells.every(([l, bt, r, t]) => r - l > 0 && t - bt > 0), 'a huge margin still leaves room for pages');
  assert.throws(() => sheetLayout(612, 792, 3), /Unsupported/);

  const sides = sheetLayout(612, 792, 1, { top: 10, right: 20, bottom: 30, left: 40 });
  assert.deepEqual(sides.cells, [[40, 30, 592, 782]], 'each side has its own margin');
  assert.deepEqual(sheetLayout(612, 792, 1, -20).cells, [[-20, -20, 632, 812]], 'negative margins reach past the edge');
  const gap = sheetLayout(612, 792, 2, { top: 0, right: 0, bottom: 0, left: 0, gap: 30 }).cells;
  near(gap[1][0] - gap[0][2], 30, 'gap between pages'); near(gap[0][0], 0, 'no outer margin');
  const overlap = sheetLayout(612, 792, 2, { gap: -20 }).cells;
  near(overlap[1][0] - overlap[0][2], -20, 'a negative gap overlaps the pages');
  const wild = sheetLayout(612, 792, 1, -5000).cells[0];
  near(wild[2] - wild[0], 612 * 2, 'negative margins at most double the page');
  assert.deepEqual(normalizeMargins(7), { top: 7, right: 7, bottom: 7, left: 7, gap: 7 });
  assert.ok(!shiftsPage({ gap: 9 }) && shiftsPage({ left: -1 }) && !shiftsPage(0), 'the gap alone does not move a lone page');

  const fit = fitInCell([0, 0, 400, 400], 200, 100);
  assert.deepEqual(fit, { scale: 2, x: 0, y: 100 }, 'fitted and centred');
  assert.equal(sheetCount(5, 2), 3);
  assert.equal(sheetCount(4, 4), 1);
});

const COLORS = [[220, 30, 30], [30, 160, 60], [40, 70, 220], [230, 160, 20], [140, 40, 170]];
function buildColorPages() {
  const b = new DocBuilder(engine);
  COLORS.forEach((c, i) => {
    const pg = b.page(612, 792);
    b.rect(pg, 0, 0, 612, 792, c);
    b.text(pg, `Page ${i + 1}`, 60, 700, 24, [0, 0, 0]);
    b.done(pg);
  });
  const bytes = b.save();
  b.close();
  return bytes;
}
const center = ([l, b, r, t]) => [(l + r) / 2, (b + t) / 2];

test('nUp puts 2 pages on each landscape sheet with the chosen margin, keeping real text', () => {
  const src = buildColorPages();
  const margin = 10 * MM;
  const out = engine.nUp(src, { perSheet: 2, margin });
  const a = engine.analyze(out);
  assert.equal(a.pages.length, 3, '5 pages -> 3 sheets');
  assert.deepEqual([Math.round(a.pages[0].width), Math.round(a.pages[0].height)], [792, 612]);
  const lay = sheetLayout(612, 792, 2, margin);
  for (let i = 0; i < COLORS.length; i++) {
    const img = renderPage(engine, out, Math.floor(i / 2));
    assert.deepEqual(pixelAt(img, ...center(lay.cells[i % 2])), COLORS[i], `page ${i + 1} on its sheet`);
  }
  const img = renderPage(engine, out, 0);
  assert.ok(isWhite(pixelAt(img, margin / 2, 306)), 'left margin is blank');
  assert.ok(isWhite(pixelAt(img, 396, 306)), 'gap between pages is blank');
  assert.ok(isWhite(pixelAt(renderPage(engine, out, 2), ...center(lay.cells[1]))), 'last sheet is half empty');
  const texts = a.pages.flatMap((p) => p.objects).filter((o) => o.type === 'text').map((o) => o.text.trim());
  assert.deepEqual(texts, ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5'], 'text stays real and in order');
});

test('nUp with 4 per sheet fills a 2 × 2 grid; 1 per sheet returns the PDF unchanged', () => {
  const src = buildColorPages();
  const out = engine.nUp(src, { perSheet: 4, margin: 0 });
  const a = engine.analyze(out);
  assert.equal(a.pages.length, 2);
  assert.deepEqual([Math.round(a.pages[0].width), Math.round(a.pages[0].height)], [612, 792]);
  const img = renderPage(engine, out, 0);
  const lay = sheetLayout(612, 792, 4, 0);
  lay.cells.forEach((cell, i) => assert.deepEqual(pixelAt(img, ...center(cell)), COLORS[i], `page ${i + 1}`));
  assert.equal(engine.nUp(src, { perSheet: 1 }), src);
  assert.equal(engine.nUp(src, { perSheet: 1, margin: 0 }), src);
});

test('nUp with 1 per sheet and a margin shrinks each page onto a sheet of its own size', () => {
  const b = new DocBuilder(engine);
  for (const [w, h, c] of [[612, 792, COLORS[0]], [792, 612, COLORS[1]]]) {
    const pg = b.page(w, h);
    b.rect(pg, 0, 0, w, h, c);
    b.done(pg);
  }
  const src = b.save();
  b.close();
  const margin = 10 * MM;
  const out = engine.nUp(src, { perSheet: 1, margin });
  const a = engine.analyze(out);
  assert.deepEqual(a.pages.map((p) => [Math.round(p.width), Math.round(p.height)]), [[612, 792], [792, 612]], 'each sheet keeps its page size');
  for (const i of [0, 1]) {
    const img = renderPage(engine, out, i);
    const [w, h] = [a.pages[i].width, a.pages[i].height];
    assert.deepEqual(pixelAt(img, w / 2, h / 2), COLORS[i], `page ${i + 1} is on its sheet`);
    assert.ok(isWhite(pixelAt(img, margin / 2, h / 2)), `page ${i + 1}: left margin is blank`);
    assert.ok(isWhite(pixelAt(img, w / 2, h - margin / 2)), `page ${i + 1}: top margin is blank`);
  }
});

test('nUp with 1 per sheet applies per-side and negative margins', () => {
  const b = new DocBuilder(engine);
  const pg = b.page(612, 792);
  b.rect(pg, 0, 0, 612, 792, COLORS[2]);
  b.done(pg);
  const src = b.save();
  b.close();

  // A deep top margin only: the page shrinks to fit below it and is centred across the sheet.
  const top = 60 * MM;
  const out = engine.nUp(src, { perSheet: 1, margin: { top } });
  const img = renderPage(engine, out, 0);
  assert.ok(isWhite(pixelAt(img, 306, 792 - top / 2)), 'top margin is blank');
  assert.deepEqual(pixelAt(img, 306, 3), COLORS[2], 'page reaches the bottom edge');
  assert.ok(isWhite(pixelAt(img, 3, 396)), 'narrower page leaves room at the sides');

  // Negative margins enlarge the page: its color reaches every edge and the sheet keeps its size.
  const big = engine.nUp(src, { perSheet: 1, margin: -10 * MM });
  const a = engine.analyze(big);
  assert.deepEqual([Math.round(a.pages[0].width), Math.round(a.pages[0].height)], [612, 792]);
  const bigImg = renderPage(engine, big, 0);
  for (const [x, y] of [[2, 2], [610, 2], [2, 790], [610, 790]]) {
    assert.deepEqual(pixelAt(bigImg, x, y), COLORS[2], `corner ${x},${y} is covered`);
  }
  assert.equal(engine.nUp(src, { perSheet: 1, margin: { gap: 20 } }), src, 'a gap alone changes nothing');
});

test('nUp turns rotated pages upright and combines with edits and removed pages', () => {
  const b = new DocBuilder(engine);
  const pg = b.page(200, 400);
  b.rect(pg, 0, 0, 50, 50, [255, 0, 0]); // bottom-left corner before rotation
  engine.m.FPDFPage_SetRotation(pg.handle, 1); // 90° clockwise: shows as 400 × 200
  b.done(pg);
  const rotated = b.save();
  b.close();
  const out = engine.nUp(rotated, { perSheet: 2, margin: 0 });
  const lay = sheetLayout(400, 200, 2, 0); // landscape page -> portrait sheet, stacked
  const { scale, x, y } = fitInCell(lay.cells[0], 400, 200);
  const img = renderPage(engine, out, 0);
  // After a clockwise turn the corner square sits at the top left of the page.
  assert.deepEqual(pixelAt(img, x + 10 * scale, y + 190 * scale), [255, 0, 0], 'rotation is applied');
  assert.ok(isWhite(pixelAt(img, x + 10 * scale, y + 10 * scale)));

  const edited = engine.apply(deck, resolveActions(analyzeDeck(), DEFAULT_TOGGLES).actions, [0]);
  const sheets = engine.analyze(engine.nUp(edited, { perSheet: 2, margin: 5 * MM }));
  assert.equal(sheets.pages.length, 1);
  assert.ok(sheets.pages[0].objects.some((o) => o.text === 'Body copy in black stays exactly as it is.'));
  assert.ok(!sheets.pages[0].objects.some((o) => o.text === 'Quarterly Review'));
});

test('fitInCell scales the fitted page about the centre of its cell', () => {
  const cell = [0, 0, 612, 792];
  assert.deepEqual(fitInCell(cell, 612, 792, 1), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(fitInCell(cell, 612, 792, 0.5), { scale: 0.5, x: 153, y: 198 }, 'shrinks, centred');
  assert.deepEqual(fitInCell(cell, 612, 792, 1.5), { scale: 1.5, x: -153, y: -198 }, 'grows past the cell');
  assert.throws(() => fitInCell(cell, 612, 792, 0), /Invalid scale/);
  assert.ok(altersPage(0, 0.9) && altersPage(5) && !altersPage(0) && !altersPage(0, 1));
});

test('nUp applies a custom scale to every page, alone or several per sheet', () => {
  const b = new DocBuilder(engine);
  const pg = b.page(612, 792);
  b.rect(pg, 0, 0, 612, 792, COLORS[3]);
  b.done(pg);
  const src = b.save();
  b.close();

  // 50% with no margin: the page fills the middle half of the sheet, centred.
  const half = renderPage(engine, engine.nUp(src, { perSheet: 1, margin: 0, scale: 0.5 }), 0);
  assert.deepEqual(pixelAt(half, 306, 396), COLORS[3], 'centre is covered');
  assert.ok(isWhite(pixelAt(half, 140, 396)), 'left quarter is blank');
  assert.ok(isWhite(pixelAt(half, 306, 180)), 'bottom quarter is blank');
  assert.deepEqual(pixelAt(half, 160, 210), COLORS[3], 'just inside the scaled page');

  // 120% inside a 10 mm margin: the page grows past the margin to the sheet's edge.
  const big = renderPage(engine, engine.nUp(src, { perSheet: 1, margin: 10 * MM, scale: 1.2 }), 0);
  for (const [x, y] of [[2, 2], [610, 790]]) assert.deepEqual(pixelAt(big, x, y), COLORS[3], `corner ${x},${y} is covered`);

  // With several per sheet the scale applies inside each cell.
  const colors = buildColorPages();
  const lay = sheetLayout(612, 792, 4, 0);
  const four = renderPage(engine, engine.nUp(colors, { perSheet: 4, margin: 0, scale: 0.5 }), 0);
  lay.cells.forEach((cell, i) => {
    assert.deepEqual(pixelAt(four, ...center(cell)), COLORS[i], `page ${i + 1} at its cell's centre`);
    assert.ok(isWhite(pixelAt(four, cell[0] + 10, cell[1] + 10)), `page ${i + 1}: cell corner is blank`);
  });
  assert.equal(engine.nUp(src, { perSheet: 1, margin: 0, scale: 1 }), src, 'scale 1 with no margin changes nothing');
});

test('split runs and file names cover every page in order', () => {
  assert.deepEqual(splitRuns(25, 10), [[0, 9], [10, 19], [20, 24]]);
  assert.deepEqual(splitRuns(20, 10), [[0, 9], [10, 19]]);
  assert.deepEqual(splitRuns(3, 10), [[0, 2]]);
  assert.deepEqual(splitRuns(3, 1), [[0, 0], [1, 1], [2, 2]]);
  const names = splitFileNames('Deck', splitRuns(21, 2));
  assert.equal(names.length, 11);
  assert.equal(names[0], 'Deck - part 01 of 11 (pages 1-2).pdf');
  assert.equal(names[10], 'Deck - part 11 of 11 (page 21).pdf');
  assert.deepEqual([...names].sort(), names, 'padded numbers sort in order');
});

test('split cuts a PDF into pieces of N pages each, keeping their content', () => {
  const b = new DocBuilder(engine);
  const labels = ['one', 'two', 'three', 'four', 'five'];
  for (const t of labels) {
    const pg = b.page(300, 400);
    b.text(pg, t, 20, 200, 18, [0, 0, 0]);
    b.done(pg);
  }
  const src = b.save();
  const parts = engine.split(src, 2);
  assert.equal(parts.length, 3);
  const texts = parts.map((p) => engine.analyze(p).pages.map((pg) => pg.objects.find((o) => o.type === 'text').text));
  assert.deepEqual(texts, [['one', 'two'], ['three', 'four'], ['five']]);
  assert.equal(engine.analyze(parts[0]).pages[0].width, 300);
  assert.equal(engine.split(src, 5).length, 1);
  assert.equal(engine.split(src, 99).length, 1);
  assert.throws(() => engine.split(src, 0), /at least 1/);
  assert.throws(() => engine.split(src, 1.5), /whole number/);
});

test('makeZip writes a valid archive that unzip can read back', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const data = new Uint8Array(70000).map((_, i) => (i * 31) & 0xff);
  assert.equal(crc32(data), zlibCrc32(data));
  const files = [
    { name: 'a - part 1 (pages 1-2).pdf', data: new TextEncoder().encode('%PDF-first') },
    { name: 'Résumé – part 2.pdf', data },
    { name: 'empty.pdf', data: new Uint8Array(0) },
  ];
  const zip = makeZip(files, new Date(2026, 10, 19, 12, 30, 10));
  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  try {
    writeFileSync(join(dir, 'out.zip'), zip);
    execFileSync('unzip', ['-tq', 'out.zip'], { cwd: dir });
    execFileSync('unzip', ['-q', 'out.zip', '-d', 'x'], { cwd: dir, env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    assert.deepEqual(readdirSync(join(dir, 'x')).sort(), files.map((f) => f.name).sort());
    for (const f of files) assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'x', f.name))), f.data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid input fails with a readable error', () => {
  assert.throws(() => engine.analyze(new TextEncoder().encode('not a pdf')), /Could not open PDF/);
});

test('merge joins PDFs in the given order, keeping each page size and content', () => {
  const make = (labels, w, h) => {
    const b = new DocBuilder(engine);
    for (const t of labels) {
      const pg = b.page(w, h);
      b.text(pg, t, 20, 100, 18, [0, 0, 0]);
      b.done(pg);
    }
    return b.save();
  };
  const a = make(['a1', 'a2'], 300, 400);
  const b = make(['b1'], 500, 200);
  const merged = engine.merge([b, a, b]);
  assert.deepEqual(merged.pageCounts, [1, 2, 1]);
  const out = engine.analyze(merged.bytes);
  assert.deepEqual(out.pages.map((pg) => pg.objects.find((o) => o.type === 'text').text), ['b1', 'a1', 'a2', 'b1']);
  assert.deepEqual(out.pages.map((pg) => [pg.width, pg.height]), [[500, 200], [300, 400], [300, 400], [500, 200]]);
  assert.equal(engine.analyze(engine.merge([a]).bytes).pages.length, 2);
  // Object ids shift by the pages in front, so choices made on one file still find their objects.
  const ids = (pg) => pg.objects.map((o) => o.id.split(':')[1]);
  const deckPages = engine.analyze(deck).pages;
  const withDeck = engine.analyze(engine.merge([b, deck]).bytes).pages;
  assert.deepEqual(withDeck.slice(1).map(ids), deckPages.map(ids));
  assert.throws(() => engine.merge([]), /No PDFs/);
  assert.throws(() => engine.merge([a, new Uint8Array([1, 2, 3])]), /File 2: Could not open PDF/);
});
