// One PDF that shows every cleanup in the before/after view.
// Positions are load-bearing for the classifier:
// a value must sit inside its bar, or the bar is not a "possible" background
// and the number turns black; instructional text must stay clear of swatches
// and photos, or that shape becomes the text's backdrop and the type stays white.
import { DocBuilder } from './pdfium-node.js';

const NAVY = [16, 28, 58];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const TEAL = [0, 118, 128];
const GOLD = [166, 118, 32];
const ORANGE = [214, 112, 28];
const CORAL = [186, 64, 58];
const GREEN = [28, 122, 78];
const PLUM = [72, 32, 96];
const SLATE = [24, 68, 84];
const PALE = [158, 162, 168];

const SLIDE_W = 720;
const SLIDE_H = 405;
const LETTER_W = 612;
const LETTER_H = 792;

export function buildShowcase(engine) {
  const b = new DocBuilder(engine);
  slide(b);
  chart(b);
  report(b, engine);
  pictures(b);
  playground(b);
  scan(b);
  const bytes = b.save();
  b.close();
  return bytes;
}

function slide(b) {
  const p = b.page(SLIDE_W, SLIDE_H);
  b.rect(p, 0, 0, SLIDE_W, SLIDE_H, NAVY);
  b.rect(p, 0, 0, 10, SLIDE_H, TEAL);
  b.text(p, 'FEATURE TOUR', 44, 352, 10, GOLD, { bold: true });
  b.text(p, 'Before and after', 44, 308, 30, WHITE, { bold: true });
  b.line(p, 44, 292, 300, 292, WHITE, 1.5);
  b.text(p, 'Dark backgrounds come off.', 44, 262, 13, WHITE);
  b.text(p, 'Pictures come off.', 44, 240, 13, WHITE);
  b.text(p, 'Light type on them turns black.', 44, 218, 13, WHITE);
  b.text(p, 'The teal strip is kept.', 44, 196, 13, WHITE);
  b.image(p, 468, 112, 212, 188, 212, 188, daylight(212, 188));
  b.text(p, 'Picture, removed', 468, 90, 10, WHITE);
  b.image(p, 44, 48, 36, 36, 72, 72, logo(72, 72));
  b.text(p, 'Logo, removed', 92, 60, 10, WHITE);
  b.text(p, '1 / 6  -  landscape slide', 468, 28, 9, WHITE);
  b.done(p);
}

function chart(b) {
  const p = b.page(SLIDE_W, SLIDE_H);
  b.rect(p, 0, 0, SLIDE_W, SLIDE_H, NAVY);
  b.text(p, 'Bars stay. The axis becomes black.', 40, 368, 22, WHITE, { bold: true });
  b.text(p, 'Labels on a bar stay white.', 40, 340, 12, WHITE);
  b.text(p, 'The pale axis and grid become black.', 40, 322, 12, WHITE);
  b.image(p, 508, 324, 176, 64, 176, 64, daylight(176, 64));
  b.text(p, 'Picture, removed', 508, 306, 9, WHITE);

  const legend = [
    ['North', TEAL],
    ['West', ORANGE],
    ['South', GREEN],
    ['East', CORAL],
  ];
  legend.forEach(([name, color], i) => {
    const x = 40 + i * 112;
    b.rect(p, x, 274, 14, 10, color);
    b.text(p, name, x + 20, 274, 10, WHITE);
  });

  const base = 64;
  b.line(p, 56, base, 660, base, WHITE, 1.5);
  b.line(p, 56, base, 56, 250, WHITE, 1.5);
  for (const y of [112, 160, 208]) b.line(p, 56, y, 660, y, WHITE, 0.8);

  const bars = [
    ['North', '42', 90, TEAL],
    ['West', '61', 156, ORANGE],
    ['South', '55', 124, GREEN],
    ['East', '73', 186, CORAL],
  ];
  bars.forEach(([name, value, h, color], i) => {
    const x = 96 + i * 146;
    b.rect(p, x, base, 72, h, color);
    b.text(p, value, x + 24, base + h - 22, 12, WHITE, { bold: true });
    b.text(p, name, x + 16, 42, 11, WHITE);
  });
  b.text(p, 'Units', 624, 78, 10, WHITE);
  b.text(p, '2 / 6  -  chart slide', 40, 18, 9, WHITE);
  b.done(p);
}

