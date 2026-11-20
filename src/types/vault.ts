export interface PasskeyCredentialInfo {
  credential_id: string;
  rp_id: string;
  rp_name?: string;
  user_name?: string;
  user_display_name?: string;
  sign_count?: number;
  created_at?: number;
}

export interface AccountRecord {
  id: string;
  title: string;
  login_url?: string;
  username: string;
  email?: string;
  password?: string;
  group?: string;
  status?: string;
  plan?: string;
  is_pinned?: boolean;
  expire_at?: string;
  proxy?: string;
  recovery_email?: string;
  phone?: string;
  totp?: string;
  backup_codes?: string;
  used_backup_codes?: string;
  notes?: string;
  passkeys?: PasskeyCredentialInfo[];
  updated_at?: number;
  created_at?: number;
  deleted_at?: number | null;
  [key: string]: any;
}

export interface TotpResult {
  code: string;
  remaining_seconds: number;
  otp_type?: "totp" | "hotp" | string;
  counter?: number;
}

export interface TotpQrResult {
  qr_base64: string;
  otpauth_url: string;
  secret: string;
}

export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "warning" | "info";
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
}

export type SortRule = "alphabetical" | "updated_desc" | "created_desc";
