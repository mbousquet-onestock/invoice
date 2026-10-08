<script setup lang="ts">
defineProps<{ tabs: { id: string; label: string }[] }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="os-tabs">
    <div class="os-tabs-list" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="os-tab os-body-l"
        :class="{ active: tab.id === model }"
        :aria-selected="tab.id === model"
        @click="model = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.os-tabs { display: flex; flex-direction: column; gap: 8px; }
.os-tabs-list { display: flex; flex-wrap: wrap; gap: 8px; }
.os-tab {
  display: flex; align-items: center; justify-content: center; padding: 8px 16px; min-height: 36px;
  border: none; border-radius: var(--os-radius); background: transparent; color: var(--os-neutral-200); cursor: pointer;
}
.os-tab:hover { background: var(--os-neutral-t-30); }
.os-tab.active { background: var(--os-primary-t-100); color: var(--os-primary-1000); }
</style>
