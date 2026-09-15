<script setup lang="ts">
import {
  RAlert,
  RBtn,
  RCard,
  RForm,
  RIcon,
  RImg,
  RSelect,
  RSkeletonBlock,
  RTextField,
} from "@v2/lib";
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import type { RomioHomeSchema } from "@/__generated__";
import romioApi, {
  type RomioGame,
  type RomioManifest,
} from "@/services/api/romio";
import {
  hasAttributedRating,
  hasExplicitCatalogQuery,
} from "@/v2/components/Romio/discoverMode";
import RomioGameCard from "@/v2/components/Romio/RomioGameCard.vue";
import RomioSettings from "@/v2/components/Romio/RomioSettings.vue";
import SourceDialog from "@/v2/components/Romio/SourceDialog.vue";
import { useCan } from "@/v2/composables/useCan";
import { useIsAlive } from "@/v2/composables/useIsAlive";
import { useResponsiveColumns } from "@/v2/composables/useResponsiveColumns";
import { useSnackbar } from "@/v2/composables/useSnackbar";
import { useWrapGridNav } from "@/v2/composables/useWrapGridNav";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const alive = useIsAlive();
const canAdmin = useCan("app.admin");
const snackbar = useSnackbar();
const matching = ref(false);
const metadataConfigured = ref(false);
const manifest = ref<RomioManifest | null>(null);
const home = ref<RomioHomeSchema | null>(null);
const connected = ref(false);
const ready = ref(false);
const loading = ref(false);
const failed = ref(false);
const games = ref<RomioGame[]>([]);
const hasMore = ref(false);
const total = ref(0);
const offset = ref(0);
const selected = ref<RomioGame | null>(null);
const settings = ref(false);
const grid = ref<HTMLElement | null>(null);
const { columns } = useResponsiveColumns(grid, { cardWidth: 172, gap: 20 });
useWrapGridNav(grid, { cellSelector: ".romio-game__open" });
const readQuery = (key: string, fallback = "") =>
  typeof route.query[key] === "string" ? String(route.query[key]) : fallback;
const query = ref(readQuery("q"));
const system = computed(() => readQuery("system", "all"));
const category = computed(() => readQuery("category"));
const resultsMode = computed(() =>
  hasExplicitCatalogQuery(readQuery("q"), category.value),
);
const pageOffset = computed(() =>
  Math.max(0, Math.floor((Number(readQuery("offset")) || 0) / 48) * 48),
);
const systems = computed(() => [
  { id: "all", name: t("common.all-platforms") },
  ...(manifest.value?.systems ?? []),
]);
const categories = computed(
  () => manifest.value?.categories.filter((item) => item.id !== "all") ?? [],
);
const sections = computed(
  () =>
    home.value?.sections
      .filter((section) => section.id !== "all")
      .map((section) => ({
        ...section,
        items:
          section.id === "top-rated"
            ? section.items.filter(hasAttributedRating)
            : section.items,
      })) ?? [],
);
const heroCovers = computed(() =>
  [
    ...new Map(
      sections.value
        .flatMap((section) => section.items)
        .filter((game) => game.coverUrl)
        .map((game) => [game.id, game]),
    ).values(),
  ].slice(0, 3),
);
const resultsTitle = computed(() =>
  readQuery("q").trim()
    ? t("romio.search-results", { query: readQuery("q").trim() })
    : (manifest.value?.categories.find((item) => item.id === category.value)
        ?.name ?? t("common.games")),
);
let request: AbortController | null = null;
let requestId = 0;

