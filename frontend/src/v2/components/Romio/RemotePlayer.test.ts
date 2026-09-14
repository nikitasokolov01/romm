/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import RemotePlayer from "@/v2/components/Romio/RemotePlayer.vue";

const mocks = vi.hoisted(() => ({ setPlaying: vi.fn() }));
vi.mock("@/stores/playing", () => ({ default: () => mocks }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("vue-router", () => ({ onBeforeRouteLeave: vi.fn() }));
vi.mock("@/v2/components/Romio/playerDocument", () => ({
  playerDocument: () => "<html><body>Fixture player</body></html>",
}));
vi.mock("@v2/lib", () => ({
  RDialog: defineComponent({
    template: '<div><slot name="content" /><slot name="footer" /></div>',
  }),
  RBtn: defineComponent({ template: "<button><slot /></button>" }),
  RAlert: defineComponent({
    props: { text: { type: String, default: "" } },
    template: "<p>{{ text }}</p>",
  }),
}));

const props = {
  core: "nes",
  acquisitionId: "a".repeat(64),
  candidateId: "b".repeat(64),
  userId: 1,
  extension: "zip",
  title: "Fixture",
};

describe("remote player close and input ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("hands input back when closing before the emulator starts", async () => {
    const wrapper = mount(RemotePlayer, { props, attachTo: document.body });
    expect(mocks.setPlaying).toHaveBeenCalledWith(true);
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(mocks.setPlaying).toHaveBeenLastCalledWith(false);
    wrapper.unmount();
  });

  it("waits for a save acknowledgment from the actual player frame", async () => {
    const wrapper = mount(RemotePlayer, { props, attachTo: document.body });
    await flushPromises();
    const child =
      wrapper.find<HTMLIFrameElement>("iframe").element.contentWindow;
    const send = vi.spyOn(child!, "postMessage").mockImplementation(() => {});
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: child,
        data: { type: "romio-player-started" },
      }),
    );
    await flushPromises();
    await wrapper.find("button").trigger("click");
    expect(send).toHaveBeenCalledWith(
      { type: "romio-save-and-close" },
      location.origin,
    );
    expect(wrapper.emitted("close")).toBeUndefined();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://untrusted.invalid",
        source: child,
        data: { type: "romio-save-result", ok: true },
      }),
    );
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: child,
        data: { type: "romio-save-result", ok: true },
      }),
    );
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps the player open when saving times out", async () => {
    const wrapper = mount(RemotePlayer, { props, attachTo: document.body });
    await flushPromises();
    const child =
      wrapper.find<HTMLIFrameElement>("iframe").element.contentWindow;
    vi.spyOn(child!, "postMessage").mockImplementation(() => {});
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: child,
        data: { type: "romio-player-started" },
      }),
    );
    await flushPromises();
    await wrapper.find("button").trigger("click");
    await vi.advanceTimersByTimeAsync(8000);
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();
    expect(wrapper.text()).toContain("romio.save-failed");
    expect(wrapper.text()).toContain("romio.close-without-saving");
    wrapper.unmount();
  });
});
