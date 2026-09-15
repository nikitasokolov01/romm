/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import type { RomioCandidate, RomioGame, RomioJob } from "@/services/api/romio";
import SourceDialog from "@/v2/components/Romio/SourceDialog.vue";

const mocks = vi.hoisted(() => ({
  sources: vi.fn(),
  acquire: vi.fn(),
  job: vi.fn(),
  link: vi.fn(),
  deviceEnabled: false,
  companionJob: vi.fn(),
  companionLaunch: vi.fn(),
  companionInstall: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/services/api/romio", () => ({ default: mocks }));
vi.mock("@/services/romio-companion", () => ({
  companion: {
    job: mocks.companionJob,
    launch: mocks.companionLaunch,
    install: mocks.companionInstall,
  },
}));
vi.mock("@/stores/auth", () => ({ default: () => ({ user: { id: 1 } }) }));
vi.mock("@/v2/composables/useWrapGridNav", () => ({ useWrapGridNav: vi.fn() }));
vi.mock("@/v2/composables/useRomioDevice", () => ({
  useRomioDevice: () => ({
    status: ref(
      mocks.deviceEnabled
        ? {
            profiles: [{ id: "mock-nes", label: "Mock NES", systems: ["nes"] }],
            capabilities: {
              systems: ["nes"],
              formats: ["raw", "zip"],
              maxDownloadBytes: 1024 ** 3,
            },
          }
        : null,
    ),
    token: ref("mock-device-token"),
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/v2/components/Romio/RemotePlayer.vue", () => ({
  default: defineComponent({ template: '<div class="remote-player" />' }),
}));
vi.mock("@v2/lib", () => ({
  RDialog: defineComponent({
    template:
      '<section><slot name="header" /><slot name="content" /><slot name="footer" /></section>',
  }),
  RBtn: defineComponent({
    props: { disabled: { type: Boolean, default: false } },
    template: '<button :disabled="disabled"><slot /></button>',
  }),
  RCard: defineComponent({ template: "<div><slot /></div>" }),
  RChip: defineComponent({ template: "<span><slot /></span>" }),
  RAlert: defineComponent({
    props: { text: { type: String, default: "" } },
    template: "<p>{{ text }}</p>",
  }),
  RIcon: defineComponent({ template: "<span />" }),
  RSpinner: defineComponent({ template: "<span />" }),
  RSelect: defineComponent({ template: "<span />" }),
  RProgressLinear: defineComponent({
    props: { modelValue: { type: Number, default: 0 } },
    template: '<progress :value="modelValue" max="100" />',
  }),
}));

const candidate: RomioCandidate = {
  id: "a".repeat(64),
  title: "Test Game (USA).zip",
  system: "nes",
  region: "USA",
  revision: "",
  source: {
    infoHash: "b".repeat(40),
    filePath: "collection/Test Game (USA).zip",
    size: 1000,
    sha256: "",
  },
  origin: "Minerva",
  provenance: "descriptor",
  totalSize: 1000,
  score: 1,
  reasons: [],
  cached: true,
  packaging: "zip",
};
const game: RomioGame = {
  id: "c".repeat(64),
  title: "Test Game",
  system: "nes",
  systemName: "NES",
  rommSlug: "nes",
  browserCore: "nes",
  sourceCount: 1,
  awards: [],
};
function job(state: RomioJob["state"] = "downloading"): RomioJob {
  return {
    id: "d".repeat(64),
    state,
    progress: state === "ready" ? 1 : 0.5,
    updatedAt: 1,
    candidate,
  };
}

describe("source preparation lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.deviceEnabled = false;
    mocks.companionJob.mockRejectedValue(new Error("not installed"));
    mocks.companionLaunch.mockResolvedValue({ launched: true });
    mocks.sources.mockResolvedValue({
      data: { items: [candidate], warnings: [], offset: 0, hasMore: false },
    });
    mocks.acquire.mockResolvedValue({ data: job() });
    mocks.job.mockResolvedValue({ data: job("ready") });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("explains when cached collections lack matching individual game files", async () => {
    mocks.sources.mockResolvedValue({
      data: {
        items: [],
        warnings: [
          "INDIVIDUAL_FILES_UNAVAILABLE",
          "PROVIDER_STATUS_UNAVAILABLE",
        ],
        offset: 0,
        hasMore: false,
      },
    });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    expect(wrapper.text()).toContain("romio.individual-files-unavailable");
    expect(wrapper.text()).toContain("PROVIDER_STATUS_UNAVAILABLE");
    expect(wrapper.text()).not.toContain("INDIVIDUAL_FILES_UNAVAILABLE");
    expect(mocks.acquire).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("advances a filtered source page by the API page size", async () => {
    mocks.sources
      .mockResolvedValueOnce({
        data: { items: [candidate], warnings: [], offset: 0, hasMore: true },
      })
      .mockResolvedValueOnce({
        data: { items: [], warnings: [], offset: 100, hasMore: true },
      })
      .mockResolvedValueOnce({
        data: { items: [], warnings: [], offset: 200, hasMore: false },
      });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    for (const offset of [100, 200]) {
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "common.next-page")!
        .trigger("click");
      await flushPromises();
      expect(mocks.sources).toHaveBeenLastCalledWith(game.id, offset);
    }
    wrapper.unmount();
  });

  it("prepares once, displays percentage and starts the browser only when ready", async () => {
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    const play = wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.browser");
    expect(play).toBeDefined();
    await play!.trigger("click");
    await flushPromises();
    expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith(candidate.id);
    expect(wrapper.find("progress").attributes("value")).toBe("50");
    expect(wrapper.find(".remote-player").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(7000);
    await flushPromises();
    expect(wrapper.find(".remote-player").exists()).toBe(true);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("does not resubmit an uncertain acquisition", async () => {
    mocks.acquire.mockRejectedValue(new Error("offline"));
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    const play = wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.browser")!;
    await play.trigger("click");
    await flushPromises();
    await play.trigger("click");
    await flushPromises();
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("romio.uncertain");
    expect(wrapper.text()).not.toContain("romio.choose-another-copy");
    wrapper.unmount();
  });

  it("keeps polling after a transient status failure", async () => {
    mocks.job
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ data: job("ready") });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.browser")!
      .trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(7000);
    expect(wrapper.text()).toContain("romio.status-retry");
    await vi.advanceTimersByTimeAsync(7000);
    await flushPromises();
    expect(mocks.job).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".remote-player").exists()).toBe(true);
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("retries restoring a remembered job after a transient failure", async () => {
    localStorage.setItem(
      `romio-choice:${location.origin}:1:${game.id}`,
      JSON.stringify({ candidateId: candidate.id, jobId: "d".repeat(64) }),
    );
    mocks.job
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ data: job("ready") });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    expect(wrapper.text()).toContain("romio.status-retry");
    await vi.advanceTimersByTimeAsync(7000);
    await flushPromises();
    expect(mocks.job).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("romio.state-ready");
    expect(mocks.acquire).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("shows provider stages and an honest checked time without a fabricated percentage", async () => {
    mocks.acquire.mockResolvedValue({
      data: {
        ...job(),
        progress: 0,
        stage: "verify_file",
        checkedAt: 1700000000000,
      },
    });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.browser")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("romio.stage-verify-file");
    expect(wrapper.text()).toContain("romio.last-checked");
    expect(wrapper.text()).not.toContain("0%");
    wrapper.unmount();
  });

  it("stops polling after closing the source dialog", async () => {
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.browser")!
      .trigger("click");
    await flushPromises();
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it("restores an existing copy and job without searching or resubmitting", async () => {
    localStorage.setItem(
      `romio-choice:${location.origin}:1:${game.id}`,
      JSON.stringify({ candidateId: candidate.id, jobId: "d".repeat(64) }),
    );
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    expect(mocks.job).toHaveBeenCalledExactlyOnceWith("d".repeat(64));
    expect(mocks.sources).not.toHaveBeenCalled();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.browser")!
      .trigger("click");
    await flushPromises();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(wrapper.find(".remote-player").exists()).toBe(true);
    wrapper.unmount();
  });

  it("replays an installed source while the provider status is unavailable", async () => {
    mocks.deviceEnabled = true;
    localStorage.setItem(
      `romio-choice:${location.origin}:1:${game.id}`,
      JSON.stringify({ candidateId: candidate.id, jobId: "d".repeat(64) }),
    );
    mocks.job.mockRejectedValue(new Error("provider unavailable"));
    mocks.companionJob.mockResolvedValue({
      id: candidate.id,
      state: "installed",
      received: 1000,
      total: 1000,
    });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    const play = wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.native")!;
    expect(play.attributes("disabled")).toBeUndefined();
    await play.trigger("click");
    await flushPromises();
    expect(mocks.companionLaunch).toHaveBeenCalledExactlyOnceWith(
      "mock-device-token",
      candidate.id,
      "mock-nes",
    );
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.companionInstall).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("checks local installation before preparing a newly selected source", async () => {
    mocks.deviceEnabled = true;
    mocks.companionJob.mockResolvedValue({
      id: candidate.id,
      state: "installed",
      received: 1000,
      total: 1000,
    });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.native")!
      .trigger("click");
    await flushPromises();
    expect(mocks.companionLaunch).toHaveBeenCalledExactlyOnceWith(
      "mock-device-token",
      candidate.id,
      "mock-nes",
    );
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("requests a fresh provider link only when a new native install is needed", async () => {
    mocks.deviceEnabled = true;
    mocks.acquire.mockResolvedValue({ data: job("ready") });
    mocks.link.mockResolvedValue({
      data: { url: "https://cdn.torbox.app/mock.zip?fresh=test" },
    });
    mocks.companionInstall.mockResolvedValue({
      id: candidate.id,
      state: "downloading",
      received: 0,
      total: 1000,
    });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "romio.native")!
      .trigger("click");
    await flushPromises();
    expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith(candidate.id);
    expect(mocks.link).toHaveBeenCalledExactlyOnceWith("d".repeat(64));
    expect(mocks.companionInstall).toHaveBeenCalledWith(
      "mock-device-token",
      expect.objectContaining({
        sourceId: candidate.id,
        title: "Test Game (USA).zip",
        profileId: "mock-nes",
        launch: true,
      }),
    );
    expect(
      localStorage.getItem(`romio-choice:${location.origin}:1:${game.id}`),
    ).not.toContain("https:");
    wrapper.unmount();
  });

  it.each(["ready", "failed"] as const)(
    "lets the user choose another copy after a %s job without resubmitting",
    async (state) => {
      localStorage.setItem(
        `romio-choice:${location.origin}:1:${game.id}`,
        JSON.stringify({ candidateId: candidate.id, jobId: "d".repeat(64) }),
      );
      mocks.job.mockResolvedValue({ data: job(state) });
      const wrapper = mount(SourceDialog, { props: { game } });
      await flushPromises();
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "romio.choose-another-copy")!
        .trigger("click");
      await flushPromises();
      expect(
        localStorage.getItem(`romio-choice:${location.origin}:1:${game.id}`),
      ).toBeNull();
      expect(mocks.sources).toHaveBeenCalledExactlyOnceWith(game.id, 0);
      expect(mocks.acquire).not.toHaveBeenCalled();
      expect(wrapper.find("progress").exists()).toBe(false);
      wrapper.unmount();
    },
  );

  it("keeps active provider acquisitions remembered", async () => {
    localStorage.setItem(
      `romio-choice:${location.origin}:1:${game.id}`,
      JSON.stringify({ candidateId: candidate.id, jobId: "d".repeat(64) }),
    );
    mocks.job.mockResolvedValue({ data: job("downloading") });
    const wrapper = mount(SourceDialog, { props: { game } });
    await flushPromises();
    expect(wrapper.text()).not.toContain("romio.choose-another-copy");
    expect(mocks.sources).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
