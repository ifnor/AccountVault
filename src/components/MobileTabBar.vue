<script setup lang="ts">
import { Clock, KeyRound, Fingerprint } from "lucide-vue-next";

defineProps<{
  homeTab: "totp" | "passwords" | "passkeys";
  hiddenOnMobile: boolean;
}>();

const emit = defineEmits<{
  (e: "switch-tab", tab: "totp" | "passwords" | "passkeys"): void;
}>();
</script>

<template>
  <div
    :class="[
      'fixed bottom-5 md:bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none',
      hiddenOnMobile ? 'hidden md:block' : 'block'
    ]"
  >
    <nav
      class="pointer-events-auto w-[274px] md:w-[276px] bg-white/65 backdrop-blur-2xl border border-white/85 ring-1 ring-slate-900/5 shadow-[0_12px_36px_rgba(15,23,42,0.14),inset_0_1px_1px_rgba(255,255,255,0.95)] rounded-full p-1.5 md:p-1"
      aria-label="主导航"
    >
      <div class="relative grid grid-cols-3 items-center">
        <div
          class="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-br from-[#1a73e8]/95 to-[#4f46e5]/95 shadow-[0_4px_14px_rgba(26,115,232,0.38),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] pointer-events-none"
          :style="{
            transform:
              homeTab === 'totp'
                ? 'translateX(0%)'
                : homeTab === 'passwords'
                ? 'translateX(100%)'
                : 'translateX(200%)'
          }"
        ></div>

        <button
          type="button"
          @click="emit('switch-tab', 'totp')"
          :class="[
            'relative z-10 h-11 md:h-9 rounded-full text-[13px] md:text-xs font-semibold flex items-center justify-center gap-1.5 md:gap-1 transition-all duration-200 active:scale-95 cursor-pointer whitespace-nowrap',
            homeTab === 'totp' ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          ]"
        >
          <Clock class="w-4 h-4 md:w-3.5 md:h-3.5 transition-transform duration-200" :class="homeTab === 'totp' ? 'scale-110' : ''" />
          <span>OTP</span>
        </button>

        <button
          type="button"
          @click="emit('switch-tab', 'passwords')"
          :class="[
            'relative z-10 h-11 md:h-9 rounded-full text-[13px] md:text-xs font-semibold flex items-center justify-center gap-1.5 md:gap-1 transition-all duration-200 active:scale-95 cursor-pointer whitespace-nowrap',
            homeTab === 'passwords' ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          ]"
        >
          <KeyRound class="w-4 h-4 md:w-3.5 md:h-3.5 transition-transform duration-200" :class="homeTab === 'passwords' ? 'scale-110' : ''" />
          <span>密码</span>
        </button>

        <button
          type="button"
          @click="emit('switch-tab', 'passkeys')"
          :class="[
            'relative z-10 h-11 md:h-9 rounded-full text-[13px] md:text-xs font-semibold flex items-center justify-center gap-1.5 md:gap-1 transition-all duration-200 active:scale-95 cursor-pointer whitespace-nowrap',
            homeTab === 'passkeys' ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          ]"
        >
          <Fingerprint class="w-4 h-4 md:w-3.5 md:h-3.5 transition-transform duration-200" :class="homeTab === 'passkeys' ? 'scale-110' : ''" />
          <span>PassKey</span>
        </button>
      </div>
    </nav>
  </div>
</template>
