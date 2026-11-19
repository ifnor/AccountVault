use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct PasskeyCredential {
    pub credential_id: String,
    pub rp_id: String,
    #[serde(default)]
    pub rp_name: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub user_display_name: String,
    pub private_key_jwk: String,
    #[serde(default)]
    pub public_key_spki: String,
    #[serde(default)]
    pub sign_count: u32,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct AccountRecord {
    pub id: String,
    /// 平台 / 服务名称（例如：GitHub、OpenAI、Steam、Google、招商银行）
    #[serde(default)]
    pub title: String,
    /// 登录网址 / 官网地址
    #[serde(default)]
    pub login_url: String,
    /// 登录账号 / 用户名（支持用户名、邮箱、手机号等）
    #[serde(default)]
    pub username: String,
    /// 绑定邮箱 / 关联邮箱
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub recovery_email: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub totp: String,
    #[serde(default)]
    pub backup_codes: String,
    #[serde(default)]
    pub used_backup_codes: String,
    #[serde(default)]
    pub notes: String,
    /// 会员 / 套餐 / 等级（例如：Free、Pro、VIP、Plus）
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub is_pinned: bool,
    #[serde(default)]
    pub expire_at: String,
    #[serde(default)]
    pub proxy: String,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub deleted_at: Option<i64>,
    #[serde(default)]
    pub passkeys: Vec<PasskeyCredential>,
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

impl AccountRecord {
    /// 获取主要展示/登录标识（优先 username，其次 email）
    pub fn primary_identifier(&self) -> &str {
        let u = self.username.trim();
        if !u.is_empty() {
            u
        } else {
            self.email.trim()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultSettings {
    pub lock_minutes: u32,
    pub clipboard_seconds: u32,
    pub backup_keep: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpResult {
    pub code: String,
    pub remaining_seconds: u64,
    #[serde(default = "default_totp_type")]
    pub otp_type: String,
    #[serde(default)]
    pub counter: u64,
}

fn default_totp_type() -> String {
    "totp".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpQrResult {
    pub qr_base64: String,
    pub otpauth_url: String,
    pub secret: String,
}
