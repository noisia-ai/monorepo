#!/usr/bin/env node
// Smoke test of the Insights feed in headless Chrome: scrolling advances the active story,
// the address bar follows it, only nearby stories mount, and the list keeps growing.
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://localhost:3010").replace(/\/$/, "");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failed = true;
};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/insights`, { waitUntil: "networkidle0" });
  const first = await page.evaluate(() => location.pathname);
  check(first.startsWith("/insights/"), `first story in the address bar (${first})`);
  const initialArticles = await page.$$eval("[role=feed] article", (n) => n.length);
  const paths = new Set([first]);
  for (let i = 1; i <= initialArticles; i++) {
    await page.evaluate((k) => {
      const feed = document.querySelector("[role=feed]");
      feed.scrollTo({ top: feed.clientHeight * k });
    }, i);
    await new Promise((r) => setTimeout(r, 180));
    paths.add(await page.evaluate(() => location.pathname));
  }
  check(paths.size >= Math.min(10, initialArticles), `address bar followed ${paths.size} stories`);
  const stages = await page.$$eval("[role=feed] [role=img]", (n) => n.length);
  check(stages <= 5, `only nearby stories mounted (${stages})`);
  const grown = await page.$$eval("[role=feed] article", (n) => n.length);
  check(grown > initialArticles, `feed keeps going (${initialArticles} → ${grown})`);
  await page.goto(`${base}/en/insights`, { waitUntil: "networkidle0" });
  check((await page.evaluate(() => location.pathname)).startsWith("/en/insights/"), "English feed keeps the /en prefix");
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
