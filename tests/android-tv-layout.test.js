const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const resRoot = path.join(__dirname, "../app/src/main/res");

function resourceValues(folder) {
  const xml = fs.readFileSync(path.join(resRoot, folder, "dimens.xml"), "utf8");
  return new Map(
    Array.from(xml.matchAll(/<dimen name="([^"]+)">([\d.]+)(?:dp|sp)<\/dimen>/g))
      .map(match => [match[1], Number(match[2])])
  );
}

test("TV dashboard has a breakpoint for 1080p at 240 dpi", () => {
  // 1920 px / 1.5 = 1280 dp. The previous w1920dp resource skipped this display.
  assert.ok(fs.existsSync(path.join(resRoot, "values-w1280dp", "dimens.xml")));
});

test("1080p and 4K logical-width resources preserve the same visual hierarchy", () => {
  const hd = resourceValues("values-w1280dp");
  const uhd = resourceValues("values-w1920dp");

  for (const name of [
    "tv_pad_horizontal",
    "tv_hero_size",
    "tv_body_size",
    "tv_qr_size",
    "tv_pin_size"
  ]) {
    assert.ok(hd.has(name), `missing ${name} in values-w1280dp`);
    assert.ok(uhd.has(name), `missing ${name} in values-w1920dp`);
  }

  const ratio = uhd.get("tv_qr_size") / hd.get("tv_qr_size");
  assert.ok(ratio >= 1.3 && ratio <= 1.7, `unexpected QR scaling ratio ${ratio}`);
});
