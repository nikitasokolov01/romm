<script setup lang="ts">
import { RAlert, RBtn, RDialog } from "@v2/lib";
import { useEventListener } from "@vueuse/core";
import { computed, nextTick, onMounted, onScopeDispose, ref } from "vue";
import { useI18n } from "vue-i18n";
import { onBeforeRouteLeave } from "vue-router";
import storePlaying from "@/stores/playing";
import { useUnloadGuard } from "@/v2/composables/useUnloadGuard";
import {
  playerDocument,
  type PlayerDocumentOptions,
} from "@/v2/components/Romio/playerDocument";

const props = defineProps<PlayerDocumentOptions>();
const emit = defineEmits<{ close: [] }>();
const dialogOpen = ref(true);
const { t } = useI18n();
const playingStore = storePlaying();
const frame = ref<HTMLIFrameElement | null>(null);
const failed = ref(false);
const started = ref(false);
const closing = ref(false);
const saveFailed = ref(false);
let flushResult: ((saved: boolean) => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const document = computed(() => playerDocument(props));
useUnloadGuard(started);

async function finishClose() {
  started.value = false;
  playingStore.setPlaying(false);
  dialogOpen.value = false;
  await nextTick();
  emit("close");
}

async function close(): Promise<boolean> {
  if (closing.value) return false;
  closing.value = true;
  if (started.value && frame.value?.contentWindow) {
    const saved = await new Promise<boolean>((resolve) => {
      flushResult = resolve;
      flushTimer = setTimeout(() => resolve(false), 8000);
      try {
        frame.value?.contentWindow?.postMessage(
          { type: "romio-save-and-close" },
          location.origin,
        );
      } catch {
        resolve(false);
      }
    });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    flushResult = null;
    if (!saved) {
      closing.value = false;
      saveFailed.value = true;
      return false;
    }
  }
  await finishClose();
  return true;
}

onBeforeRouteLeave(close);
onMounted(() => {
  playingStore.setPlaying(true);
  frame.value?.focus();
});
onScopeDispose(() => {
  if (flushTimer) clearTimeout(flushTimer);
  flushResult?.(false);
  playingStore.setPlaying(false);
});
useEventListener(window, "message", (event: MessageEvent) => {
  if (
    event.origin !== location.origin ||
    event.source !== frame.value?.contentWindow
  )
    return;
  if (event.data?.type === "romio-player-error") failed.value = true;
  if (event.data?.type === "romio-player-started") {
    started.value = true;
    frame.value?.focus();
  }
  if (event.data?.type === "romio-save-result")
    flushResult?.(event.data.ok === true);
});
</script>

<template>
  <RDialog
    :model-value="dialogOpen"
    width="1100px"
    full-height-on-mobile
    :persistent="closing"
    @close="close"
  >
    <template #header>{{ title }}</template>
    <template #content>
      <RAlert
        v-if="saveFailed"
        type="error"
        class="mb-3"
        :text="t('romio.save-failed')"
      />
      <RAlert
        v-if="failed"
        type="error"
        class="mb-3"
        :text="t('romio.browser-error')"
      />
      <RAlert
        v-else-if="!started"
        type="info"
        class="mb-3"
        :text="t('romio.browser-loading')"
      />
      <iframe
        ref="frame"
        class="romio-player__frame"
        :title="title"
        :srcdoc="document"
        data-gamepad-owner
        allow="fullscreen; gamepad; autoplay"
        referrerpolicy="no-referrer"
      />
    </template>
    <template #footer
      ><div class="d-flex flex-wrap ga-3">
        <RBtn variant="text" :loading="closing" @click="close">{{
          t("common.close")
        }}</RBtn
        ><RBtn
          v-if="saveFailed"
          variant="text"
          color="danger"
          @click="finishClose"
          >{{ t("romio.close-without-saving") }}</RBtn
        >
      </div></template
    >
  </RDialog>
</template>

<style scoped>
.romio-player__frame {
  width: 100%;
  height: min(68vh, 720px);
  border: 0;
  background: var(--r-color-canvas-bg);
}
</style>
