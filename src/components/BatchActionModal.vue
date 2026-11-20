<script setup lang="ts">
import { X } from "lucide-vue-next";
import { ACCOUNT_STATUS_OPTIONS } from "../utils/accountHelpers";

defineProps<{
  visible: boolean;
  actionType: "group" | "status" | "plan";
  selectedCount: number;
  targetGroup: string;
  targetStatus: string;
  targetPlan: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "update:targetGroup", value: string): void;
  (e: "update:targetStatus", value: string): void;
  (e: "update:targetPlan", value: string): void;
  (e: "execute"): void;
}>();
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
    <div class="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-[#dadce0] flex flex-col gap-4">
      <div class="flex items-center justify-between pb-2 border-b border-[#f1f3f4]">
        <h3 class="text-sm font-bold text-[#202124]">
          {{
            actionType === 'group' ? `批量修改分组 (${selectedCount} 个)` :
            actionType === 'status' ? `批量修改账号状态 (${selectedCount} 个)` :
            `批量修改会员/套餐 (${selectedCount} 个)`
          }}
        </h3>
        <button @click="emit('close')" class="p-1 hover:bg-[#f1f3f4] rounded-full text-[#5f6368]"><X class="w-4 h-4" /></button>
      </div>

      <div v-if="actionType === 'group'" class="space-y-2">
        <label class="block text-xs font-semibold text-[#5f6368]">目标分组名称（留空则设为未分组）</label>
        <input
          type="text"
          :value="targetGroup"
          @input="emit('update:targetGroup', ($event.target as HTMLInputElement).value)"
          placeholder="例如：工作 / 开发 / 金融..."
          class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
        />
      </div>
      <div v-else-if="actionType === 'status'" class="space-y-2">
        <label class="block text-xs font-semibold text-[#5f6368]">选择账号状态</label>
        <select
          :value="targetStatus"
          @change="emit('update:targetStatus', ($event.target as HTMLSelectElement).value)"
          class="w-full px-3 py-2 bg-[#f1f3f4] rounded-xl text-xs outline-none font-medium"
        >
          <option v-for="st in ACCOUNT_STATUS_OPTIONS" :key="st" :value="st">{{ st }}</option>
        </select>
      </div>
      <div v-else class="space-y-2">
        <label class="block text-xs font-semibold text-[#5f6368]">目标套餐 / 会员等级</label>
        <input
          type="text"
          :value="targetPlan"
          @input="emit('update:targetPlan', ($event.target as HTMLInputElement).value)"
          placeholder="例如：Pro / VIP / Free..."
          class="w-full px-3 py-2 bg-[#f1f3f4] focus:bg-white rounded-xl border border-transparent focus:border-[#1a73e8] text-xs outline-none"
        />
      </div>

      <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#f1f3f4]">
        <button type="button" @click="emit('close')" class="px-4 py-2 bg-[#f1f3f4] text-[#444746] rounded-xl text-xs font-medium cursor-pointer">取消</button>
        <button type="button" @click="emit('execute')" class="px-5 py-2 bg-[#1a73e8] text-white rounded-xl text-xs font-medium cursor-pointer">确认批量修改</button>
      </div>
    </div>
  </div>
</template>