async function filter(key: string, value: string) {
  await router.push({
    query: {
      ...route.query,
      offset: undefined,
      [key]:
        !value || (key === "system" && value === "all") ? undefined : value,
    },
  });
}
async function viewCategory(id: string) {
  await router.push({
    query: {
      system: system.value === "all" ? undefined : system.value,
      category: id,
    },
  });
}
async function goHome() {
  await router.push({
    query: { system: system.value === "all" ? undefined : system.value },
  });
}
async function load() {
  if (!manifest.value) return;
  request?.abort();
  request = new AbortController();
  const id = ++requestId;
  loading.value = true;
  failed.value = false;
  games.value = [];
  home.value = null;
  hasMore.value = false;
  try {
    if (resultsMode.value) {
      const { data } = await romioApi.catalog(
        {
          system: system.value,
          category: category.value || "all",
          q: readQuery("q").trim(),
          offset: pageOffset.value,
        },
        request.signal,
      );
      if (!alive.value || id !== requestId) return;
      games.value = data.items;
      offset.value = data.offset + 48;
      hasMore.value = data.hasMore;
      total.value = data.total;
    } else {
      const { data } = await romioApi.home(system.value, request.signal);
      if (!alive.value || id !== requestId) return;
      home.value = data;
    }
  } catch {
    if (alive.value && id === requestId) failed.value = true;
  } finally {
    if (alive.value && id === requestId) loading.value = false;
  }
}
async function initialize() {
  ready.value = false;
  failed.value = false;
  manifest.value = null;
  try {
    const { data } = await romioApi.connection();
    if (!alive.value) return;
    connected.value = data.connected;
    if (data.connected) {
      const result = await romioApi.manifest();
      if (!alive.value) return;
      manifest.value = result.data;
      await load();
    }
  } catch {
    if (alive.value) failed.value = true;
  } finally {
    if (alive.value) ready.value = true;
  }
}
async function matchMetadata() {
  if (matching.value || !metadataConfigured.value) return;
  const visible = resultsMode.value
    ? games.value
    : sections.value.flatMap((section) => section.items);
  const ids = [...new Set(visible.map((game) => game.id))].slice(0, 48);
  matching.value = true;
  let matched = 0;
  try {
    for (let offset = 0; offset < ids.length && alive.value; offset += 12) {
      const { data } = await romioApi.syncMetadata(
        ids.slice(offset, offset + 12),
      );
      if (!alive.value) return;
      matched += data.items.filter((item) => item.status === "matched").length;
    }
    const { data } = await romioApi.manifest();
    if (alive.value) {
      manifest.value = data;
      await load();
      snackbar.success(t("romio.metadata-matched", { n: matched }));
    }
  } catch {
    if (alive.value) snackbar.error(t("romio.request-failed"));
  } finally {
    if (alive.value) matching.value = false;
  }
}
watch(
  () => [
    route.query.q,
    route.query.system,
    route.query.category,
    route.query.offset,
  ],
  () => {
    query.value = readQuery("q");
    void load();
  },
);
onMounted(initialize);
onMounted(async () => {
  try {
    const { data } = await romioApi.metadata();
    if (alive.value) metadataConfigured.value = data.configured;
  } catch {
    if (alive.value) metadataConfigured.value = false;
  }
});
onScopeDispose(() => request?.abort());
</script>

