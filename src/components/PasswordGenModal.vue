<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, X, RefreshCw, Copy, Sparkles } from "lucide-vue-next";
import { useToast } from "../composables/useToast";

const props = defineProps<{
  visible: boolean;
  currentAccountTitle?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "copy", password: string): void;
  (e: "apply", password: string): void;
}>();

const { notify } = useToast();

const pwdGenForm = ref({
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  exclude_ambiguous: false
});
const generatedPassword = ref("");

async function generateNewPassword() {
  try {
    generatedPassword.value = await invoke<string>("generate_custom_pwd", {
      options: pwdGenForm.value
    });
  } catch (err: any) {
    notify("生成密码失败: " + err, "error");
  }
}

function applyPwdPreset(preset: "strong" | "alphanumeric" | "pin" | "max") {
  if (preset === "strong") {
    pwdGenForm.value = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, exclude_ambiguous: false };
  } else if (preset === "alphanumeric") {
    pwdGenForm.value = { length: 18, uppercase: true, lowercase: true, numbers: true, symbols: false, exclude_ambiguous: false };
  } else if (preset === "pin") {
    pwdGenForm.value = { length: 6, uppercase: false, lowercase: false, numbers: true, symbols: false, exclude_ambiguous: false };
  } else if (preset === "max") {
    pwdGenForm.value = { length: 32, uppercase: true, lowercase: true, numbers: true, symbols: true, exclude_ambiguous: true };
  }
  generateNewPassword();
}

const passwordStrength = computed(() => {
  const p = generatedPassword.value;
  if (!p) return { score: 0, text: "无", color: "bg-gray-300", textCol: "text-gray-500", percent: "0%" };
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 16) score += 1;
  if (p.length >= 24) score += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
  if (/\d/.test(p)) score += 1;
  if (/[!@#$%&*+\-=?_]/.test(p)) score += 1;

  if (score <= 2) return { score: 1, text: "较弱", color: "bg-red-500", textCol: "text-red-600", percent: "25%" };
  if (score <= 4) return { score: 2, text: "中等", color: "bg-amber-500", textCol: "text-amber-600", percent: "50%" };
  if (score <= 5) return { score: 3, text: "高强度", color: "bg-blue-500", textCol: "text-blue-600", percent: "75%" };
  return { score: 4, text: "极强 (军工级强随机)", color: "bg-emerald-500", textCol: "text-emerald-600", percent: "100%" };
});

watch(
  () => props.visible,
  (val) => {
    if (val) {
      generateNewPassword();
    }
  }
);
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
    <div class="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-5">
      <div class="flex items-center justify-between pb-3 border-b border-[#dadce0]">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-[#e8f0fe] flex items-center justify-center text-[#1a73e8]">
            <KeyRound class="w-4 h-4" />
          </div>
          <div>
            <h2 class="text-sm font-bold text-[#202124]">强随机密码生成器</h2>
            <p class="text-[11px] text-[#5f6368]">自定义长度与多字符集加密生成高熵安全凭据</p>
          </div>
        </div>
        <button @click="emit('close')" class="text-[#5f6368] hover:text-[#202124] p-1.5 hover:bg-[#f1f3f4] rounded-full cursor-pointer">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="bg-[#f8fafd] border border-[#dadce0] rounded-2xl p-4 flex flex-col gap-2.5">
        <div class="flex items-center justify-between gap-3">
          <span class="font-mono text-base md:text-lg font-bold text-[#1a73e8] tracking-wider break-all select-all flex-1">{{ generatedPassword || "生成中..." }}</span>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <button @click="generateNewPassword" class="p-2 hover:bg-[#e8eaed] text-[#5f6368] hover:text-[#1a73e8] rounded-xl cursor-pointer">
              <RefreshCw class="w-4 h-4" />
            </button>
            <button @click="generatedPassword && emit('copy', generatedPassword)" class="px-3 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer">
              <Copy class="w-3.5 h-3.5" />
              <span>复制</span>
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-1 pt-1 border-t border-[#dadce0]/60">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-[#5f6368]">安全性强度</span>
            <span class="font-bold" :class="passwordStrength.textCol">{{ passwordStrength.text }}</span>
          </div>
          <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div class="h-full transition-all duration-300" :class="passwordStrength.color" :style="{ width: passwordStrength.percent }"></div>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5 items-center">
        <span class="text-xs text-[#5f6368] font-medium">快速预设:</span>
        <button @click="applyPwdPreset('strong')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">标准强密 (20位)</button>
        <button @click="applyPwdPreset('max')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">超高强度 (32位)</button>
        <button @click="applyPwdPreset('alphanumeric')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">纯字母数字 (18位)</button>
        <button @click="applyPwdPreset('pin')" class="px-2.5 py-1 bg-[#f1f3f4] hover:bg-[#e8f0fe] hover:text-[#1a73e8] rounded-lg text-xs cursor-pointer">PIN码 (6位)</button>
      </div>

      <div class="space-y-4">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-xs font-medium text-[#202124]">
            <span>密码长度 ({{ pwdGenForm.length }} 位)</span>
            <span class="text-[#5f6368] font-mono">{{ pwdGenForm.length }} / 64</span>
          </div>
          <input type="range" min="6" max="64" v-model.number="pwdGenForm.length" @input="generateNewPassword" class="w-full accent-[#1a73e8] cursor-pointer" />
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
            <input type="checkbox" v-model="pwdGenForm.uppercase" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
            <span>大写字母 (A-Z)</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
            <input type="checkbox" v-model="pwdGenForm.lowercase" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
            <span>小写字母 (a-z)</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
            <input type="checkbox" v-model="pwdGenForm.numbers" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
            <span>数字 (0-9)</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer">
            <input type="checkbox" v-model="pwdGenForm.symbols" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
            <span>特殊符号 (!@#$...)</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-[#202124] cursor-pointer col-span-2">
            <input type="checkbox" v-model="pwdGenForm.exclude_ambiguous" @change="generateNewPassword" class="rounded text-[#1a73e8]" />
            <span>排除易混淆字符 (避免 1, l, I, 0, O, o)</span>
          </label>
        </div>
      </div>

      <div class="flex items-center justify-between pt-3 border-t border-[#dadce0] gap-3">
        <button
          v-if="currentAccountTitle"
          @click="generatedPassword && emit('apply', generatedPassword)"
          class="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Sparkles class="w-3.5 h-3.5 text-emerald-600" />
          <span>应用至当前账号 ({{ currentAccountTitle }})</span>
        </button>
        <div v-else></div>
        <div class="flex items-center gap-2">
          <button @click="emit('close')" class="px-4 py-2.5 bg-[#f1f3f4] hover:bg-[#e8eaed] text-[#3c4043] rounded-xl text-xs font-medium cursor-pointer">关闭</button>
          <button @click="generatedPassword && emit('copy', generatedPassword)" class="px-5 py-2.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-xl text-xs font-medium cursor-pointer">复制密码</button>
        </div>
      </div>
    </div>
  </div>
</template>
