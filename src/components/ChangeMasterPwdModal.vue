<script setup lang="ts">
import { KeyRound, X, RefreshCw } from "lucide-vue-next";

defineProps<{
  visible: boolean;
  isChanging: boolean;
  form: {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  };
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "submit"): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-[9995] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
    <div class="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-4">
      <div class="flex items-center justify-between pb-2 border-b border-[#f1f3f4]">
        <div class="flex items-center gap-2">
          <KeyRound class="w-4 h-4 text-[#1a73e8]" />
          <h3 class="text-sm font-bold text-[#202124]">修改安全库主密码</h3>
        </div>
        <button @click="emit('close')" class="p-1.5 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]"><X class="w-4 h-4" /></button>
      </div>

      <form @submit.prevent="emit('submit')" class="space-y-3.5">
        <div>
          <label class="block text-xs font-semibold text-[#5f6368] mb-1">当前原主密码 *</label>
          <input type="password" required v-model="form.oldPassword" placeholder="请输入当前正在使用的主密码..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-[#5f6368] mb-1">新主密码 *</label>
          <input type="password" required v-model="form.newPassword" placeholder="请输入新的主密码..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-[#5f6368] mb-1">确认新主密码 *</label>
          <input type="password" required v-model="form.confirmPassword" placeholder="请再次输入新主密码..." class="w-full px-3 py-2.5 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none" />
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#f1f3f4]">
          <button type="button" @click="emit('close')" :disabled="isChanging" class="px-4 py-2 bg-[#f1f3f4] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">取消</button>
          <button type="submit" :disabled="isChanging" class="px-5 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
            <RefreshCw v-if="isChanging" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ isChanging ? "正在重新加密..." : "确认修改并重新加密" }}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
