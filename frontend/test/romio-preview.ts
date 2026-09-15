import { createPinia } from "pinia";
import { createApp, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { VApp } from "vuetify/components";
import "@/plugins/router";
import type {
  RomioCandidateSchema,
  RomioGameSchema,
  RomioHomeSchema,
} from "@/__generated__";
import i18n, { loadLocale } from "@/locales";
import vuetify from "@/plugins/vuetify";
import api from "@/services/api";
import storePermissions from "@/stores/permissions";
import Discover from "@/v2/views/Discover.vue";
import { installBreakpointAttribute } from "@/v2/composables/useBreakpoint";
import { useInputModality } from "@/v2/composables/useInputModality";
import "@/styles/fonts.css";
import "@/v2/styles/global.css";
import homeFixture from "./romio-home.fixture.json";

const fixtureHome: RomioHomeSchema = { ...homeFixture, language: "en" };
const sections = fixtureHome.sections;
const providerSyncFixture = new URLSearchParams(location.search).has(
  "provider-sync",
);
const games: RomioGameSchema[] = [
  ...new Map(
    sections.flatMap((section) => section.items).map((game) => [game.id, game]),
  ).values(),
];
const candidate: RomioCandidateSchema = {
  id: "a".repeat(64),
  title: "Orbit Quest (USA)",
  system: "nes",
  region: "USA",
  revision: "Rev 1",
  source: {
    infoHash: "b".repeat(40),
    filePath: "Fixture/Orbit Quest (USA).zip",
    size: 450000,
    sha256: "",
  },
  origin: "Fixture collection",
  provenance: "Mock metadata",
  totalSize: 900000,
  score: 100,
  reasons: [],
  cached: true,
  packaging: "zip",
  contentsVerified: false,
};
let currentCandidate = candidate;
api.defaults.adapter = async (config) => {
  const path = config.url ?? "";
  let data: object = {};
  if (path === "/romio/connection")
    data = {
      connected: true,
      name: "Romio fixture",
      baseUrl: "https://fixture.invalid",
    };
  else if (path === "/romio/manifest")
    data = {
      id: "org.romio.games",
      version: "1.0.0",
      name: "Romio",
      catalogReady: true,
      capabilities: { browser: true, native: true },
      systems: [
        {
          id: "nes",
          name: "Nintendo Entertainment System",
          rommSlug: "nes",
          browserCore: "nes",
          retro: true,
        },
        {
          id: "gba",
          name: "Game Boy Advance",
          rommSlug: "gba",
          browserCore: "gba",
          retro: false,
        },
      ],
      categories: [
        { id: "all", name: "All games" },
        ...sections.map((section) => ({ id: section.id, name: section.title })),
      ],
    };
  else if (path === "/romio/home")
    data = {
      language: "en",
      sections: sections.map((section) => ({
        ...section,
        items: section.items.filter(
          (game) =>
            config.params.system === "all" ||
            game.system === config.params.system,
        ),
      })),
    };
  else if (path === "/romio/metadata")
    data = { provider: "igdb", configured: false, maxBatchSize: 12 };
  else if (path === "/romio/catalog") {
    const params = config.params as {
      q: string;
      system: string;
      category: string;
    };
    const items = games.filter(
      (game) =>
        (!params.q ||
          game.title.toLowerCase().includes(params.q.toLowerCase())) &&
        (params.system === "all" || game.system === params.system) &&
        (params.category === "all" ||
          sections
            .find((section) => section.id === params.category)
            ?.items.some((item) => item.id === game.id)),
    );
    data = { items, offset: 0, hasMore: false, total: items.length };
  } else if (path.endsWith("/sources")) {
    const selected = games.find((game) => path.includes(game.id)) ?? games[0];
    currentCandidate = {
      ...candidate,
      title: `${selected.title} (USA)`,
      system: selected.system,
      source: {
        ...candidate.source,
        filePath: `Fixture/${selected.title} (USA).zip`,
      },
    };
    data = {
      items: [
        currentCandidate,
        {
          ...currentCandidate,
          id: "e".repeat(64),
          region: "Europe",
          cached: false,
        },
      ],
      warnings: [],
      offset: 0,
      hasMore: false,
    };
  } else if (path.startsWith("/romio/acquisitions"))
    data = {
      id: "d".repeat(64),
      state: "downloading",
      progress: providerSyncFixture ? 0 : 0.42,
      stage: providerSyncFixture ? "provider_sync" : "downloading",
      checkedAt: Date.now(),
      providerUpdatedAt: providerSyncFixture ? Date.now() - 240000 : null,
      updatedAt: 1,
      candidate: currentCandidate,
      error: null,
    };
  return { data, status: 200, statusText: "OK", headers: {}, config };
};

const pinia = createPinia();
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: Discover }],
});
const app = createApp({
  setup() {
    installBreakpointAttribute();
    useInputModality().install();
    return () => h(VApp, {}, () => h(Discover));
  },
});
app.use(pinia).use(vuetify).use(i18n).use(router);
storePermissions().isAdmin = true;
await loadLocale("en_US");
await router.push("/discover");
await router.isReady();
app.mount("#app");
