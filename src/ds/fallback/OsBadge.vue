<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'primary' | 'secondary';
    text: string;
    color?: 'primary' | 'orange' | 'red' | 'green' | 'blue' | 'purple' | 'grey' | 'neutral';
  }>(),
  { type: 'primary', color: 'primary' },
);
</script>

<template>
  <span class="os-badge os-body-m" :class="[type, color]">{{ text }}</span>
</template>

<style scoped>
.os-badge { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 12px; white-space: nowrap; }
.os-badge.secondary { border-radius: 5px; padding: 4px; }
.primary { color: var(--os-primary-1000); background: var(--os-primary-t-100); }
.orange { color: var(--os-orange-1000); background: var(--os-orange-t-100); }
.red { color: var(--os-red-1000); background: var(--os-red-t-100); }
.green { color: var(--os-green-1000); background: var(--os-green-t-100); }
.blue { color: var(--os-blue-1000); background: var(--os-blue-t-100); }
.grey { color: var(--os-neutral-500); background: var(--os-neutral-t-50); }
.neutral { color: var(--os-neutral-300); background: #fff; outline: 1px solid var(--os-neutral-100); }
</style>
