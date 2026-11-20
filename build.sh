#!/usr/bin/env bash
# Assemble a static dist/ for GitHub Pages or Netlify.
# The browser imports PDFium and PDF.js by these relative paths, so the
# published tree has to match the source layout. No bundler step.
# Netlify: build command ./build.sh, publish directory dist.
# GitHub Pages: publish dist/.
set -euo pipefail
cd "$(dirname "$0")"

npm install --no-audit --no-fund --silent

rm -rf dist
mkdir -p dist

cp index.html styles.css icon.svg favicon.ico dist/
cp -a src dist/src

# Libraries go under vendor/, not node_modules/.../dist. Many .gitignore
# files (including GitHub Pages repos) ignore any folder named node_modules
# or dist, which silently drops PDFium from the commit.
mkdir -p dist/vendor/pdfium dist/vendor/pdfjs
cp node_modules/@embedpdf/pdfium/dist/index.browser.js \
   node_modules/@embedpdf/pdfium/dist/pdfium.wasm \
   dist/vendor/pdfium/
cp node_modules/pdfjs-dist/build/pdf.min.mjs \
   node_modules/pdfjs-dist/build/pdf.worker.min.mjs \
   dist/vendor/pdfjs/
cp -a node_modules/pdfjs-dist/cmaps dist/vendor/pdfjs/cmaps
cp -a node_modules/pdfjs-dist/standard_fonts dist/vendor/pdfjs/standard_fonts

# Point the copied sources at vendor/. perl -pi works on macOS and Linux.
perl -pi -e 's#\.\./node_modules/\@embedpdf/pdfium/dist/#../vendor/pdfium/#g; s#\.\./node_modules/pdfjs-dist/build/#../vendor/pdfjs/#g; s#\.\./node_modules/pdfjs-dist/#../vendor/pdfjs/#g' dist/src/*.js
if grep -rn "node_modules" dist/src; then
  echo "build failed, dist/src still references node_modules" >&2
  exit 1
fi

# Keeps Jekyll from processing the site on branch deploys.
touch dist/.nojekyll

required=(
  dist/index.html
  dist/styles.css
  dist/icon.svg
  dist/favicon.ico
  dist/src/app.js
  dist/src/worker.js
  dist/vendor/pdfium/index.browser.js
  dist/vendor/pdfium/pdfium.wasm
  dist/vendor/pdfjs/pdf.min.mjs
  dist/vendor/pdfjs/pdf.worker.min.mjs
  dist/vendor/pdfjs/cmaps
  dist/vendor/pdfjs/standard_fonts
  dist/.nojekyll
)
for path in "${required[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "build failed, missing $path" >&2
    exit 1
  fi
done

echo "Built dist/ ($(du -sh dist | cut -f1)). Publish that folder."
