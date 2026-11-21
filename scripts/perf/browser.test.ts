import { describe, expect, it } from "vitest";
import { FAST_4G, PROFILES } from "./browser.mjs";

describe("profiles", () => {
  it("uses DevTools' Fast 4G preset, as QA did", () => {
    expect(FAST_4G).toEqual({ offline: false, downloadThroughput: 1_012_500, uploadThroughput: 168_750, latency: 165 });
  });

  it("gives the phone profile the low tier and the desktop profile the high tier (capability.ts thresholds)", () => {
    expect(PROFILES.phone).toMatchObject({ tier: "low", viewport: { width: 412, height: 915 }, cpu: 4, network: FAST_4G, device: { deviceMemory: 4, hardwareConcurrency: 6 } });
    expect(PROFILES.desktop).toMatchObject({ tier: "high", cpu: 1, network: null, device: { deviceMemory: 8 } });
    // capability.ts: under 8 GB or under 8 cores is the low tier; under 4 of either is no 3D at all
    expect(PROFILES.phone.device.deviceMemory).toBeGreaterThanOrEqual(4);
    expect(PROFILES.phone.device.deviceMemory).toBeLessThan(8);
    expect(PROFILES.desktop.device.hardwareConcurrency).toBeGreaterThanOrEqual(8);
  });
});
