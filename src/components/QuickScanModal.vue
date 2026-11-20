<script setup lang="ts">
import { ref, watch } from "vue";
import { QrCode, X, Upload } from "lucide-vue-next";

defineProps<{
  visible: boolean;
  cameraActive: boolean;
  cameraError: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "paste", ev: ClipboardEvent): void;
  (e: "pick-image"): void;
  (e: "video-el", el: HTMLVideoElement | null): void;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
watch(videoRef, (el) => {
  emit("video-el", el);
});
</script>

<template>
  <div
    v-if="visible"
    @paste="emit('paste', $event)"
    class="fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
  >
    <div class="w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 flex flex-col gap-3.5">
      <div class="flex items-center justify-between pb-2 border-b border-slate-100">
        <div class="flex items-center gap-2">
          <QrCode class="w-4 h-4 text-[#1a73e8]" />
          <h3 class="text-sm font-bold text-slate-900">扫码添加 TOTP / PassKey</h3>
        </div>
        <button type="button" @click="emit('close')" class="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 cursor-pointer">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="w-full aspect-square max-h-64 bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center relative">
        <video v-if="cameraActive" ref="videoRef" playsinline muted class="w-full h-full object-cover"></video>
        <div v-else class="p-6 text-center text-xs text-slate-300 space-y-2">
          <QrCode class="w-10 h-10 mx-auto text-slate-400" />
          <div>{{ cameraError || "正在请求摄像头权限..." }}</div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-1">
        <button type="button" @click="emit('pick-image')" class="px-4 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
          <Upload class="w-3.5 h-3.5" />
          <span>从图片/截屏识别</span>
        </button>
        <button type="button" @click="emit('close')" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium cursor-pointer">
          取消
        </button>
      </div>
    </div>
  </div>
</template>
