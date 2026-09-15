<script setup lang="ts">
import { RBtn, RChip, RIcon, RImg } from "@v2/lib";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RomioGame } from "@/services/api/romio";
import { hasAttributedRating } from "@/v2/components/Romio/discoverMode";

const props = defineProps<{ game: RomioGame; focusKey: string }>();
defineEmits<{ select: [game: RomioGame] }>();
const { t } = useI18n();
const artFailed = ref(false);
watch(
  () => props.game.coverUrl,
  () => {
    artFailed.value = false;
  },
);
const rated = computed(() => hasAttributedRating(props.game));
</script>

<template>
  <article class="romio-game">
    <div class="romio-game__art">
      <RImg
        v-if="game.coverUrl && !artFailed"
        :src="game.coverUrl"
        :alt="game.title"
        contain
        width="100%"
        height="100%"
        @error="artFailed = true"
      />
      <div
        v-else
        class="romio-game__placeholder d-flex flex-column align-center justify-center ga-3"
      >
        <RIcon icon="mdi-controller" size="40" />
        <span>{{ game.systemName }}</span>
      </div>
      <RChip v-if="rated" class="romio-game__rating" size="small">
        <RIcon icon="mdi-star" size="14" /> {{ Math.round(game.rating!) }} ·
        {{ game.ratingSource }}
      </RChip>
    </div>
    <div class="pt-3">
      <p class="romio-game__system">{{ game.systemName }}</p>
      <RBtn
        class="romio-game__open"
        :data-focus-key="focusKey"
        variant="text"
        block
        @click="$emit('select', game)"
        >{{ game.title }}</RBtn
      >
      <p class="romio-game__copies">
        {{ t("romio.copies-n", { n: game.sourceCount }) }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.romio-game {
  position: relative;
  min-width: 0;
}
.romio-game__art {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: var(--r-radius-card);
  background: var(--r-color-cover-placeholder);
  box-shadow: 0 4px 16px color-mix(in srgb, black 12%, transparent);
}
.romio-game__placeholder {
  height: 100%;
  padding: 20px;
  text-align: center;
  color: var(--r-color-fg-muted);
  background: linear-gradient(
    140deg,
    color-mix(
      in srgb,
      var(--r-color-brand-primary) 16%,
      var(--r-color-bg-elevated)
    ),
    var(--r-color-bg-elevated)
  );
}
.romio-game__rating {
  position: absolute;
  bottom: 10px;
  left: 10px;
}
.romio-game__system,
.romio-game__copies {
  color: var(--r-color-fg-muted);
  font-size: 0.76rem;
}
.romio-game__system {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.romio-game__open {
  position: static;
  min-height: 44px;
  height: auto;
  padding: 4px 0;
  white-space: normal;
  justify-content: flex-start;
  text-align: left;
  font-weight: 650;
  line-height: 1.35;
}
.romio-game__open::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--r-radius-card);
}
.romio-game:has(.romio-game__open:hover) .romio-game__art {
  box-shadow: 0 6px 22px
    color-mix(in srgb, var(--r-color-brand-primary) 25%, transparent);
}
</style>