<template>
  <main class="romio-discover">
    <header
      class="romio-discover__hero d-flex align-center justify-space-between ga-6"
    >
      <div class="romio-discover__intro">
        <p class="romio-discover__eyebrow d-flex align-center ga-2">
          <RIcon icon="mdi-gamepad-variant-outline" /> RomM + Romio
        </p>
        <h1>{{ t("romio.discover") }}</h1>
        <p class="romio-discover__subtitle">{{ t("romio.discover-hint") }}</p>
        <RBtn
          class="mt-5"
          prepend-icon="mdi-tune-variant"
          variant="outlined"
          @click="settings = true"
          >{{ t("common.settings") }}</RBtn
        >
      </div>
      <div
        v-if="!resultsMode && heroCovers.length"
        class="romio-discover__cover-stack"
        aria-hidden="true"
      >
        <RImg
          v-for="game in heroCovers"
          :key="game.id"
          :src="game.coverUrl ?? undefined"
          alt=""
          contain
          class="romio-discover__hero-cover"
        />
      </div>
      <RIcon
        v-else
        class="romio-discover__hero-icon"
        icon="mdi-controller-classic-outline"
        size="132"
        aria-hidden="true"
      />
    </header>
    <RAlert
      v-if="failed"
      type="error"
      class="mb-6"
      :text="t('romio.request-failed')"
      ><template #append
        ><RBtn variant="text" @click="initialize">{{
          t("romio.retry")
        }}</RBtn></template
      ></RAlert
    >
    <RCard v-if="ready && !connected" class="pa-8">
      <h2 class="mb-3">{{ t("romio.connect-title") }}</h2>
      <p class="mb-6">{{ t("romio.connect-hint") }}</p>
      <RBtn prepend-icon="mdi-link-variant" @click="settings = true">{{
        t("common.settings")
      }}</RBtn>
    </RCard>
    <template v-if="manifest">
      <RForm
        class="romio-discover__filters d-flex flex-wrap ga-3"
        @submit.prevent="filter('q', query.trim())"
      >
        <RTextField
          v-model="query"
          class="romio-discover__search"
          :label="t('common.search')"
          prepend-inner-icon="mdi-magnify"
        />
        <RSelect
          :model-value="system"
          class="romio-discover__system"
          :items="systems"
          item-title="name"
          item-value="id"
          :label="t('common.platforms')"
          searchable
          @update:model-value="filter('system', String($event))"
        />
        <RBtn type="submit" color="primary" size="large">{{
          t("common.search")
        }}</RBtn>
      </RForm>
      <nav
        class="romio-discover__categories d-flex flex-wrap ga-2"
        :aria-label="t('romio.categories')"
      >
        <RBtn
          :variant="!resultsMode ? 'flat' : 'text'"
          :aria-pressed="!resultsMode"
          @click="goHome"
          >{{ t("romio.discover") }}</RBtn
        >
        <RBtn
          v-for="item in categories"
          :key="item.id"
          :variant="category === item.id ? 'flat' : 'text'"
          :aria-pressed="category === item.id"
          @click="viewCategory(item.id)"
          >{{ item.name }}</RBtn
        >
      </nav>
      <RAlert
        v-if="!manifest.catalogReady"
        type="info"
        class="mb-6"
        :text="t('romio.indexing')"
      />
    </template>
    <div
      ref="grid"
      class="romio-discover__content"
      :style="{ '--romio-columns': columns }"
      :aria-busy="loading || !ready"
    >
      <div v-if="!ready || loading" class="romio-discover__grid">
        <RSkeletonBlock v-for="n in 6" :key="n" height="280px" />
      </div>
      <template v-else-if="manifest && !failed">
        <template v-if="!resultsMode">
          <section
            v-for="section in sections"
            :key="section.id"
            class="romio-shelf"
            :data-section="section.id"
            :aria-labelledby="`shelf-${section.id}`"
          >
            <div
              class="romio-shelf__heading d-flex align-center justify-space-between ga-3"
            >
              <h2 :id="`shelf-${section.id}`">{{ section.title }}</h2>
              <RBtn
                v-if="section.items.length"
                variant="text"
                append-icon="mdi-arrow-right"
                :aria-label="`${t('romio.view-all')}: ${section.title}`"
                @click="viewCategory(section.id)"
                >{{ t("romio.view-all") }}</RBtn
              >
            </div>
            <div v-if="section.items.length" class="romio-shelf__games">
              <RomioGameCard
                v-for="game in section.items"
                :key="game.id"
                :game="game"
                :focus-key="`${section.id}:${game.id}`"
                @select="selected = $event"
              />
            </div>
            <RCard
              v-else
              class="romio-shelf__empty d-flex align-center flex-wrap ga-5 pa-6"
              variant="outlined"
            >
              <RIcon
                :icon="
                  section.id === 'top-rated'
                    ? 'mdi-star-outline'
                    : 'mdi-controller'
                "
                size="32"
              />
              <p class="romio-shelf__empty-text">
                {{
                  section.id === "top-rated"
                    ? t("romio.ratings-empty")
                    : t("romio.empty-hint")
                }}
              </p>
              <RBtn
                v-if="section.id === 'top-rated' && canAdmin"
                variant="text"
                :loading="matching"
                @click="
                  metadataConfigured ? matchMetadata() : (settings = true)
                "
                >{{
                  metadataConfigured
                    ? t("romio.match-metadata")
                    : t("common.settings")
                }}</RBtn
              >
            </RCard>
          </section>
        </template>
        <template v-else>
          <div
            class="d-flex align-center flex-wrap justify-space-between ga-3 mb-5"
          >
            <div>
              <RBtn
                class="mb-3"
                variant="text"
                prepend-icon="mdi-arrow-left"
                @click="goHome"
                >{{ t("romio.back-to-discover") }}</RBtn
              >
              <h2>{{ resultsTitle }}</h2>
            </div>
            <div class="d-flex align-center flex-wrap ga-3">
              <RBtn
                v-if="canAdmin && metadataConfigured && games.length"
                variant="text"
                :loading="matching"
                prepend-icon="mdi-image-search-outline"
                @click="matchMetadata"
                >{{ t("romio.match-metadata") }}</RBtn
              ><span class="romio-muted">{{
                t("common.games-n", { n: total })
              }}</span>
            </div>
          </div>
          <div class="romio-discover__grid">
            <RomioGameCard
              v-for="game in games"
              :key="game.id"
              :game="game"
              :focus-key="game.id"
              @select="selected = $event"
            />
          </div>
          <RCard v-if="!games.length" class="pa-8 text-center"
            ><RIcon icon="mdi-magnify" size="40" />
            <h2 class="mt-4">{{ t("common.no-results") }}</h2>
            <p class="mt-3">{{ t("romio.empty-hint") }}</p></RCard
          >
          <div
            v-if="hasMore || pageOffset"
            class="d-flex justify-center ga-3 mt-8"
          >
            <RBtn
              v-if="pageOffset"
              :disabled="loading"
              variant="outlined"
              @click="filter('offset', String(Math.max(0, pageOffset - 48)))"
              >{{ t("common.previous-page") }}</RBtn
            >
            <RBtn
              v-if="hasMore"
              :loading="loading"
              variant="outlined"
              @click="filter('offset', String(offset))"
              >{{ t("common.next-page") }}</RBtn
            >
          </div>
        </template>
      </template>
    </div>
    <RomioSettings
      v-if="settings"
      @close="settings = false"
      @connected="initialize"
    />
    <SourceDialog v-if="selected" :game="selected" @close="selected = null" />
  </main>
