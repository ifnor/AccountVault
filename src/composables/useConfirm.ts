import { ref } from "vue";
import type { ConfirmOptions } from "../types/vault";

const confirmState = ref<{
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  type: "danger" | "warning" | "info";
  resolve: (value: boolean) => void;
}>({
  visible: false,
  title: "操作确认",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  type: "info",
  resolve: () => {}
});

export function useConfirm() {
  function askConfirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
    return new Promise((resolve) => {
      confirmState.value = {
        visible: true,
        title: opts.title || (opts.type === "danger" ? "高危操作确认" : "操作确认"),
        message: opts.message,
        confirmText: opts.confirmText || "确定",
        cancelText: opts.cancelText || "取消",
        type: opts.type || "info",
        resolve: (val: boolean) => {
          confirmState.value.visible = false;
          resolve(val);
        }
      };
    });
  }

  return {
    confirmState,
    askConfirm
  };
}
