import { describe, expect, it } from "vitest";
import { focusedFrameOwnsGamepad } from "@/v2/utils/embeddedGamepad";

describe("embedded player gamepad ownership", () => {
  it("yields navigation only to a focused marked player frame", () => {
    const frame = document.createElement("iframe");
    expect(focusedFrameOwnsGamepad(frame)).toBe(false);
    frame.setAttribute("data-gamepad-owner", "");
    expect(focusedFrameOwnsGamepad(frame)).toBe(true);
    const button = document.createElement("button");
    button.setAttribute("data-gamepad-owner", "");
    expect(focusedFrameOwnsGamepad(button)).toBe(false);
    expect(focusedFrameOwnsGamepad(null)).toBe(false);
  });
});
