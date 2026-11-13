const test = require("node:test");
const assert = require("node:assert/strict");
const {
  countText,
  createSerialQueue,
  filterApps,
  gestureAction,
  mirrorAspect,
  mirrorFit,
  mirrorPoint,
  mirrorStageSpace,
  nextRetryDelay,
  normalizeSearch,
  readScrcpyHeader
} = require("../app/src/main/assets/web/client-core.js");

test("search matches Chinese labels and package names without changing order", () => {
  const apps = [
    { label: "设置", package: "com.android.tv.settings" },
    { label: "AVBox", package: "com.github.avbox.osc" },
    { label: "PiliPlus", package: "com.example.piliplus" }
  ];

  assert.deepEqual(filterApps(apps, "设置"), [apps[0]]);
  assert.deepEqual(filterApps(apps, "  AVBOX  "), [apps[1]]);
  assert.deepEqual(filterApps(apps, "example"), [apps[2]]);
  assert.deepEqual(filterApps(apps, ""), apps);
});

test("search normalization is case-insensitive and trim-safe", () => {
  assert.equal(normalizeSearch("  AVBox  "), "avbox");
  assert.equal(normalizeSearch(null), "");
});

test("text count handles CJK and multi-code-point emoji as user-visible characters", () => {
  assert.equal(countText("你好 N1"), 5);
  assert.equal(countText("遥控器🎮"), 4);
  assert.equal(countText(""), 0);
});

test("serial queue keeps rapid commands in order and allows only one in flight", async () => {
  const observed = [];
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const queue = createSerialQueue(async command => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    observed.push(`start:${command}`);
    if (command === 1) await firstGate;
    observed.push(`end:${command}`);
    active -= 1;
  });

  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  await Promise.resolve();
  assert.equal(maxActive, 1);
  assert.deepEqual(observed, ["start:1"]);

  releaseFirst();
  await queue.idle();
  assert.equal(maxActive, 1);
  assert.deepEqual(observed, [
    "start:1", "end:1",
    "start:2", "end:2",
    "start:3", "end:3"
  ]);
});

test("serial queue reports failures and continues with later commands", async () => {
  const sent = [];
  const errors = [];
  const queue = createSerialQueue(
    async command => {
      sent.push(command);
      if (command === "bad") throw new Error("offline");
    },
    error => errors.push(error.message)
  );

  queue.enqueue("bad");
  queue.enqueue("next");
  await queue.idle();

  assert.deepEqual(sent, ["bad", "next"]);
  assert.deepEqual(errors, ["offline"]);
});

test("reconnect delays are fast after an outage and calm while online", () => {
  assert.ok(nextRetryDelay(false) < nextRetryDelay(true));
  assert.ok(nextRetryDelay(false) >= 2000);
  assert.ok(nextRetryDelay(true) >= 10000);
});

test("mirror coordinates stay inside the displayed television frame", () => {
  const rect = { left: 20, top: 40, width: 300, height: 180 };
  assert.deepEqual(mirrorPoint(170, 130, rect), { x: 0.5, y: 0.5 });
  assert.deepEqual(mirrorPoint(-80, 500, rect), { x: 0, y: 1 });
});

test("mirror aspect ratio follows both aligned 1080p and 4K streams", () => {
  assert.ok(Math.abs(mirrorAspect(1920, 1072) - 1.7910447761) < 0.000001);
  assert.ok(Math.abs(mirrorAspect(3840, 2160) - 1.7777777778) < 0.000001);
  assert.ok(Math.abs(mirrorAspect(0, 0) - 16 / 9) < 0.000001);
});

test("mirror fit stays inside the stage content box at 1080p and 4K", () => {
  for (const [width, height, availableWidth, availableHeight] of [
    [1920, 1072, 1900, 844],
    [3840, 2160, 3820, 1858]
  ]) {
    const fitted = mirrorFit(width, height, availableWidth, availableHeight);
    assert.ok(fitted.width > 0 && fitted.height > 0);
    assert.ok(fitted.width <= availableWidth);
    assert.ok(fitted.height <= availableHeight);
    assert.ok(
      Math.abs(fitted.width / fitted.height - width / height) < 0.002
    );
  }
});

test("mirror fit reserves portrait height and landscape width for the direction pad", () => {
  assert.deepEqual(
    mirrorStageSpace(390, 640, { width: 150, height: 150, gap: 8 }, false),
    { width: 390, height: 482 }
  );
  assert.deepEqual(
    mirrorStageSpace(840, 360, { width: 138, height: 138, gap: 10 }, true),
    { width: 692, height: 360 }
  );
});

test("mirror gestures distinguish tap, long press and swipe", () => {
  const origin = { x: 0.2, y: 0.3 };
  assert.equal(gestureAction(origin, { x: 0.205, y: 0.305 }, 180), "tap");
  assert.equal(gestureAction(origin, { x: 0.202, y: 0.302 }, 720), "long");
  assert.deepEqual(gestureAction(origin, { x: 0.7, y: 0.6 }, 420), {
    name: "swipe",
    duration: 420
  });
});

test("scrcpy frame headers preserve flags and packet length without signed overflow", () => {
  const header = new Uint8Array(12);
  header[0] = 0x40; // configuration packet, PACKET_FLAG_CONFIG
  header[11] = 21;
  assert.deepEqual(readScrcpyHeader(header), {
    flags: "4611686018427387904",
    config: true,
    key: false,
    length: 21,
    timestamp: 0
  });

  header.fill(0);
  header[0] = 0x20; // key frame, PACKET_FLAG_KEY_FRAME
  header[8] = 0;
  header[9] = 0;
  header[10] = 0x12;
  header[11] = 0x34;
  assert.equal(readScrcpyHeader(header).key, true);
  assert.equal(readScrcpyHeader(header).length, 0x1234);
});
