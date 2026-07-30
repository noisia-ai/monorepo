#!/usr/bin/env node
/**
 * build-portable.mjs — turn an assembled Noisia deck into ONE self-contained .html file.
 *
 * Usage:  node build-portable.mjs <path/to/index.html> [out.html]
 *
 * Why: the normal deck (index.html + engine files) needs its sibling CSS/JS/logo next to it.
 * This inlines everything into a single file that works by double-click — no repo, no Node,
 * no server. Hand it to anyone; they open it in Chrome and do Print → Save as PDF (the engine
 * ships an @media print block that lays out one 1920x1080 slide per page). This is the
 * "no-clone" path for the commercial team.
 *
 * No npm dependency. Reads the files the index.html references, next to it.
 *
 * Gotcha handled: deck-stage.js contains the literal "</script>", which would close an inline
 * <script> early and dump the rest as visible text. So the JS is embedded as a base64
 * data: URI <script src>, which is immune to that. CSS is inlined as <style> (safe: no
 * "</style>" in our stylesheets). The logo SVG is inlined as a data: URI.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error("Usage: node build-portable.mjs <index.html> [out.html]");
  process.exit(1);
}
const htmlPath = resolve(input);
const dir = dirname(htmlPath);
const outPath = resolve(process.argv[3] ?? join(dir, "deck.portable.html"));

let html = readFileSync(htmlPath, "utf8");

const readSibling = (file) => {
  const p = join(dir, file);
  if (!existsSync(p)) {
    console.error(`Missing referenced file: ${file} (looked in ${dir})`);
    process.exit(1);
  }
  return readFileSync(p);
};

// 1. Inline <link rel="stylesheet" href="X.css"> → <style>…</style>
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/gi,
  (_m, href) => `<style>\n${readSibling(href).toString("utf8")}\n</style>`);

// 2. Inline <script src="X.js"> → base64 data: URI (avoids the </script> break)
html = html.replace(/<script[^>]*src=["']([^"']+\.js)["'][^>]*>\s*<\/script>/gi,
  (_m, src) => {
    const b64 = readSibling(src).toString("base64");
    return `<script src="data:text/javascript;base64,${b64}"></script>`;
  });

// 3. Inline any local image src (logo, backgrounds) → data: URI
const mimeByExt = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
html = html.replace(/src=["'](?!data:|https?:)([^"']+\.(svg|png|jpe?g|webp))["']/gi,
  (_m, file, ext) => {
    const mime = mimeByExt[ext.toLowerCase()] ?? "application/octet-stream";
    const b64 = readSibling(file).toString("base64");
    return `src="data:${mime};base64,${b64}"`;
  });

// Guard: no un-inlined local references should remain.
const leftover = html.match(/(?:href|src)=["'](?!data:|https?:|#)[^"']+\.(css|js|svg|png|jpe?g|webp)["']/gi);
if (leftover) {
  console.error("Could not inline these references:\n" + leftover.join("\n"));
  process.exit(1);
}

writeFileSync(outPath, html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Self-contained deck written: ${outPath} (${kb} KB)`);
console.log("Open it in Chrome → Print → Save as PDF (each slide prints as a 1920x1080 page).");
