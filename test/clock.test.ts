import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/clock.js";

describe("FakeClock", () => {
  it("returns a copy of the current time and can be moved", () => {
    const start = new Date("2026-09-29T14:00:00Z");
    const clock = new FakeClock(start);

    const first = clock.now();
    expect(first.toISOString()).toBe("2026-09-29T14:00:00.000Z");
    first.setUTCMinutes(30);
    expect(clock.now().toISOString()).toBe("2026-09-29T14:00:00.000Z");

    clock.set(new Date("2026-09-29T14:07:30Z"));
    expect(clock.now().toISOString()).toBe("2026-09-29T14:07:30.000Z");
  });
});
