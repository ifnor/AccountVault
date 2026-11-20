<script setup lang="ts">
import { AlertCircle, Unlock, Fingerprint } from "lucide-vue-next";

defineProps<{
  vaultExists: boolean;
  masterPassword: string;
  unlockError: string;
  isSubmitting: boolean;
  helloStatus: { available: boolean; enrolled: boolean };
  isHelloVerifying: boolean;
  isMobilePlatform: boolean;
}>();

const emit = defineEmits<{
  (e: "update:masterPassword", value: string): void;
  (e: "submit"): void;
  (e: "helloUnlock"): void;
}>();
</script>

<template>
  <div class="flex-1 flex items-center justify-center p-6 relative">
    <div class="w-full max-w-md bg-white rounded-3xl p-8 shadow-sm border border-[#dadce0]/70 flex flex-col items-center">
      <div class="w-16 h-16 rounded-2xl bg-white shadow-sm border border-[#dadce0]/70 flex items-center justify-center mb-5 p-1.5 overflow-hidden">
        <img src="/logo.png" alt="账号管家 Logo" class="w-full h-full object-contain" />
      </div>
      <h1 class="text-2xl font-bold tracking-tight text-[#202124] mb-1">账号管家</h1>
      <p class="text-xs text-[#5f6368] mb-6">Account Vault · 通用多平台加密安全库</p>

      <form @submit.prevent="emit('submit')" class="w-full flex flex-col gap-4">
        <div>
          <label class="block text-xs font-semibold text-[#5f6368] uppercase tracking-wider mb-2">
            {{ vaultExists ? "输入主密码解锁" : "设置主密码初始化安全库" }}
          </label>
          <div class="relative">
            <input
              type="password"
              :value="masterPassword"
              @input="emit('update:masterPassword', ($event.target as HTMLInputElement).value)"
              autofocus
              placeholder="请输入主解锁密码..."
              class="w-full px-4 py-3 bg-[#f1f3f4] hover:bg-[#e8eaed] focus:bg-white rounded-xl border-2 border-transparent focus:border-[#1a73e8] outline-none text-[#202124] transition-all text-sm"
            />
          </div>
        </div>

        <div v-if="unlockError" class="p-3 bg-red-50 text-red-600 rounded-xl text-xs flex items-center gap-2 border border-red-200">
          <AlertCircle class="w-4 h-4 flex-shrink-0" />
          <span>{{ unlockError }}</span>
        </div>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="w-full mt-2 py-3.5 bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#174ea6] text-white font-medium rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
        >
          <Unlock class="w-4 h-4" />
          <span>{{ isSubmitting ? "正在验证..." : (vaultExists ? "解锁保险库" : "创建并开启保险库") }}</span>
        </button>
      </form>

      <div v-if="helloStatus.enrolled && vaultExists" class="w-full flex flex-col items-center mt-3">
        <div class="w-full flex items-center my-2 text-xs text-[#80868b]">
          <div class="flex-1 border-t border-[#dadce0]"></div>
          <span class="px-3">或</span>
          <div class="flex-1 border-t border-[#dadce0]"></div>
        </div>

        <button
          type="button"
          @click="emit('helloUnlock')"
          :disabled="isHelloVerifying || isSubmitting"
          class="w-full py-3 bg-[#e8f0fe] hover:bg-[#d2e3fc] active:bg-[#c2dcff] text-[#1a73e8] font-medium rounded-xl transition-all flex items-center justify-center gap-2.5 text-sm border border-[#1a73e8]/30 shadow-sm cursor-pointer"
        >
          <Fingerprint class="w-5 h-5 text-[#1a73e8]" />
          <span>{{ isHelloVerifying ? (isMobilePlatform ? "请在手机弹窗中完成验证..." : "请在 Windows 弹窗中完成验证...") : (isMobilePlatform ? "快速解锁" : "使用 Windows Hello / PIN 快速解锁") }}</span>
        </button>
      </div>

      <div v-else-if="helloStatus.available && vaultExists" class="w-full mt-4 px-3.5 py-2.5 bg-[#f8fafd] border border-[#dadce0] rounded-xl text-xs text-[#5f6368] flex items-center gap-2">
        <Fingerprint class="w-4 h-4 text-[#1a73e8] flex-shrink-0" />
        <span>{{ isMobilePlatform ? "手机支持生物识别与锁屏密码，首次主密码解锁后可在设置中一键绑定快速登录。" : "本机支持 Windows Hello，首次主密码解锁后可在设置中一键绑定指纹/PIN快速登录。" }}</span>
      </div>
    </div>
  </div>
</template>
