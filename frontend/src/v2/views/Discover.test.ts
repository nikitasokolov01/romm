/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { RomioGameSchema, RomioHomeSchema } from "@/__generated__";
import Discover from "@/v2/views/Discover.vue";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  manifest: vi.fn(),
  home: vi.fn(),
  catalog: vi.fn(),
  metadata: vi.fn(),
  syncMetadata: vi.fn(),
}));
vi.mock("@/services/api/romio", () => ({ default: mocks }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/v2/composables/useCan", () => ({ useCan: () => ref(true) }));
vi.mock("@/v2/composables/useSnackbar", () => ({
  useSnackbar: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/v2/composables/useResponsiveColumns", () => ({
  useResponsiveColumns: () => ({ columns: ref(3) }),
}));
vi.mock("@/v2/composables/useWrapGridNav", () => ({ useWrapGridNav: vi.fn() }));
vi.mock("@/v2/components/Romio/RomioSettings.vue", () => ({
  default: defineComponent({ template: '<div data-testid="settings" />' }),
}));
vi.mock("@/v2/components/Romio/SourceDialog.vue", () => ({
  default: defineComponent({ template: '<div data-testid="sources" />' }),
}));
vi.mock("@v2/lib", () => ({
  RAlert: defineComponent({
    props: { text: { type: String, default: "" } },
    template: '<p>{{ text }}<slot name="append" /></p>',
  }),
  RBtn: defineComponent({ template: "<button><slot /></button>" }),
  RCard: defineComponent({ template: "<div><slot /></div>" }),
  RChip: defineComponent({ template: "<span><slot /></span>" }),
  RForm: defineComponent({ template: "<form><slot /></form>" }),
  RIcon: defineComponent({ template: "<span />" }),
  RImg: defineComponent({ template: "<img />" }),
  RSelect: defineComponent({ template: "<select />" }),
  RSkeletonBlock: defineComponent({ template: "<div />" }),
  RTextField: defineComponent({
    props: { modelValue: { type: String, default: "" } },
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  }),
}));

function game(overrides: Partial<RomioGameSchema> = {}): RomioGameSchema {
  return {
    id: "a".repeat(64),
    title: "Pokémon Emerald",
    system: "gba",
    systemName: "Game Boy Advance",
    rommSlug: "gba",
    sourceCount: 2,
    awards: [],
    ...overrides,
  };
}
const sectionIds = [
  "top-rated",
  "pokemon",
  "zelda",
  "mario",
  "metroid",
  "retro",
];
function home(): RomioHomeSchema {
  return {
    language: "en",
    sections: sectionIds.map((id) => ({
      id,
      title: id,
      items: id === "pokemon" ? [game()] : [],
    })),
  };
}
async function render(path = "/discover") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/discover", component: Discover }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(Discover, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe("categorized Discover homepage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.connection.mockResolvedValue({ data: { connected: true } });
    mocks.manifest.mockResolvedValue({
      data: {
        systems: [],
        categories: [
          { id: "all", name: "All games" },
          ...sectionIds.map((id) => ({ id, name: id })),
        ],
        catalogReady: true,
      },
    });
    mocks.metadata.mockResolvedValue({ data: { configured: false } });
    mocks.home.mockResolvedValue({ data: home() });
    mocks.catalog.mockResolvedValue({
      data: { items: [game()], total: 1, offset: 0, hasMore: false },
    });
  });

  it("loads six named shelves without requesting or displaying an all-games feed", async () => {
    const { wrapper } = await render();
    expect(mocks.home).toHaveBeenCalledWith("all", expect.any(AbortSignal));
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(
      wrapper
        .findAll("[data-section]")
        .map((node) => node.attributes("data-section")),
    ).toEqual(sectionIds);
    expect(wrapper.text()).not.toContain("All games");
    expect(wrapper.text()).toContain("romio.ratings-empty");
    await wrapper.find('[data-section="top-rated"] button').trigger("click");
    expect(wrapper.find('[data-testid="settings"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps platform filtering on the shelf homepage", async () => {
    const { wrapper } = await render("/discover?system=gba&offset=48");
    expect(mocks.home).toHaveBeenCalledWith("gba", expect.any(AbortSignal));
    expect(mocks.catalog).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("opens a category via View all and returns to shelves", async () => {
    const { wrapper, router } = await render();
    await wrapper.find('[data-section="pokemon"] button').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.category).toBe("pokemon");
    expect(mocks.catalog).toHaveBeenCalledWith(
      { system: "all", category: "pokemon", q: "", offset: 0 },
      expect.any(AbortSignal),
    );
    expect(wrapper.findAll("[data-section]")).toHaveLength(0);
    await wrapper
      .findAll("button")
      .find((node) => node.text() === "romio.back-to-discover")!
      .trigger("click");
    await flushPromises();
    expect(mocks.home).toHaveBeenCalledTimes(2);
    expect(router.currentRoute.value.query).toEqual({});
    wrapper.unmount();
  });

  it.each(["/discover?q=Emerald", "/discover?category=all"])(
    "uses the catalog only for explicit results: %s",
    async (path) => {
      const { wrapper } = await render(path);
      expect(mocks.catalog).toHaveBeenCalledTimes(1);
      expect(mocks.home).not.toHaveBeenCalled();
      expect(wrapper.findAll("[data-section]")).toHaveLength(0);
      wrapper.unmount();
    },
  );

  it("does not fall back to an all-games feed when home fails", async () => {
    mocks.home.mockRejectedValue(new Error("offline"));
    const { wrapper } = await render();
    expect(wrapper.text()).toContain("romio.request-failed");
    expect(mocks.catalog).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("excludes unrated games from the ratings shelf and suppresses an all section", async () => {
    const data = home();
    data.sections[0].items = [
      game(),
      game({
        id: "b".repeat(64),
        title: "Rated game",
        rating: 91,
        ratingSource: "IGDB",
      }),
    ];
    data.sections.push({ id: "all", title: "All games", items: [game()] });
    mocks.home.mockResolvedValue({ data });
    const { wrapper } = await render();
    const top = wrapper.find('[data-section="top-rated"]');
    expect(top.text()).toContain("Rated game");
    expect(top.text()).not.toContain("Pokémon Emerald");
    expect(wrapper.find('[data-section="all"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
