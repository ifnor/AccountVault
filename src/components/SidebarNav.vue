<script setup lang="ts">
import { Folder } from "lucide-vue-next";

defineProps<{
  groups: Array<{ key: string | null; label: string; count: number }>;
  currentGroup: string | null;
}>();

const emit = defineEmits<{
  (e: "select-group", key: string | null): void;
}>();
</script>

<template>
  <aside class="hidden md:flex w-52 bg-slate-50/80 border-r border-slate-200/80 flex-col flex-shrink-0">
    <div class="px-4 pt-3.5 pb-2">
      <h2 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">分组视图</h2>
    </div>

    <div class="flex-1 overflow-y-auto px-2.5 pb-24 space-y-1">
      <button
        v-for="g in groups"
        :key="g.label"
        @click="emit('select-group', g.key)"
        :class="[
          'w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer',
          currentGroup === g.key
            ? 'bg-white text-[#1a73e8] font-semibold shadow-2xs ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
        ]"
      >
        <div class="flex items-center gap-2 truncate">
          <Folder class="w-3.5 h-3.5 flex-shrink-0" :class="currentGroup === g.key ? 'text-[#1a73e8]' : 'text-slate-400'" />
          <span class="truncate">{{ g.label }}</span>
        </div>
        <span
          :class="[
            'text-[11px] px-2 py-0.5 rounded-full font-mono',
            currentGroup === g.key ? 'bg-blue-50 text-[#1a73e8]' : 'bg-slate-200/60 text-slate-500'
          ]"
        >{{ g.count }}</span>
      </button>
    </div>
  </aside>
</template>