function report(b, engine) {
  const src = new DocBuilder(engine);
  const sp = src.page(500, 58);
  src.rect(sp, 0, 0, 500, 58, PLUM);
  src.text(sp, 'This box is inside a group, and it is removed.', 18, 22, 13, WHITE);
  src.done(sp);

  const p = b.page(LETTER_W, LETTER_H);
  b.rect(p, 0, 708, LETTER_W, 84, NAVY);
  b.text(p, 'Report page', 40, 748, 26, WHITE, { bold: true });
  b.text(p, 'This banner is removed and the type turns black.', 40, 720, 12, WHITE);
  b.line(p, 40, 694, 572, 694, BLACK, 1);

  b.text(p, 'Black text on white paper stays as it is.', 40, 658, 12, BLACK);
  b.text(p, 'This teal line already prints, so it stays teal.', 40, 636, 12, TEAL);
  b.text(p, 'This pale gray line sits on white, so it stays.', 40, 614, 12, PALE);
  b.image(p, 520, 600, 52, 52, 72, 72, logo(72, 72));
  b.text(p, 'Logo', 528, 582, 10, BLACK);

  const rows = [
    ['Region', 'Q1', 'Q2', 'Q3'],
    ['North', '42', '48', '51'],
    ['West', '61', '66', '70'],
    ['South', '55', '53', '58'],
    ['East', '73', '77', '81'],
  ];
  const cols = [48, 200, 300, 400];
  for (let i = 0; i <= rows.length; i++) b.line(p, 40, 560 - i * 26, 480, 560 - i * 26, BLACK, 0.8);
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      b.text(p, cell, cols[c], 540 - r * 26, 11, BLACK, { bold: r === 0 });
    });
  });

  b.form(p, src, 0, 1, 40, 360);
  src.close();

  b.rect(p, 40, 220, 210, 96, SLATE);
  b.text(p, 'Possible background', 54, 278, 12, WHITE);
  b.text(p, 'Stays until you choose', 54, 256, 12, WHITE);
  b.text(p, 'A narrow box is only possible,', 276, 278, 12, BLACK);
  b.text(p, 'so the switch leaves it alone.', 276, 256, 12, BLACK);

  b.text(p, 'Hidden white text on white', 40, 140, 10, WHITE);
  b.text(p, '3 / 6  -  letter', 40, 40, 9, BLACK);
  b.done(p);
}

function pictures(b) {
  const p = b.page(LETTER_W, LETTER_H);
  // Taller than half the page, so this photo is a background rather than a picture.
  b.image(p, 0, 340, LETTER_W, 452, 612, 452, dusk(612, 452));
  b.text(p, 'Pictures, two ways', 36, 730, 22, WHITE, { bold: true });
  b.text(p, 'A photo this large is a background.', 36, 692, 13, WHITE);
  b.text(p, 'The small one is just a picture.', 36, 670, 13, WHITE);
  b.text(p, 'Toggle each switch to see the difference.', 36, 648, 13, WHITE);

  b.rect(p, 32, 64, 268, 250, NAVY);
  b.image(p, 32, 64, 268, 250, 67, 62, frost, { alpha: true });
  b.text(p, 'Texture over a dark panel.', 48, 250, 12, WHITE);
  b.text(p, 'Both layers are removed.', 48, 228, 12, WHITE);
  b.text(p, 'This type turns black.', 48, 206, 12, WHITE);
  b.text(p, 'Click again for what is under it.', 48, 184, 12, WHITE);

  b.image(p, 340, 130, 232, 156, 232, 156, daylight(232, 156));
  b.text(p, 'This caption stays.', 340, 108, 11, BLACK);
  b.text(p, 'The photo does not.', 340, 92, 11, BLACK);
  b.text(p, '4 / 6  -  letter', 32, 28, 9, BLACK);
  b.done(p);
}

