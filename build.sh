#!/usr/bin/env bash
# Assemble a static dist/ for GitHub Pages or Netlify.
# The browser imports PDFium and PDF.js by these relative paths, so the
# published tree has to match the source layout. No bundler step.
# Netlify: build command ./build.sh, publish directory dist.
# GitHub Pages: publish dist/. .nojekyll stops Jekyll from skipping node_modules.
set -euo pipefail
cd "$(dirname "$0")"

npm install --no-audit --no-fund --silent

rm -rf dist
mkdir -p dist

cp index.html styles.css icon.svg favicon.ico dist/
cp -a src dist/src

mkdir -p dist/node_modules/@embedpdf/pdfium/dist \
         dist/node_modules/pdfjs-dist/build
cp node_modules/@embedpdf/pdfium/dist/index.browser.js \
   node_modules/@embedpdf/pdfium/dist/pdfium.wasm \
   dist/node_modules/@embedpdf/pdfium/dist/
cp node_modules/pdfjs-dist/build/pdf.min.mjs \
   node_modules/pdfjs-dist/build/pdf.worker.min.mjs \
   dist/node_modules/pdfjs-dist/build/
cp -a node_modules/pdfjs-dist/cmaps dist/node_modules/pdfjs-dist/cmaps
cp -a node_modules/pdfjs-dist/standard_fonts dist/node_modules/pdfjs-dist/standard_fonts

# Branch deploys on GitHub Pages run Jekyll, which omits node_modules.
touch dist/.nojekyll

required=(
  dist/index.html
  dist/styles.css
  dist/icon.svg
  dist/favicon.ico
  dist/src/app.js
  dist/src/worker.js
  dist/node_modules/@embedpdf/pdfium/dist/index.browser.js
  dist/node_modules/@embedpdf/pdfium/dist/pdfium.wasm
  dist/node_modules/pdfjs-dist/build/pdf.min.mjs
  dist/node_modules/pdfjs-dist/build/pdf.worker.min.mjs
  dist/node_modules/pdfjs-dist/cmaps
  dist/node_modules/pdfjs-dist/standard_fonts
  dist/.nojekyll
)
for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "build failed, missing $path" >&2
    exit 1
  fi
done

echo "Built dist/ ($(du -sh dist | cut -f1)). Publish that folder."
