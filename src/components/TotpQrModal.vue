<script setup lang="ts">
import { X } from "lucide-vue-next";
import type { TotpQrResult } from "../types/vault";

defineProps<{
  visible: boolean;
  data: TotpQrResult | null;
  subtitle: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "copy", text: string, fieldKey: string, label: string): void;
}>();
</script>

<template>
  <div v-if="visible && data" class="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
    <div class="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col items-center gap-4 text-center">
      <div class="w-full flex items-center justify-between pb-2 border-b border-[#f1f3f4]">
        <div class="text-left">
          <h3 class="text-sm font-bold text-[#202124]">2FA 转移二维码</h3>
          <p class="text-[11px] text-[#5f6368] truncate max-w-[220px]">{{ subtitle }}</p>
        </div>
        <button @click="emit('close')" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]"><X class="w-4 h-4" /></button>
      </div>
      <div class="p-3 bg-white border-2 border-[#dadce0] rounded-2xl shadow-xs">
        <img :src="data.qr_base64" alt="2FA TOTP QR Code" class="w-48 h-48 object-contain" />
      </div>
      <div class="w-full bg-[#f8fafd] p-2.5 rounded-xl border border-[#dadce0]/80 flex items-center justify-between gap-2 text-xs">
        <span class="font-mono text-[11px] text-[#202124] truncate select-all">{{ data.secret }}</span>
        <button type="button" @click="emit('copy', data.secret, 'qr_secret', '已复制 Base32 密钥')" class="px-2.5 py-1 bg-white hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#dadce0] rounded-lg text-[11px] font-medium cursor-pointer">复制密钥</button>
      </div>
      <div class="w-full flex items-center justify-end gap-2 pt-1">
        <button type="button" @click="emit('copy', data.otpauth_url, 'qr_uri', '已复制 otpauth:// 链接')" class="px-3.5 py-2 bg-[#f1f3f4] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">复制 otpauth 链接</button>
        <button type="button" @click="emit('close')" class="px-5 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">完成</button>
      </div>
    </div>
  </div>
</template>
