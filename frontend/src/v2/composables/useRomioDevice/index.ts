import { useLocalStorage } from "@vueuse/core";
import { ref } from "vue";
import storeAuth from "@/stores/auth";
import { companion, type CompanionStatus } from "@/services/romio-companion";
import { useIsAlive } from "@/v2/composables/useIsAlive";

export function useRomioDevice() {
  const auth = storeAuth();
  const alive = useIsAlive();
  const token = useLocalStorage<string>(
    `romio-companion:${location.origin}:${auth.user?.id ?? "anonymous"}`,
    "",
    { writeDefaults: false },
  );
  const status = ref<CompanionStatus | null>(null);
  const loading = ref(false);

  async function refresh() {
    status.value = null;
    if (!token.value) return;
    loading.value = true;
    try {
      const result = await companion.status(token.value);
      if (alive.value) status.value = result;
    } finally {
      if (alive.value) loading.value = false;
    }
  }

  async function pair(code: string) {
    const result = await companion.pair(code);
    if (!alive.value) return;
    token.value = result.token;
    await refresh();
  }

  return { token, status, loading, refresh, pair };
}
