// Builds the sample documents used by the tests and for manual testing in the UI.
import { DocBuilder } from './pdfium-node.js';

const NAVY = [20, 30, 60];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const TEAL = [0, 110, 120];
const ORANGE = [230, 120, 30];

const photo = (i, j) => [80 + ((i * 3) % 120), 120 + ((j * 2) % 100), 160 + ((i + j) % 80)];

/**
 * Slide-style deck, like a PowerPoint export:
 *  p1: full-page dark background, white title + body, a photo, a chart with white bar labels
 *  p2: white page, dark heading banner with white text, black body text, small logo image,
 *      a table drawn with thin stroked lines, and a dark callout box placed inside a form XObject
 */
export function buildDeck(engine) {
  const b = new DocBuilder(engine);

  const p1 = b.page(720, 405);
  b.rect(p1, 0, 0, 720, 405, NAVY);
  b.text(p1, 'Quarterly Review', 40, 340, 32, WHITE, { bold: true });
  b.text(p1, 'Revenue grew in every region this quarter.', 40, 300, 16, WHITE);
  b.image(p1, 40, 60, 240, 200, 96, 80, photo);
  // Chart: bars with white value labels on them, plus a black axis label.
  b.line(p1, 380, 60, 680, 60, WHITE);
  [[400, 120, TEAL, '42'], [480, 180, ORANGE, '61'], [560, 150, TEAL, '55']].forEach(([x, h, c, label]) => {
    b.rect(p1, x, 60, 50, h, c);
    b.text(p1, label, x + 16, 60 + h - 20, 12, WHITE);
  });
  b.text(p1, 'Units', 620, 40, 10, WHITE);
  b.done(p1);

  // Source page for the form XObject: a dark callout box with white text.
  const src = new DocBuilder(engine);
  const sp = src.page(300, 100);
  src.rect(sp, 0, 0, 300, 100, [60, 20, 70]);
  src.text(sp, 'Note: figures are unaudited.', 20, 45, 14, WHITE);
  src.done(sp);

  const p2 = b.page(612, 792);
  b.rect(p2, 0, 700, 612, 92, NAVY);
  b.text(p2, 'Section 2: Details', 40, 735, 28, WHITE, { bold: true });
  b.text(p2, 'Body copy in black stays exactly as it is.', 40, 660, 12, BLACK);
  b.image(p2, 520, 640, 50, 50, 20, 20, () => ORANGE);
  for (let i = 0; i <= 3; i++) b.line(p2, 40, 600 - i * 30, 400, 600 - i * 30, BLACK);
  b.text(p2, 'Region    Units    Change', 45, 580, 11, BLACK);
  b.form(p2, src, 0, 1, 40, 300);
  b.text(p2, 'Hidden white text on white', 40, 200, 10, WHITE);
  b.done(p2);

  src.close();
  const bytes = b.save();
  b.close();
  return bytes;
}

/** A scan: one page-sized image (grey paper, dark "words") plus an invisible OCR text layer. */
export function buildScan(engine) {
  const b = new DocBuilder(engine);
  const p = b.page(612, 792);
  b.image(p, 0, 0, 612, 792, 306, 396, (i, j) => (j % 20 < 3 && i > 30 && i < 270 && j > 40 && j < 350 ? [40, 40, 40] : [225, 220, 205]));
  b.text(p, 'Invisible OCR layer text', 60, 700, 12, BLACK, { mode: 3 });
  b.done(p);
  const bytes = b.save();
  b.close();
  return bytes;
}
