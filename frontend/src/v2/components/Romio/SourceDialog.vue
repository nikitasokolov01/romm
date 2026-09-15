<script setup lang="ts">
import {
  RAlert,
  RBtn,
  RCard,
  RChip,
  RDialog,
  RIcon,
  RProgressLinear,
  RSelect,
  RSpinner,
} from "@v2/lib";
import { useLocalStorage } from "@vueuse/core";
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import romioApi, {
  type RomioCandidate,
  type RomioGame,
  type RomioJob,
} from "@/services/api/romio";
import { companion, type CompanionJob } from "@/services/romio-companion";
import storeAuth from "@/stores/auth";
import {
  canPlayInBrowser,
  canPrepare,
  fileBasename,
  progressPercent,
  readSavedChoice,
  safeCode,
  sourceExtension,
  type SavedRomioChoice,
} from "@/v2/components/Romio/launchPolicy";
import RemotePlayer from "@/v2/components/Romio/RemotePlayer.vue";
import { useIsAlive } from "@/v2/composables/useIsAlive";
import { useRomioDevice } from "@/v2/composables/useRomioDevice";
import { useWrapGridNav } from "@/v2/composables/useWrapGridNav";

const props = defineProps<{ game: RomioGame }>();
const emit = defineEmits<{ close: [] }>();
const dialogOpen = ref(true);
async function close() {
  dialogOpen.value = false;
  await nextTick();
  emit("close");
}
const { t } = useI18n();
const alive = useIsAlive();
const device = useRomioDevice();
const auth = storeAuth();
const choice = useLocalStorage<SavedRomioChoice | null>(
  `romio-choice:${location.origin}:${auth.user?.id ?? "anonymous"}:${props.game.id}`,
  null,
  {
    writeDefaults: false,
    serializer: { read: readSavedChoice, write: JSON.stringify },
  },
);
const restoring = ref(false);
const candidates = ref<RomioCandidate[]>([]);
const selected = ref<RomioCandidate | null>(null);
const loading = ref(false);
const checking = ref(false);
const statusRetry = ref(false);
const busy = ref(false);
const attempted = ref(false);
const failed = ref(false);
const warnings = ref<string[]>([]);
const more = ref(false);
const offset = ref(0);
const job = ref<RomioJob | null>(null);
const nativeJob = ref<CompanionJob | null>(null);
const player = ref(false);
const profileId = ref("");
const sourceGrid = ref<HTMLElement | null>(null);
useWrapGridNav(sourceGrid, { cellSelector: ".romio-source__select" });
type Target = "browser" | "native" | "download";
let target: Target | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let launched = false;
let sourceVersion = 0;
const profiles = computed(
  () =>
    device.status.value?.profiles.filter((profile) =>
      profile.systems.includes(props.game.system),
    ) ?? [],
);
watch(
  profiles,
  (value) => {
    if (!value.some((profile) => profile.id === profileId.value))
      profileId.value = value[0]?.id ?? "";
  },
  { immediate: true },
);
const browserAllowed = computed(
  () => selected.value && canPlayInBrowser(props.game, selected.value),
);
const nativeReplayId = computed(() =>
  nativeJob.value?.state === "installed" ? nativeJob.value.id : null,
);
const nativeAllowed = computed(() => {
  const candidate = selected.value;
  const status = device.status.value;
  return (
    status &&
    profileId.value &&
    status.capabilities.systems.includes(props.game.system) &&
    (nativeReplayId.value ||
      (candidate &&
        status.capabilities.formats.includes(candidate.packaging || "raw") &&
        candidate.source.size <= status.capabilities.maxDownloadBytes))
  );
});
const prepareAllowed = computed(
  () => selected.value && canPrepare(selected.value),
);
const launchBlocked = computed(
  () =>
    restoring.value ||
    !prepareAllowed.value ||
    (job.value ? job.value.state !== "ready" : attempted.value),
);
const nativeLaunchBlocked = computed(
  () =>
    (restoring.value && !nativeReplayId.value) ||
    busy.value ||
    !nativeAllowed.value ||
    (nativeJob.value
      ? nativeJob.value.state !== "installed"
      : launchBlocked.value),
);
const canChangeCopy = computed(
  () =>
    !busy.value &&
    !restoring.value &&
    !player.value &&
    (!nativeJob.value ||
      ["installed", "failed"].includes(nativeJob.value.state)) &&
    (job.value
      ? ["ready", "failed"].includes(job.value.state)
      : Boolean(nativeJob.value)),
);
const size = (bytes: number) =>
  `${(bytes / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
const stateCode = computed(
  () => safeCode(nativeJob.value?.error) || safeCode(job.value?.error),
);
const percent = computed(() =>
  nativeJob.value
    ? progressPercent(
        (nativeJob.value.received / Math.max(1, nativeJob.value.total)) * 100,
      )
    : progressPercent((job.value?.progress ?? 0) * 100),
);
const state = computed(
  () => nativeJob.value?.state ?? job.value?.state ?? "submitting",
);
const providerStage = computed(() => {
  if (nativeJob.value) return null;
  switch (job.value?.stage) {
    case "account_lookup":
    case "inspect":
      return t("romio.state-reconciling");
    case "source_metadata":
      return t("romio.stage-source-metadata");
    case "provider_submit":
      return t("romio.stage-provider-submit");
    case "provider_sync":
      return t("romio.stage-provider-sync");
    case "verify_file":
      return t("romio.stage-verify-file");
    default:
      return null;
  }
});
function formatTimestamp(timestamp: number | null | undefined) {
  return timestamp && Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString()
    : null;
}
const checkedTime = computed(() => formatTimestamp(job.value?.checkedAt));
const providerUpdatedTime = computed(() =>
  formatTimestamp(job.value?.providerUpdatedAt),
);

async function loadSources() {
  loading.value = true;
  failed.value = false;
  try {
    const { data } = await romioApi.sources(props.game.id, offset.value);
    if (!alive.value) return;
    candidates.value = [
      ...new Map(
        [...candidates.value, ...data.items].map((candidate) => [
          candidate.id,
          candidate,
        ]),
      ).values(),
    ];
    if (!selected.value)
      selected.value =
        candidates.value.find(canPrepare) ?? candidates.value[0] ?? null;
    more.value = data.hasMore;
    offset.value = data.offset + 100;
    warnings.value = data.warnings
      .map(safeCode)
      .filter((code): code is string => code !== null);
  } catch {
    if (alive.value) failed.value = true;
  } finally {
    if (alive.value) loading.value = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (alive.value) timer = setTimeout(() => void checkStatus(), 7000);
}

async function useExistingNative(
  sourceId: string,
  launchInstalled: boolean,
): Promise<boolean> {
  const version = sourceVersion;
  const token = device.token.value;
  const selectedProfile = profileId.value;
  let existing: CompanionJob;
  try {
    existing = await companion.job(token, sourceId);
  } catch {
    return false;
  }
  if (!alive.value || version !== sourceVersion) return true;
  if (existing.id !== sourceId) throw new Error("COMPANION_SOURCE_MISMATCH");
  nativeJob.value = existing;
  if (existing.state === "installed" && launchInstalled) {
    await companion.launch(token, sourceId, selectedProfile);
  } else if (["downloading", "extracting"].includes(existing.state)) schedule();
  return (
    existing.state === "installed" || !launchInstalled || Boolean(job.value)
  );
}

async function launch(destination: Target) {
  if (
    !job.value ||
    job.value.state !== "ready" ||
    !selected.value ||
    busy.value
  )
    return;
  busy.value = true;
  failed.value = false;
  const current = job.value;
  const candidate = selected.value;
  try {
    if (destination === "browser") {
      if (!browserAllowed.value) return;
      player.value = true;
    } else if (destination === "download") {
      const anchor = document.createElement("a");
      anchor.href = romioApi.contentUrl(current.id);
      anchor.rel = "noreferrer";
      anchor.download = fileBasename(candidate);
      anchor.click();
    } else {
      if (!nativeAllowed.value) return;
      if (await useExistingNative(candidate.id, true)) return;
      const token = device.token.value;
      const selectedProfile = profileId.value;
      const { data } = await romioApi.link(current.id);
      if (!alive.value) return;
      const result = await companion.install(token, {
        sourceId: candidate.id,
        title: fileBasename(candidate),
        system: props.game.system,
        size: candidate.source.size,
        sha256: /^[a-f0-9]{64}$/.test(candidate.source.sha256)
          ? candidate.source.sha256
          : "",
        packaging: candidate.packaging === "zip" ? "zip" : "raw",
        downloadUrl: data.url,
        launch: true,
        profileId: selectedProfile,
      });
      if (!alive.value) return;
      nativeJob.value = result;
      if (result.state === "downloading" || result.state === "extracting")
        schedule();
    }
  } catch {
    if (alive.value) failed.value = true;
  } finally {
    if (alive.value) busy.value = false;
  }
}

async function advance() {
  if (job.value?.state === "ready") {
    if (target && !launched) {
      launched = true;
      await launch(target);
    }
  } else if (job.value && job.value.state !== "failed") schedule();
}

async function prepare(destination: Target) {
  if (
    busy.value ||
    (restoring.value && !(destination === "native" && nativeReplayId.value))
  )
    return;
  if (destination === "native" && nativeAllowed.value) {
    const sourceId = nativeReplayId.value ?? selected.value?.id;
    if (sourceId) {
      busy.value = true;
      failed.value = false;
      try {
        if (await useExistingNative(sourceId, true)) return;
      } catch {
        if (alive.value) failed.value = true;
        return;
      } finally {
        if (alive.value) busy.value = false;
      }
    }
  }
  if (!selected.value || !prepareAllowed.value) return;
  if (job.value) {
    await launch(destination);
    return;
  }
  if (attempted.value) return;
  attempted.value = true;
  busy.value = true;
  failed.value = false;
  target = destination;
  const candidate = selected.value;
  try {
    const { data } = await romioApi.acquire(candidate.id);
    if (!alive.value) return;
    job.value = data;
    choice.value = { candidateId: data.candidate.id, jobId: data.id };
  } catch {
    if (alive.value) failed.value = true;
  } finally {
    if (alive.value) busy.value = false;
  }
  if (alive.value) await advance();
}

async function checkStatus() {
  if (checking.value) return;
  if (timer) clearTimeout(timer);
  checking.value = true;
  statusRetry.value = false;
  failed.value = false;
  try {
    if (nativeJob.value) {
      const id = nativeJob.value.id;
      const result = await companion.job(device.token.value, id);
      if (!alive.value || nativeJob.value?.id !== id) return;
      nativeJob.value = result;
      if (result.state === "downloading" || result.state === "extracting")
        schedule();
    } else if (job.value) {
      const id = job.value.id;
      const { data } = await romioApi.job(id);
      if (!alive.value || job.value?.id !== id) return;
      job.value = data;
      await advance();
    } else if (choice.value) {
      await restoreChoice();
    }
  } catch {
    if (alive.value) {
      statusRetry.value = true;
      schedule();
    }
  } finally {
    if (alive.value) checking.value = false;
  }
}

async function resume() {
  if (!job.value || nativeJob.value?.state !== "paused") return;
  busy.value = true;
  try {
    const { data } = await romioApi.link(job.value.id);
    if (!alive.value) return;
    const result = await companion.resume(
      device.token.value,
      nativeJob.value.id,
      data.url,
    );
    if (!alive.value) return;
    nativeJob.value = result;
    schedule();
  } catch {
    if (alive.value) failed.value = true;
  } finally {
    if (alive.value) busy.value = false;
  }
}

async function restoreChoice() {
  const saved = choice.value;
  if (!saved) {
    await loadSources();
    return;
  }
  restoring.value = true;
  attempted.value = true;
  try {
    const { data } = await romioApi.job(saved.jobId);
    if (!alive.value) return;
    if (
      data.candidate.id !== saved.candidateId ||
      data.candidate.system !== props.game.system
    ) {
      choice.value = null;
      attempted.value = false;
      await loadSources();
      return;
    }
    selected.value = data.candidate;
    job.value = data;
    await advance();
  } catch {
    if (alive.value) {
      failed.value = true;
      statusRetry.value = true;
      schedule();
    }
  } finally {
    if (alive.value) restoring.value = false;
  }
}

async function chooseAnotherCopy() {
  if (!canChangeCopy.value) return;
  sourceVersion++;
  if (timer) clearTimeout(timer);
  timer = null;
  choice.value = null;
  job.value = null;
  nativeJob.value = null;
  selected.value = null;
  candidates.value = [];
  attempted.value = false;
  target = null;
  launched = false;
  offset.value = 0;
  more.value = false;
  warnings.value = [];
  statusRetry.value = false;
  await loadSources();
}

onMounted(() => {
  void restoreChoice();
  void device
    .refresh()
    .then(async () => {
      const saved = choice.value;
      if (alive.value && saved && device.status.value) {
        await useExistingNative(saved.candidateId, false);
      }
    })
    .catch(() => undefined);
});
onScopeDispose(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <RDialog
    :model-value="dialogOpen"
    width="900px"
    scroll-content
    full-height-on-mobile
    @close="close"
  >
    <template #header>{{ game.title }}</template>
    <template #content>
      <RAlert
        v-if="statusRetry"
        type="warning"
        class="mb-4"
        :text="t('romio.status-retry')"
      />
      <div class="d-flex align-center flex-wrap ga-3 mb-5">
        <RChip>{{ game.systemName }}</RChip
        ><span>{{ t("romio.select-copy") }}</span>
      </div>
      <RAlert
        v-if="failed"
        type="error"
        class="mb-4"
        :text="t('romio.request-failed')"
      />
      <RBtn
        v-if="failed && choice && !job"
        variant="text"
        @click="restoreChoice"
        >{{ t("romio.check-status") }}</RBtn
      >
      <RAlert
        v-if="attempted && !job && !nativeJob && !busy"
        type="warning"
        class="mb-4"
        :text="t('romio.uncertain')"
      />
      <RAlert
        v-if="warnings.length"
        type="warning"
        class="mb-4"
        :text="
          warnings
            .map((code) =>
              code === 'INDIVIDUAL_FILES_UNAVAILABLE'
                ? t('romio.individual-files-unavailable')
                : code,
            )
            .join(' ')
        "
      />
      <RSpinner v-if="restoring || (loading && !candidates.length)" />
      <p v-if="!restoring && !loading && !candidates.length && !job && !choice">
        {{ t("common.no-results") }}
      </p>
      <div v-if="!job" ref="sourceGrid" class="d-flex flex-column ga-3">
        <RCard
          v-for="candidate in candidates"
          :key="candidate.id"
          class="pa-4"
          :color="selected?.id === candidate.id ? 'primary' : undefined"
          :variant="selected?.id === candidate.id ? 'outlined' : 'flat'"
        >
          <div class="d-flex justify-space-between ga-3">
            <RBtn
              class="romio-source__select"
              variant="text"
              :aria-pressed="selected?.id === candidate.id"
              :disabled="busy || attempted"
              @click="selected = candidate"
              >{{ candidate.title }}</RBtn
            >
            <RIcon
              v-if="selected?.id === candidate.id"
              icon="mdi-check-circle"
              color="primary"
            />
          </div>
          <div class="d-flex flex-wrap ga-2 mt-3">
            <RChip size="small"
              >{{ candidate.region }} · {{ candidate.revision }}</RChip
            >
            <RChip size="small"
              >{{ size(candidate.source.size) }} ·
              {{ candidate.packaging?.toUpperCase() || t("romio.raw") }}</RChip
            >
            <RChip
              size="small"
              :color="candidate.cached ? 'success' : undefined"
              >{{
                t(
                  candidate.cached === true
                    ? "romio.cached"
                    : candidate.cached === false
                      ? "romio.not-cached"
                      : "romio.cache-unknown",
                )
              }}</RChip
            >
          </div>
          <p class="text-caption mt-3 romio-source__path">
            {{ candidate.source.filePath }}
          </p>
          <p class="text-caption mt-2">
            {{ candidate.collectionLabel || candidate.origin }}
          </p>
          <RAlert
            v-if="!canPrepare(candidate)"
            class="mt-3"
            type="info"
            :text="t('romio.cache-only')"
          />
        </RCard>
      </div>
      <RBtn
        v-if="more && !job"
        :loading="loading"
        variant="text"
        class="mt-4"
        @click="loadSources"
        >{{ t("common.next-page") }}</RBtn
      >
      <RCard v-if="job || nativeJob" class="pa-5 mb-4">
        <h3 class="mb-3">{{ selected?.title || game.title }}</h3>
        <div class="d-flex justify-space-between mb-3" role="status">
          <span>{{ providerStage ?? t(`romio.state-${state}`) }}</span
          ><span v-if="!providerStage">{{ Math.round(percent) }}%</span>
        </div>
        <RProgressLinear
          :model-value="percent"
          :indeterminate="
            state === 'submitting' ||
            state === 'reconciling' ||
            state === 'extracting' ||
            Boolean(providerStage)
          "
          :aria-label="t('romio.preparing')"
        />
        <p v-if="stateCode" class="mt-3">{{ stateCode }}</p>
        <p v-if="checkedTime && !nativeJob" class="text-caption mt-3">
          {{ t("romio.last-checked", { time: checkedTime }) }}
        </p>
        <p v-if="providerUpdatedTime && !nativeJob" class="text-caption mt-3">
          {{ t("romio.provider-updated", { time: providerUpdatedTime }) }}
        </p>
        <p
          v-if="
            job?.state === 'downloading' &&
            !nativeJob &&
            percent === 0 &&
            checkedTime &&
            !providerStage
          "
          class="text-caption mt-3"
        >
          {{ t("romio.progress-delayed") }}
        </p>
        <p class="text-caption mt-4">{{ t("romio.close-progress") }}</p>
        <div class="d-flex ga-3 mt-4">
          <RBtn variant="text" :loading="checking" @click="checkStatus">{{
            t("romio.check-status")
          }}</RBtn
          ><RBtn
            v-if="nativeJob?.state === 'paused'"
            :loading="busy"
            @click="resume"
            >{{ t("romio.resume") }}</RBtn
          >
        </div>
      </RCard>
      <RBtn v-if="canChangeCopy" variant="text" @click="chooseAnotherCopy">{{
        t("romio.choose-another-copy")
      }}</RBtn>
      <RSelect
        v-if="profiles.length"
        v-model="profileId"
        class="my-5"
        :items="profiles"
        item-title="label"
        item-value="id"
        :label="t('romio.profiles')"
        :disabled="busy || !!nativeJob"
      />
      <RAlert
        v-if="!device.status.value || !profiles.length"
        type="info"
        class="mt-4"
        :text="t('romio.native-setup')"
      />
      <p class="text-caption mt-4">{{ t("romio.unverified") }}</p>
      <p v-if="selected && !browserAllowed" class="text-caption mt-3">
        {{ t("romio.browser-limit") }}
      </p>
    </template>
    <template #footer>
      <div class="d-flex flex-wrap ga-3">
        <RBtn
          v-if="browserAllowed"
          color="primary"
          prepend-icon="mdi-play"
          :loading="busy"
          :disabled="launchBlocked"
          @click="prepare('browser')"
          >{{ t("romio.browser") }}</RBtn
        >
        <RBtn
          v-if="nativeAllowed"
          color="primary"
          prepend-icon="mdi-desktop-classic"
          :loading="busy"
          :disabled="nativeLaunchBlocked"
          @click="prepare('native')"
          >{{ t("romio.native") }}</RBtn
        >
        <RBtn
          prepend-icon="mdi-download"
          variant="outlined"
          :loading="busy"
          :disabled="launchBlocked"
          @click="prepare('download')"
          >{{ t("common.download") }}</RBtn
        >
      </div>
    </template>
  </RDialog>
  <RemotePlayer
    v-if="player && game.browserCore && job && selected"
    :core="game.browserCore"
    :acquisition-id="job.id"
    :candidate-id="selected.id"
    :user-id="auth.user?.id ?? 0"
    :extension="sourceExtension(selected)"
    :title="game.title"
    @close="player = false"
  />
</template>

<style scoped>
.romio-source__select {
  height: auto;
  min-height: 44px;
  text-align: left;
  white-space: normal;
  justify-content: flex-start;
  padding: 0;
}
.romio-source__path {
  overflow-wrap: anywhere;
  color: var(--r-color-fg-muted);
}
</style>
