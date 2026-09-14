<script setup lang="ts">
import { RAlert, RBtn, RCard, RDialog, RForm, RTextField } from "@v2/lib";
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import romioApi from "@/services/api/romio";
import { useCan } from "@/v2/composables/useCan";
import { useIsAlive } from "@/v2/composables/useIsAlive";
import { useRomioDevice } from "@/v2/composables/useRomioDevice";
import { useSnackbar } from "@/v2/composables/useSnackbar";
import { required } from "@/v2/utils/validation";

const emit = defineEmits<{ close: []; connected: [] }>();
const dialogOpen = ref(true);
async function close() {
  dialogOpen.value = false;
  await nextTick();
  emit("close");
}
const { t } = useI18n();
const canAdmin = useCan("app.admin");
const snackbar = useSnackbar();
const alive = useIsAlive();
const device = useRomioDevice();
const link = ref("");
const code = ref("");
const connectionName = ref<string | null>(null);
const saving = ref(false);
const pairing = ref(false);
const deviceError = ref(false);
const metadataConfigured = ref(true);
const form = ref<InstanceType<typeof RForm> | null>(null);
const pairForm = ref<InstanceType<typeof RForm> | null>(null);

async function save() {
  if (!(await form.value?.validate())?.valid) return;
  const submittedLink = link.value.trim();
  link.value = "";
  saving.value = true;
  try {
    const { data } = await romioApi.connect(submittedLink);
    if (!alive.value) return;
    connectionName.value = data.name ?? null;
    emit("connected");
    snackbar.success(t("romio.connection-saved"));
  } catch {
    if (alive.value) snackbar.error(t("romio.request-failed"));
  } finally {
    if (alive.value) saving.value = false;
  }
}

async function refreshDevice() {
  deviceError.value = false;
  try {
    await device.refresh();
  } catch {
    if (alive.value) deviceError.value = true;
  }
}

async function pair() {
  if (!(await pairForm.value?.validate())?.valid) return;
  pairing.value = true;
  deviceError.value = false;
  const value = code.value.trim();
  code.value = "";
  try {
    await device.pair(value);
    if (alive.value) snackbar.success(t("romio.paired"));
  } catch {
    if (alive.value) deviceError.value = true;
  } finally {
    if (alive.value) pairing.value = false;
  }
}

onMounted(async () => {
  await refreshDevice();
  try {
    const { data } = await romioApi.connection();
    if (alive.value)
      connectionName.value = data.connected ? (data.name ?? null) : null;
    const metadata = await romioApi.metadata();
    if (alive.value) metadataConfigured.value = metadata.data.configured;
  } catch {
    if (alive.value) snackbar.error(t("romio.request-failed"));
  }
});
</script>

<template>
  <RDialog
    :model-value="dialogOpen"
    width="760px"
    scroll-content
    full-height-on-mobile
    @close="close"
  >
    <template #header>{{ t("common.settings") }} · Romio</template>
    <template #content>
      <RCard v-if="canAdmin" class="pa-5 mb-5">
        <h2 class="mb-3">{{ t("romio.connect-title") }}</h2>
        <RAlert
          v-if="connectionName"
          type="success"
          class="mb-4"
          :text="connectionName"
        />
        <p class="mb-4">{{ t("romio.connect-hint") }}</p>
        <RAlert
          v-if="!metadataConfigured"
          type="info"
          class="mb-4"
          :text="t('romio.metadata-hint')"
        />
        <RForm ref="form" @submit.prevent="save">
          <RTextField
            v-model="link"
            type="password"
            autocomplete="off"
            :label="t('romio.addon-link')"
            :rules="[required()]"
            class="mb-4"
          />
          <RBtn type="submit" color="primary" :loading="saving">{{
            t("common.save")
          }}</RBtn>
        </RForm>
      </RCard>
      <RAlert
        v-else
        type="info"
        class="mb-5"
        :text="t('romio.admin-required')"
      />
      <RCard class="pa-5">
        <h2 class="mb-3">{{ t("romio.device-title") }}</h2>
        <p class="mb-4">{{ t("romio.device-hint") }}</p>
        <code class="romio-settings__command"
          >desktop-companion/start.ps1 -OpenSettings</code
        >
        <RAlert
          v-if="deviceError"
          type="warning"
          class="my-4"
          :text="t('romio.device-offline')"
        />
        <RAlert
          v-if="device.status.value"
          type="success"
          class="my-4"
          :text="t('romio.paired')"
        />
        <RForm ref="pairForm" class="mt-5" @submit.prevent="pair">
          <RTextField
            v-model="code"
            type="password"
            autocomplete="one-time-code"
            :label="t('romio.pair-code')"
            :rules="[required()]"
            class="mb-4"
          />
          <div class="d-flex flex-wrap ga-3">
            <RBtn type="submit" color="primary" :loading="pairing">{{
              t("romio.pair")
            }}</RBtn
            ><RBtn
              variant="text"
              :loading="device.loading.value"
              @click="refreshDevice"
              >{{ t("romio.check-status") }}</RBtn
            >
          </div>
        </RForm>
        <template v-if="device.status.value">
          <h3 class="mt-6 mb-3">{{ t("romio.profiles") }}</h3>
          <RAlert
            v-if="!device.status.value.profiles.length"
            type="info"
            :text="t('romio.no-profiles')"
          />
          <p
            v-for="profile in device.status.value.profiles"
            :key="profile.id"
            class="mb-2"
          >
            {{ profile.label }} · {{ profile.systems.join(", ") }}
          </p>
        </template>
      </RCard>
    </template>
    <template #footer
      ><div class="d-flex flex-wrap ga-3 justify-space-between">
        <RBtn
          variant="text"
          href="https://github.com/nikitasokolov01/romm/tree/romio-remote-library"
          target="_blank"
          rel="noopener noreferrer"
          >AGPL-3.0 · {{ t("common.about-source-code") }}</RBtn
        ><RBtn variant="text" @click="close">{{ t("common.close") }}</RBtn>
      </div></template
    >
  </RDialog>
</template>

<style scoped>
.romio-settings__command {
  display: block;
  overflow-wrap: anywhere;
  padding: 12px;
  border-radius: var(--r-radius-card);
  background: var(--r-color-bg-elevated);
  color: var(--r-color-fg);
}
</style>
