<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ primaryText?: string | string[]; secondaryText?: string | string[]; tertiaryText?: string | string[] }>(),
  { primaryText: () => [], secondaryText: () => [], tertiaryText: () => [] },
);
const list = (value: string | string[]) => (Array.isArray(value) ? value : [value]);
const primary = computed(() => list(props.primaryText));
const secondary = computed(() => list(props.secondaryText));
const tertiary = computed(() => list(props.tertiaryText));
</script>

<template>
  <div class="os-text-block">
    <div v-for="(text, i) in primary" :key="`p${i}`" class="os-label-l">{{ text }}</div>
    <div v-for="(text, i) in secondary" :key="`s${i}`" class="os-label-m">{{ text }}</div>
    <div v-for="(text, i) in tertiary" :key="`t${i}`" class="os-label-s">{{ text }}</div>
  </div>
</template>

<style scoped>
.os-text-block { display: flex; flex-direction: column; }
.os-text-block > div { overflow-wrap: anywhere; }
.os-label-l, .os-label-m { color: var(--os-neutral-700); }
.os-label-s { color: var(--os-neutral-300); }
</style>
