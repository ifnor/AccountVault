<script setup lang="ts">
import { AlertTriangle, Trash2, Info } from "lucide-vue-next";

defineProps<{
  state: {
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    type: "danger" | "warning" | "info";
    resolve: (value: boolean) => void;
  };
}>();
</script>

<template>
  <div v-if="state.visible" class="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
    <div class="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-4">
      <div class="flex items-start gap-3.5">
        <div
          class="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
          :class="{
            'bg-red-100 text-red-600': state.type === 'danger',
            'bg-amber-100 text-amber-700': state.type === 'warning',
            'bg-[#e8f0fe] text-[#1a73e8]': state.type === 'info'
          }"
        >
          <AlertTriangle v-if="state.type === 'warning'" class="w-5 h-5" />
          <Trash2 v-else-if="state.type === 'danger'" class="w-5 h-5" />
          <Info v-else class="w-5 h-5" />
        </div>
        <div class="flex-1">
          <h3 class="text-sm font-bold text-[#202124]">{{ state.title }}</h3>
          <p class="text-xs text-[#5f6368] mt-1.5 leading-relaxed whitespace-pre-wrap">{{ state.message }}</p>
        </div>
      </div>
      <div class="flex items-center justify-end gap-2.5 mt-2 pt-2 border-t border-[#f1f3f4]">
        <button @click="state.resolve(false)" class="px-4 py-2 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">
          {{ state.cancelText }}
        </button>
        <button
          @click="state.resolve(true)"
          class="px-4 py-2 text-white rounded-xl text-xs font-medium cursor-pointer"
          :class="{
            'bg-red-600 hover:bg-red-700': state.type === 'danger',
            'bg-amber-600 hover:bg-amber-700': state.type === 'warning',
            'bg-[#1a73e8] hover:bg-[#1557b0]': state.type === 'info'
          }"
        >
          {{ state.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