function playground(b) {
  const p = b.page(LETTER_W, LETTER_H);
  b.rect(p, 0, 0, LETTER_W, LETTER_H, NAVY);

  b.text(p, 'Drop this page', 40, 736, 26, WHITE, { bold: true });
  const lines = [
    [700, 'Press X to leave it out of the download.'],
    [676, 'Or type 5, then Remove these.'],
    [652, 'The thumbnail is struck through.'],
    [628, 'After shows the page left out.'],
    [604, 'Restore brings it back.'],
  ];
  for (const [y, s] of lines) b.text(p, s, 40, y, 13, WHITE);

  b.text(p, 'Try the Area tool', 40, 552, 16, WHITE, { bold: true });
  const area = [
    [522, 'Drag around the swatches.'],
    [500, 'Shift-drag adds a rectangle.'],
    [478, 'Untick Include text to skip type.'],
    [456, 'Remove, Fill white, or Make black.'],
  ];
  for (const [y, s] of area) b.text(p, s, 40, y, 12, WHITE);

  const swatches = [
    [20, 90, 140], [0, 120, 110], [180, 90, 30], [140, 40, 50],
    [90, 50, 140], [40, 110, 50], [150, 120, 30], [70, 80, 90],
    [170, 60, 90], [40, 70, 120], [120, 80, 40], [50, 120, 130],
  ];
  const ox = 392;
  const oy = 448;
  swatches.forEach((color, i) => {
    const c = i % 4;
    const r = Math.floor(i / 4);
    b.rect(p, ox + c * 48, oy + (2 - r) * 48, 36, 36, color);
  });
  const x1 = ox - 10;
  const y1 = oy - 10;
  const x2 = ox + 4 * 48 - 12 + 10;
  const y2 = oy + 3 * 48 - 12 + 10;
  b.line(p, x1, y1, x2, y1, WHITE, 1.25);
  b.line(p, x2, y1, x2, y2, WHITE, 1.25);
  b.line(p, x2, y2, x1, y2, WHITE, 1.25);
  b.line(p, x1, y2, x1, y1, WHITE, 1.25);

  b.text(p, 'Print layout, split, combine', 40, 360, 16, WHITE, { bold: true });
  const rest = [
    [330, '2 or 4 pages per sheet follow the first page kept.'],
    [308, 'Margins and scale apply to every page.'],
    [286, 'Split saves a ZIP of smaller PDFs.'],
    [264, 'To combine, drop this file with the other samples.'],
  ];
  for (const [y, s] of rest) b.text(p, s, 40, y, 12, WHITE);
  b.text(p, '5 / 6  -  letter  -  a good page to remove', 40, 40, 9, WHITE);
  b.done(p);
}

function scan(b) {
  const pw = 612;
  const ph = 792;
  const mask = new Set();
  // Bitmap row 0 is the top of the image, so these y values sit near the top of the page.
  stamp(mask, 'SCANNED PAGE', 78, 86, 4);
  stamp(mask, 'LEFT AS-IS', 108, 150, 3);
  stamp(mask, 'THE WORDS ARE THE PICTURE', 48, 210, 2);
  const p = b.page(LETTER_W, LETTER_H);
  b.image(p, 0, 0, LETTER_W, LETTER_H, pw, ph, (i, j) => scanPixel(i, j, pw, ph, mask));
  b.text(p, 'Scanned page. The words are part of the picture, so it is left alone.', 48, 740, 11, BLACK, { mode: 3 });
  b.done(p);
}