</template>

<style scoped>
.romio-discover {
  width: 100%;
  min-width: 0;
  padding: 24px var(--r-row-pad) 64px;
  max-width: 1920px;
  margin: 0 auto;
}
.romio-discover__hero {
  min-height: 280px;
  padding: 32px 0 44px;
}
.romio-discover__intro {
  min-width: 0;
  position: relative;
  z-index: 1;
}
.romio-discover__eyebrow {
  color: var(--r-color-brand-primary);
  font-size: 0.76rem;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.romio-discover h1 {
  font-size: clamp(2.8rem, 5vw, 4.8rem);
  line-height: 1.05;
  margin: 18px 0;
  letter-spacing: -0.045em;
}
.romio-discover__subtitle,
.romio-muted {
  color: var(--r-color-fg-muted);
}
.romio-discover__subtitle {
  max-width: 34rem;
  font-size: 1.05rem;
}
.romio-discover__hero-icon {
  color: color-mix(in srgb, var(--r-color-brand-primary) 38%, transparent);
  padding-right: 48px;
}
.romio-discover__cover-stack {
  position: relative;
  width: 390px;
  height: 230px;
  flex-shrink: 0;
  margin-right: 24px;
}
.romio-discover__hero-cover {
  position: absolute;
  width: 145px;
  height: 205px;
  top: 15px;
  left: 10px;
  transform: rotate(-12deg);
  filter: drop-shadow(0 10px 15px color-mix(in srgb, black 25%, transparent));
}
.romio-discover__hero-cover:nth-child(2) {
  left: 120px;
  top: 0;
  transform: rotate(1deg);
  z-index: 1;
}
.romio-discover__hero-cover:nth-child(3) {
  left: 230px;
  transform: rotate(12deg);
}
.romio-discover__filters {
  padding: 20px 0 12px;
  border-top: 1px solid var(--r-color-border);
}
.romio-discover__search {
  flex: 1 1 240px;
}
.romio-discover__system {
  flex: 0 1 290px;
}
.romio-discover__categories {
  padding: 4px 0 28px;
}
.romio-discover__grid {
  display: grid;
  grid-template-columns: repeat(var(--romio-columns), minmax(0, 1fr));
  gap: 28px 20px;
}
.romio-shelf {
  margin-bottom: 42px;
}
.romio-shelf__heading {
  margin-bottom: 18px;
}
.romio-shelf h2 {
  font-size: clamp(1.2rem, 2vw, 1.65rem);
  font-weight: 650;
  letter-spacing: -0.025em;
}
.romio-shelf__games {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: calc(
    (100% - (var(--romio-columns) - 1) * 20px) / var(--romio-columns)
  );
  gap: 20px;
  overflow-x: auto;
  padding: 3px 3px 14px;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}
.romio-shelf__games > * {
  scroll-snap-align: start;
}
.romio-shelf__empty {
  color: var(--r-color-fg-muted);
}
.romio-shelf__empty-text {
  flex: 1 1 240px;
}
:global(html[data-bp~="sm-and-down"] .romio-discover__cover-stack) {
  display: none;
}
:global(html[data-bp~="xs"] .romio-discover__hero) {
  min-height: 0;
  padding: 12px 0 24px;
}
:global(html[data-bp~="xs"] .romio-discover__hero-icon) {
  display: none;
}
:global(html[data-bp~="xs"] .romio-discover__system) {
  flex: 1 1 100%;
}
:global(html[data-bp~="xs"] .romio-shelf__games) {
  grid-auto-columns: min(68vw, 220px);
}
</style>
