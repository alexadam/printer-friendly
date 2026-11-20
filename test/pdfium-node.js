// Shared Node helpers: load PDFium, build fixture PDFs, render pages to PNG.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { PdfEngine } from '../src/engine.js';

const require = createRequire(import.meta.url);

export async function loadEngine() {
  const wasm = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  return PdfEngine.create(init, wasm);
}

/** Small builder over raw PDFium calls for creating test documents. */
export class DocBuilder {
  constructor(engine) {
    this.m = engine.m;
    this.p = engine.p;
    this.doc = this.m.FPDF_CreateNewDocument();
    this.font = this.m.FPDFText_LoadStandardFont(this.doc, 'Helvetica');
    this.bold = this.m.FPDFText_LoadStandardFont(this.doc, 'Helvetica-Bold');
  }

  page(w = 612, h = 792) {
    const index = this.m.FPDF_GetPageCount(this.doc);
    return { handle: this.m.FPDFPage_New(this.doc, index, w, h), index, w, h };
  }

  rect(pg, x, y, w, h, [r, g, b], { stroke = null } = {}) {
    const o = this.m.FPDFPageObj_CreateNewRect(x, y, w, h);
    this.m.FPDFPageObj_SetFillColor(o, r, g, b, 255);
    if (stroke) {
      this.m.FPDFPageObj_SetStrokeColor(o, ...stroke, 255);
      this.m.FPDFPageObj_SetStrokeWidth(o, 1);
    }
    this.m.FPDFPath_SetDrawMode(o, 1, !!stroke);
    this.m.FPDFPage_InsertObject(pg.handle, o);
    return o;
  }

  line(pg, x1, y1, x2, y2, [r, g, b], width = 1) {
    const o = this.m.FPDFPageObj_CreateNewPath(x1, y1);
    this.m.FPDFPath_LineTo(o, x2, y2);
    this.m.FPDFPageObj_SetStrokeColor(o, r, g, b, 255);
    this.m.FPDFPageObj_SetStrokeWidth(o, width);
    this.m.FPDFPath_SetDrawMode(o, 0, true);
    this.m.FPDFPage_InsertObject(pg.handle, o);
  }

  text(pg, str, x, y, size, [r, g, b], { bold = false, mode = 0 } = {}) {
    const o = this.m.FPDFPageObj_CreateTextObj(this.doc, bold ? this.bold : this.font, size);
    const bytes = (str.length + 1) * 2;
    const ptr = this.p.wasmExports.malloc(bytes);
    this.p.stringToUTF16(str, ptr, bytes);
    this.m.FPDFText_SetText(o, ptr);
    this.p.wasmExports.free(ptr);
    this.m.FPDFPageObj_SetFillColor(o, r, g, b, 255);
    if (mode) this.m.FPDFTextObj_SetTextRenderMode(o, mode);
    this.m.FPDFPageObj_Transform(o, 1, 0, 0, 1, x, y);
    this.m.FPDFPage_InsertObject(pg.handle, o);
    return o;
  }

  /**
   * Raster image filled by pixel(x, y) -> [r, g, b] or [r, g, b, a].
   * Pass `{ alpha: true }` to keep that alpha channel (translucent textures).
   */
  image(pg, x, y, w, h, pw, ph, pixel, { alpha = false } = {}) {
    const bmp = this.m.FPDFBitmap_Create(pw, ph, alpha ? 1 : 0);
    const buf = this.m.FPDFBitmap_GetBuffer(bmp);
    const stride = this.m.FPDFBitmap_GetStride(bmp);
    for (let j = 0; j < ph; j++) {
      for (let i = 0; i < pw; i++) {
        const [r, g, b, a = 255] = pixel(i, j);
        const k = buf + j * stride + i * 4;
        this.p.HEAPU8[k] = b; this.p.HEAPU8[k + 1] = g; this.p.HEAPU8[k + 2] = r; this.p.HEAPU8[k + 3] = a;
      }
    }
    const o = this.m.FPDFPageObj_NewImageObj(this.doc);
    this.m.FPDFImageObj_SetBitmap(0, 0, o, bmp);
    this.m.FPDFBitmap_Destroy(bmp);
    this.m.FPDFImageObj_SetMatrix(o, w, 0, 0, h, x, y);
    this.m.FPDFPage_InsertObject(pg.handle, o);
    return o;
  }

  /** Embed page `srcIndex` of `srcDoc` as a form XObject, scaled and placed at (x, y). */
  form(pg, srcBuilder, srcIndex, scale, x, y) {
    const xobj = this.m.FPDF_NewXObjectFromPage(this.doc, srcBuilder.doc, srcIndex);
    const o = this.m.FPDF_NewFormObjectFromXObject(xobj);
    this.m.FPDFPageObj_Transform(o, scale, 0, 0, scale, x, y);
    this.m.FPDFPage_InsertObject(pg.handle, o);
    this.m.FPDF_CloseXObject(xobj);
  }

  done(pg) {
    this.m.FPDFPage_GenerateContent(pg.handle);
    this.m.FPDF_ClosePage(pg.handle);
  }

  save() {
    const w = this.m.PDFiumExt_OpenFileWriter();
    this.m.PDFiumExt_SaveAsCopy(this.doc, w);
    const size = this.m.PDFiumExt_GetFileWriterSize(w);
    const ptr = this.p.wasmExports.malloc(size);
    this.m.PDFiumExt_GetFileWriterData(w, ptr, size);
    const out = this.p.HEAPU8.slice(ptr, ptr + size);
    this.p.wasmExports.free(ptr);
    this.m.PDFiumExt_CloseFileWriter(w);
    return out;
  }

  close() { this.m.FPDF_CloseDocument(this.doc); }
}

/** Render one page with PDFium and return { width, height, rgba }. */
export function renderPage(engine, bytes, pageIndex, scale = 1) {
  const { m, p } = engine;
  const ptr = p.wasmExports.malloc(bytes.length);
  p.HEAPU8.set(bytes, ptr);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
  const page = m.FPDF_LoadPage(doc, pageIndex);
  const w = Math.round(m.FPDF_GetPageWidthF(page) * scale);
  const h = Math.round(m.FPDF_GetPageHeightF(page) * scale);
  const bmp = m.FPDFBitmap_Create(w, h, 0);
  m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
  m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0);
  const buf = m.FPDFBitmap_GetBuffer(bmp);
  const stride = m.FPDFBitmap_GetStride(bmp);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = buf + y * stride + x * 4;
      const d = (y * w + x) * 4;
      rgba[d] = p.HEAPU8[s + 2]; rgba[d + 1] = p.HEAPU8[s + 1]; rgba[d + 2] = p.HEAPU8[s]; rgba[d + 3] = 255;
    }
  }
  m.FPDFBitmap_Destroy(bmp);
  m.FPDF_ClosePage(page);
  m.FPDF_CloseDocument(doc);
  p.wasmExports.free(ptr);
  return { width: w, height: h, rgba };
}

/** Pixel colour at PDF point (x, y) (y up) in a renderPage() result at scale 1. */
export function pixelAt(img, x, y) {
  const px = Math.min(img.width - 1, Math.round(x));
  const py = Math.min(img.height - 1, Math.round(img.height - y));
  const i = (py * img.width + px) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
}

export function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
