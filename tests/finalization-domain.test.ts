import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePassiveDamage,
  passiveEligibilityReason,
  passiveTickBucket,
  stableViewerEstimate,
} from "../app/lib/passive-damage";
import { animationFrameAt, validateAnimationAsset } from "../app/lib/sprite-engine";

test("stable viewer estimate uses the latest three valid samples", () => {
  assert.equal(stableViewerEstimate([{ viewerCount: 8 }, { viewerCount: 50 }, { viewerCount: 12 }]), 12);
  assert.equal(stableViewerEstimate([{ viewerCount: 8 }, { viewerCount: 12 }]), 10);
  assert.equal(stableViewerEstimate([{ viewerCount: 21 }]), 21);
  assert.equal(stableViewerEstimate([{ viewerCount: Number.NaN }, { viewerCount: -1 }]), null);
});

test("passive curve is bounded and grows with diminishing returns", () => {
  const config = { baseDamage: 10, curveExponent: 0.72, softCap: 50, minDamage: 0, maxDamage: 5_000, underdogFactor: 0.15 };
  const small = calculatePassiveDamage(8, config);
  const large = calculatePassiveDamage(50, config);
  assert.ok(small > 0);
  assert.ok(large > small);
  assert.ok(large < small * (50 / 8));
  assert.equal(calculatePassiveDamage(Number.NaN, config), 0);
  assert.ok(calculatePassiveDamage(1_000_000, config) <= 5_000);
  assert.equal(calculatePassiveDamage(1_000_000, { ...config, maxDamage: 100 }), 100);
});

test("passive tick buckets are deterministic", () => {
  const first = passiveTickBucket(Date.parse("2026-08-16T10:03:59.000Z"), 120);
  const second = passiveTickBucket(Date.parse("2026-08-16T10:02:01.000Z"), 120);
  assert.equal(first, second);
});

test("passive eligibility distinguishes outages and event guards", () => {
  const valid = {
    mode: "active" as const,
    eventStatus: "active",
    eventPaused: false,
    damageEnabled: true,
    streamerEnabled: true,
    trackingEnabled: true,
    gameplayEnabled: true,
    includeInCalibration: true,
    isTestAccount: false,
    isLive: true,
    bossAlive: true,
    hasFreshSample: true,
  };
  assert.equal(passiveEligibilityReason(valid), null);
  assert.equal(passiveEligibilityReason({ ...valid, hasFreshSample: false }), "no_fresh_viewer_sample");
  assert.equal(passiveEligibilityReason({ ...valid, eventPaused: true }), "event_paused");
  assert.equal(passiveEligibilityReason({ ...valid, gameplayEnabled: false }), "streamer_not_eligible");
  assert.equal(passiveEligibilityReason({ ...valid, isTestAccount: true }), "production_scope_not_eligible");
});

test("spritesheet definitions validate and resolve row/column frames", () => {
  const asset = {
    type: "spritesheet" as const,
    url: "https://example.com/boss.webp",
    columns: 4,
    rows: 2,
    frameCount: 8,
    clips: { idle: { startFrame: 2, frameCount: 4, fps: 10, loop: true } },
  };
  assert.equal(validateAnimationAsset(asset), true);
  assert.deepEqual(animationFrameAt(asset, "idle", 100), {
    frame: 3,
    column: 3,
    row: 0,
    xPercent: 100,
    yPercent: 0,
    complete: false,
    nextClip: null,
  });
  assert.equal(animationFrameAt(asset, "idle", 800, true).frame, 2);
});

test("one-shot sprite clips expose their next state", () => {
  const asset = {
    type: "spritesheet" as const,
    url: "https://example.com/minion.png",
    columns: 3,
    rows: 1,
    frameCount: 3,
    clips: { intro: { startFrame: 0, frameCount: 3, fps: 10, loop: false, next: "idle" } },
  };
  assert.equal(animationFrameAt(asset, "intro", 400).complete, true);
  assert.equal(animationFrameAt(asset, "intro", 400).nextClip, "idle");
});