function scanPixel(i, j, pw, ph, mask) {
  const n = ((i * 13 + j * 7) % 17) - 8;
  let r = 232 + n;
  let g = 226 + n;
  let b = 210 + n;
  // Paragraph stripes, like lines of type on a photographed page.
  const band = j > 280 && j < 680 && (j % 22) < 3 && i > 48 && i < 520;
  const shorter = band && (Math.floor(j / 22) % 5 === 4) && i > 360;
  if (band && !shorter) { r = 55; g = 52; b = 48; }
  // A photographed figure, still part of the same image.
  if (i > 70 && i < 280 && j > 470 && j < 640) {
    const t = (j - 470) / 170;
    r = 70 + t * 50 + (i % 9);
    g = 110 + t * 20;
    b = 150 - t * 30;
  }
  if (mask.has(`${i},${j}`)) { r = 28; g = 26; b = 24; }
  return [clamp(r), clamp(g), clamp(b)];
}

const GLYPH = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01111, 0b10000, 0b10000, 0b10011, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
};

function stamp(mask, text, x, y, scale) {
  for (const ch of text) {
    const glyph = GLYPH[ch] || GLYPH[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if ((glyph[row] & (1 << (4 - col))) === 0) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) mask.add(`${x + col * scale + dx},${y + row * scale + dy}`);
        }
      }
    }
    x += 6 * scale;
  }
}

function daylight(pw, ph) {
  return (i, j) => {
    const x = i / pw;
    const y = j / ph;
    if ((x - 0.78) ** 2 + (y - 0.2) ** 2 < 0.01) return [255, 206, 80];
    if (y < 0.42) {
      const t = y / 0.42;
      return [90 + t * 50, 160 + t * 30, 214 - t * 20];
    }
    if (y < 0.48) return [230, 210, 140];
    const ground = (y - 0.48) / 0.52;
    const hill = Math.sin((i / pw) * Math.PI * 3) * 0.06;
    if (ground + hill < 0.32) return [64, 138, 74];
    return [86, 118, 62];
  };
}

function dusk(pw, ph) {
  return (i, j) => duskAt(i, j, pw, ph);
}

function duskAt(i, j, pw, ph) {
  const x = i / pw;
  const y = j / ph;
  const sky = 16 + y * 28;
  let r = sky;
  let g = sky + 10;
  let b = sky + 36;
  const moon = (x - 0.8) ** 2 + (y - 0.16) ** 2;
  if (moon < 0.006) { r = 236; g = 230; b = 206; }
  // A short skyline along the bottom, kept clear of the white type in the sky.
  const blocks = [
    [0.0, 0.16, 0.78],
    [0.16, 0.1, 0.68],
    [0.26, 0.18, 0.86],
    [0.44, 0.12, 0.74],
    [0.56, 0.14, 0.82],
    [0.7, 0.12, 0.7],
    [0.82, 0.18, 0.8],
  ];
  for (const [bx, bw, top] of blocks) {
    if (x < bx || x > bx + bw || y < top) continue;
    r = 12; g = 16; b = 30;
    const col = (x - bx) / 0.028;
    const row = (y - top) / 0.04;
    const fx = col % 1;
    const fy = row % 1;
    if (fx > 0.28 && fx < 0.52 && fy > 0.22 && fy < 0.58 && (Math.floor(col) + Math.floor(row)) % 3 !== 0) {
      r = 224; g = 186; b = 110;
    }
    break;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function frost(i, j) {
  const n = (i * 17 + j * 29) % 48;
  return [200 + (n % 20), 206 + (n % 16), 214, 78];
}

function logo(pw, ph) {
  return (i, j) => {
    const cx = (i + 0.5) / pw - 0.5;
    const cy = (j + 0.5) / ph - 0.5;
    const d = Math.hypot(cx, cy);
    if (d < 0.18) return [255, 255, 255];
    if (d < 0.34) return [214, 112, 28];
    return [255, 248, 240];
  };
}

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}
