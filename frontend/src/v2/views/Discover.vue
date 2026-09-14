<script setup lang="ts">
import {
  RAlert,
  RBtn,
  RCard,
  RChip,
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
import romioApi, {
  type RomioGame,
  type RomioManifest,
} from "@/services/api/romio";
import RomioSettings from "@/v2/components/Romio/RomioSettings.vue";
import SourceDialog from "@/v2/components/Romio/SourceDialog.vue";
import { useIsAlive } from "@/v2/composables/useIsAlive";
import { useCan } from "@/v2/composables/useCan";
import { useSnackbar } from "@/v2/composables/useSnackbar";
import { useResponsiveColumns } from "@/v2/composables/useResponsiveColumns";
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
const { columns } = useResponsiveColumns(grid, { cardWidth: 168, gap: 18 });
useWrapGridNav(grid, { cellSelector: ".romio-game__open" });
const readQuery = (key: string, fallback = "") =>
  typeof route.query[key] === "string" ? String(route.query[key]) : fallback;
const query = ref(readQuery("q"));
const system = computed(() => readQuery("system", "all"));
const category = computed(() => readQuery("category", "all"));
const pageOffset = computed(() =>
  Math.max(0, Math.floor((Number(readQuery("offset")) || 0) / 48) * 48),
);
const systems = computed(() => [
  { id: "all", name: t("common.all-platforms") },
  ...(manifest.value?.systems ?? []),
]);
let request: AbortController | null = null;
let requestId = 0;

async function filter(key: string, value: string) {
  await router.replace({
    query: {
      ...route.query,
      offset: undefined,
      [key]: value === "all" || !value ? undefined : value,
    },
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
  try {
    const { data } = await romioApi.catalog(
      {
        system: system.value,
        category: category.value,
        q: readQuery("q"),
        offset: pageOffset.value,
      },
      request.signal,
    );
    if (!alive.value || id !== requestId) return;
    games.value = data.items;
    offset.value = data.offset + 48;
    hasMore.value = data.hasMore;
    total.value = data.total;
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
  const ids = games.value.map((game) => game.id);
  matching.value = true;
  let matched = 0;
  try {
    for (let offset = 0; offset < ids.length && alive.value; offset += 12) {
      const { data } = await romioApi.syncMetadata(
        ids.slice(offset, offset + 12),
      );
      if (!alive.value) return;
      for (const item of data.items) {
        if (item.status === "matched" && item.game) {
          const updated = item.game;
          games.value = games.value.map((game) =>
            game.id === updated.id ? updated : game,
          );
          matched++;
        }
      }
    }
    const { data } = await romioApi.manifest();
    if (alive.value) {
      manifest.value = data;
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
  <div class="romio-discover">
    <header
      class="romio-discover__hero d-flex flex-wrap align-center justify-space-between ga-6"
    >
      <div>
        <div class="romio-discover__eyebrow d-flex align-center ga-2">
          <RIcon icon="mdi-gamepad-variant-outline" /> RomM + Romio
        </div>
        <h1>{{ t("romio.discover") }}</h1>
        <p class="romio-discover__subtitle">{{ t("romio.discover-hint") }}</p>
      </div>
      <RBtn
        prepend-icon="mdi-tune-variant"
        variant="outlined"
        @click="settings = true"
        >{{ t("common.settings") }}</RBtn
      >
    </header>

    <RAlert
      v-if="failed"
      type="error"
      class="mb-6"
      :text="t('romio.request-failed')"
    >
      <template #append
        ><RBtn variant="text" @click="initialize">{{
          t("romio.retry")
        }}</RBtn></template
      >
    </RAlert>
    <RCard v-if="ready && !connected" class="pa-8">
      <h2 class="mb-3">{{ t("romio.connect-title") }}</h2>
      <p class="mb-6">{{ t("romio.connect-hint") }}</p>
      <RBtn
        color="primary"
        prepend-icon="mdi-link-variant"
        @click="settings = true"
        >{{ t("common.settings") }}</RBtn
      >
    </RCard>
    <template v-if="manifest">
      <RForm
        class="romio-discover__filters d-flex flex-wrap ga-3 mb-5"
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
        class="d-flex flex-wrap ga-2 mb-6"
        :aria-label="t('romio.categories')"
      >
        <RBtn
          v-for="item in manifest.categories"
          :key="item.id"
          :variant="category === item.id ? 'flat' : 'text'"
          :color="category === item.id ? 'primary' : undefined"
          :aria-pressed="category === item.id"
          @click="filter('category', item.id)"
          >{{ item.name }}</RBtn
        >
      </nav>
      <RAlert
        v-if="!manifest.catalogReady"
        type="info"
        class="mb-6"
        :text="t('romio.indexing')"
      />
      <div
        class="d-flex align-center justify-space-between flex-wrap ga-3 mb-4"
      >
        <h2>{{ t("common.games") }}</h2>
        <div class="d-flex align-center ga-3">
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
    </template>

    <div
      ref="grid"
      class="romio-discover__grid"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      :aria-busy="loading || !ready"
    >
      <template v-if="!ready || (loading && !games.length)"
        ><RSkeletonBlock v-for="n in 12" :key="n" height="260px"
      /></template>
      <RCard v-for="game in games" :key="game.id" class="romio-game">
        <div
          class="romio-game__art d-flex flex-column align-center justify-center"
        >
          <RImg
            v-if="game.coverUrl"
            :src="game.coverUrl"
            :alt="game.title"
            cover
            class="romio-game__image"
          />
          <template v-else
            ><RIcon icon="mdi-controller" size="48" /><span class="mt-4">{{
              game.systemName
            }}</span></template
          >
          <RChip
            v-if="typeof game.rating === 'number' && game.ratingSource"
            class="romio-game__rating"
            size="small"
            >{{ Math.round(game.rating) }} · {{ game.ratingSource }}</RChip
          >
        </div>
        <div class="pa-4">
          <div class="romio-muted text-caption mb-2">{{ game.systemName }}</div>
          <RBtn
            class="romio-game__open"
            :data-focus-key="game.id"
            variant="text"
            block
            @click="selected = game"
            >{{ game.title }}</RBtn
          >
          <div class="romio-muted text-caption mt-2">
            {{ t("romio.copies-n", { n: game.sourceCount }) }}
          </div>
        </div>
      </RCard>
    </div>
    <RCard
      v-if="ready && manifest && !loading && !failed && !games.length"
      class="pa-8 text-center"
      ><RIcon icon="mdi-magnify" size="40" />
      <h2 class="mt-4">{{ t("common.no-results") }}</h2>
      <p class="mt-3">{{ t("romio.empty-hint") }}</p></RCard
    >
    <div v-if="hasMore || pageOffset" class="d-flex justify-center ga-3 mt-8">
      <RBtn
        v-if="pageOffset"
        :disabled="loading"
        variant="outlined"
        @click="filter('offset', String(Math.max(0, pageOffset - 48)))"
        >{{ t("common.previous-page") }}</RBtn
      ><RBtn
        v-if="hasMore"
        :loading="loading"
        variant="outlined"
        @click="filter('offset', String(offset))"
        >{{ t("common.next-page") }}</RBtn
      >
    </div>
    <RomioSettings
      v-if="settings"
      @close="settings = false"
      @connected="initialize"
    />
    <SourceDialog v-if="selected" :game="selected" @close="selected = null" />
  </div>
</template>

<style scoped>
.romio-discover {
  padding: 28px var(--r-row-pad) 64px;
}
.romio-discover__hero {
  padding: 36px 0 48px;
}
.romio-discover__eyebrow {
  color: var(--r-color-brand-primary);
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.romio-discover h1 {
  font-size: clamp(2.5rem, 5vw, 4.5rem);
  line-height: 1.1;
  margin: 16px 0;
  letter-spacing: -0.04em;
}
.romio-discover__subtitle,
.romio-muted {
  color: var(--r-color-fg-muted);
}
.romio-discover__subtitle {
  max-width: 42rem;
  font-size: 1.08rem;
}
.romio-discover__search {
  flex: 1 1 240px;
}
.romio-discover__system {
  flex: 0 1 290px;
}
.romio-discover__grid {
  display: grid;
  gap: 18px;
}
.romio-game {
  overflow: hidden;
  min-width: 0;
}
.romio-game__art {
  position: relative;
  aspect-ratio: 3 / 4;
  padding: 16px;
  text-align: center;
  color: var(--r-color-fg-muted);
  background: linear-gradient(
    145deg,
    color-mix(
      in srgb,
      var(--r-color-brand-primary) 22%,
      var(--r-color-bg-elevated)
    ),
    var(--r-color-bg-elevated)
  );
}
.romio-game__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.romio-game__rating {
  position: absolute;
  bottom: 10px;
  left: 10px;
}
.romio-game__open {
  min-height: 48px;
  height: auto;
  white-space: normal;
  justify-content: flex-start;
  padding: 0;
  text-align: left;
  font-weight: 650;
}
:global(html[data-bp~="xs"]) .romio-discover__hero {
  padding: 16px 0 28px;
}
:global(html[data-bp~="xs"]) .romio-discover__system {
  flex: 1 1 100%;
}
</style>
