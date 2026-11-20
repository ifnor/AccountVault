import { ref, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import jsQR from "jsqr";
import type { AccountRecord } from "../types/vault";
import { useToast } from "./useToast";

export function useQrScanner(
  editForm: Ref<AccountRecord>,
  homeTab: Ref<"totp" | "passwords" | "passkeys">,
  openAddModal: () => void
) {
  const { notify } = useToast();

  const showQuickScanModal = ref(false);
  const quickScanVideoRef = ref<HTMLVideoElement | null>(null);
  const quickScanCameraActive = ref(false);
  const quickScanCameraError = ref("");
  let quickScanStream: MediaStream | null = null;
  let quickScanRafId: number | null = null;

  function stopQuickScanCamera() {
    if (quickScanRafId !== null) {
      cancelAnimationFrame(quickScanRafId);
      quickScanRafId = null;
    }
    if (quickScanStream) {
      quickScanStream.getTracks().forEach((t) => t.stop());
      quickScanStream = null;
    }
    quickScanCameraActive.value = false;
  }

  function closeQuickScanModal() {
    stopQuickScanCamera();
    showQuickScanModal.value = false;
  }

  async function handleQuickScannedQr(raw: string) {
    const text = (raw || "").trim();
    if (!text) return;
    closeQuickScanModal();

    if (text.toLowerCase().startsWith("otpauth://")) {
      try {
        const urlObj = new URL(text);
        const rawLabel = decodeURIComponent(urlObj.pathname.replace(/^\/+/, ""));
        let issuer = urlObj.searchParams.get("issuer") || "";
        let accountLabel = rawLabel;
        if (rawLabel.includes(":")) {
          const [pIssuer, pAcc] = rawLabel.split(":", 2);
          if (!issuer) issuer = pIssuer.trim();
          accountLabel = (pAcc || "").trim();
        }
        const normalized = await invoke<string>("parse_totp_input", { raw: text });
        openAddModal();
        editForm.value.title = issuer || accountLabel || "TOTP 账号";
        if (accountLabel.includes("@")) {
          editForm.value.email = accountLabel;
          editForm.value.username = accountLabel;
        } else {
          editForm.value.username = accountLabel;
        }
        editForm.value.totp = normalized;
        homeTab.value = "totp";
        notify(`已识别 ${editForm.value.title} 的 2FA 密钥，请确认后保存`, "success");
        return;
      } catch (e: any) {
        notify(`解析 TOTP 二维码失败: ${e}`, "error");
        return;
      }
    }

    if (text.toUpperCase().startsWith("FIDO:/")) {
      notify("检测到 FIDO 跨设备蓝牙通行密钥二维码；请在浏览器中安装 AccountVault 扩展直接保存或登录网站 PassKey", "info", 5500);
      return;
    }

    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.credential_id && parsed.rp_id && parsed.private_key_jwk) {
        openAddModal();
        editForm.value.title = parsed.rp_name || parsed.rp_id;
        editForm.value.login_url = `https://${parsed.rp_id}`;
        editForm.value.username = parsed.user_name || "";
        editForm.value.passkeys = [parsed];
        homeTab.value = "passkeys";
        notify(`已识别 ${parsed.rp_id} 的 PassKey，请确认保存`, "success");
        return;
      }
    } catch (_) {}

    try {
      const normalized = await invoke<string>("parse_totp_input", { raw: text });
      openAddModal();
      editForm.value.totp = normalized;
      homeTab.value = "totp";
      notify("已识别 2FA 密钥，请补充平台与账号后保存", "success");
    } catch (_) {
      if (text.startsWith("http://") || text.startsWith("https://")) {
        openAddModal();
        editForm.value.login_url = text;
        notify("已识别网址链接，已填入新建账号表单", "info");
      } else {
        notify("已识别二维码内容，但非标准 TOTP / PassKey 格式", "warning");
      }
    }
  }

  async function startQuickScanCamera() {
    stopQuickScanCamera();
    quickScanCameraError.value = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      quickScanCameraError.value = "当前环境不支持直接调用摄像头，请使用下方“选择图片”或 Ctrl+V 粘贴截图";
      return;
    }
    try {
      quickScanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      quickScanCameraActive.value = true;
      setTimeout(() => {
        const video = quickScanVideoRef.value;
        if (!video || !quickScanStream) return;
        video.srcObject = quickScanStream;
        video.play().catch(() => {});

        const canvas = document.createElement("canvas");
        const tick = () => {
          if (!showQuickScanModal.value || !quickScanCameraActive.value) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imgData.data, imgData.width, imgData.height);
              if (code && code.data) {
                handleQuickScannedQr(code.data);
                return;
              }
            }
          }
          quickScanRafId = requestAnimationFrame(tick);
        };
        quickScanRafId = requestAnimationFrame(tick);
      }, 80);
    } catch (_) {
      quickScanCameraActive.value = false;
      quickScanCameraError.value = "未能打开摄像头（无设备或未授权），可直接选择图片或 Ctrl+V 粘贴二维码截图";
    }
  }

  function openQuickScanModal() {
    showQuickScanModal.value = true;
    startQuickScanCamera();
  }

  function decodeQrFromDataUrl(dataUrl: string, notFoundMsg: string) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        handleQuickScannedQr(code.data);
      } else {
        notify(notFoundMsg, "warning");
      }
    };
    img.src = dataUrl;
  }

  function triggerQuickScanImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        decodeQrFromDataUrl(String(ev.target?.result || ""), "未能在图片中识别到有效二维码");
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function handleQuickScanPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (ev) => {
            decodeQrFromDataUrl(String(ev.target?.result || ""), "粘贴的截图中未识别到有效二维码");
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    }
  }

  async function normalizeEditTotpSecret(rawText: string, sourceDesc = "2FA 密钥") {
    try {
      const cleanSecret = await invoke<string>("parse_totp_input", { raw: rawText });
      editForm.value.totp = cleanSecret;
      notify(`✅ 已成功解析并填入 ${sourceDesc} (${cleanSecret.slice(0, 4)}****)`, "success", 2800);
    } catch (err: any) {
      notify(`解析 ${sourceDesc} 失败: ` + err, "error");
    }
  }

  function decodeQrFromImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          notify("浏览器 Canvas 初始化失败", "error");
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          await normalizeEditTotpSecret(code.data, "二维码中的 2FA 密钥");
        } else {
          notify("未能在图片中识别到有效的二维码，请确保二维码清晰完整", "warning");
        }
      };
      img.src = String(ev.target?.result || "");
    };
    reader.readAsDataURL(file);
  }

  function triggerScanQrImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        decodeQrFromImageFile(file);
      }
    };
    input.click();
  }

  function handleTotpPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          decodeQrFromImageFile(file);
          return;
        }
      }
    }
  }

  return {
    showQuickScanModal,
    quickScanVideoRef,
    quickScanCameraActive,
    quickScanCameraError,
    stopQuickScanCamera,
    closeQuickScanModal,
    openQuickScanModal,
    triggerQuickScanImage,
    handleQuickScanPaste,
    triggerScanQrImage,
    handleTotpPaste
  };
}
