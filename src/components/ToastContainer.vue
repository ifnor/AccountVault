<script setup lang="ts">
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-vue-next";
import type { ToastItem } from "../types/vault";

defineProps<{
  toasts: ToastItem[];
}>();
</script>

<template>
  <div class="fixed top-[calc(max(env(safe-area-inset-top,0px),38px)+16px)] md:top-5 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex flex-col gap-2.5 items-center max-w-lg w-full px-4">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto px-4 py-2.5 rounded-2xl shadow-xl border text-xs font-semibold flex items-center gap-2.5 backdrop-blur-xl select-text"
      :class="{
        'bg-emerald-50/95 text-emerald-900 border-emerald-300/80': toast.type === 'success',
        'bg-red-50/95 text-red-900 border-red-300/80': toast.type === 'error',
        'bg-amber-50/95 text-amber-900 border-amber-300/80': toast.type === 'warning',
        'bg-slate-900/90 text-white border-slate-700/60': toast.type === 'info'
      }"
    >
      <CheckCircle2 v-if="toast.type === 'success'" class="w-4 h-4 text-emerald-600 flex-shrink-0" />
      <AlertCircle v-else-if="toast.type === 'error'" class="w-4 h-4 text-red-600 flex-shrink-0" />
      <AlertTriangle v-else-if="toast.type === 'warning'" class="w-4 h-4 text-amber-600 flex-shrink-0" />
      <Info v-else class="w-4 h-4 text-blue-400 flex-shrink-0" />
      <span class="leading-normal">{{ toast.message }}</span>
    </div>
  </div>
</template>
