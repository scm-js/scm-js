// Marks a screenshot for the guides: crops it, pixelates names (`hide`), darkens around a dialog (`keep`), and draws
// a dashed ring, an arrow and a label, then writes WebP (and a PNG to look at). The AI tools guide's Claude Desktop
// pictures (docs/images/ai-desktop-*.webp) were made with it; their specs are in scripts/pictures/ai-desktop.json.
//
//   node scripts/pictures/mark-screenshot.mjs <screenshot.png> <spec.json> <out.webp> [preview.png]
//
// A spec: { crop: {x,y,w,h}, hide?: [{x,y,w,h}], keep?: {x,y,w,h}, ring?: {x,y,w,h},
//           arrow?: { from: [x,y], ctrl: [x,y], to: [x,y] }, label?: { text, x, y, align? } } — after the crop's origin.
// It needs the Chromium the browser tests use (npx playwright install chromium); nothing runs it in CI.
import { chromium } from "playwright";
import fs from "node:fs";

const [src, specFile, out, preview] = process.argv.slice(2);
if (!src || !specFile || !out) { console.error("usage: node scripts/pictures/mark-screenshot.mjs <screenshot.png> <spec.json> <out.webp> [preview.png]"); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
await (async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const data = "data:image/png;base64," + fs.readFileSync(src).toString("base64");
  const result = await page.evaluate(async ({ data, spec }) => {
    const img = new Image(); img.src = data; await img.decode();
    const { crop, ring, arrow, label } = spec;
    const c = document.createElement("canvas"); c.width = crop.w; c.height = crop.h;
    const g = c.getContext("2d");
    g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    // Hidden: each rectangle drawn in blocks of its own average colours, so a name cannot be read.
    for (const r of spec.hide ?? []) {
      const n = 6;
      for (let y = r.y; y < r.y + r.h; y += n) for (let x = r.x; x < r.x + r.w; x += n) {
        const d = g.getImageData(x, y, n, n).data; let R = 0, G = 0, B = 0;
        for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
        const k = d.length / 4; g.fillStyle = `rgb(${R / k},${G / k},${B / k})`; g.fillRect(x, y, n, n);
      }
    }
    // Everything outside `keep` darkened, so the label reads over the blurred page behind a dialog.
    if (spec.keep) {
      const k = spec.keep; g.fillStyle = "rgba(0,0,0,0.6)";
      g.beginPath(); g.rect(0, 0, crop.w, crop.h); g.roundRect(k.x, k.y, k.w, k.h, 10); g.fill("evenodd");
    }
    const accent = "#ff9f43";
    if (ring) {
    g.strokeStyle = accent; g.lineWidth = 2.5; g.setLineDash([7, 5]);
    g.beginPath(); g.roundRect(ring.x, ring.y, ring.w, ring.h, 8); g.stroke();
    g.setLineDash([]);
    const { from, ctrl, to } = arrow;
    g.lineWidth = 3.5; g.lineCap = "round";
    g.beginPath(); g.moveTo(...from); g.quadraticCurveTo(...ctrl, ...to); g.stroke();
    const ang = Math.atan2(to[1] - ctrl[1], to[0] - ctrl[0]);
    g.beginPath(); g.moveTo(to[0], to[1]);
    g.lineTo(to[0] - 16 * Math.cos(ang - 0.45), to[1] - 16 * Math.sin(ang - 0.45));
    g.lineTo(to[0] - 16 * Math.cos(ang + 0.45), to[1] - 16 * Math.sin(ang + 0.45));
    g.closePath(); g.fillStyle = accent; g.fill();
    g.font = "600 16px 'Segoe UI', system-ui, sans-serif"; g.textBaseline = "top"; g.textAlign = label.align ?? "left";
    g.fillText(label.text, label.x, label.y);
    }
    return { webp: c.toDataURL("image/webp", 0.86), png: c.toDataURL("image/png") };
  }, { data, spec });
  fs.writeFileSync(out, Buffer.from(result.webp.split(",")[1], "base64"));
  if (preview) fs.writeFileSync(preview, Buffer.from(result.png.split(",")[1], "base64"));
  await browser.close();
})();
