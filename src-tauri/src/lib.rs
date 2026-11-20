pub mod android_autofill;
pub mod backups;
#[cfg(not(target_os = "android"))]
pub mod browser_bridge;
pub mod favicon;
pub mod hello;
pub mod in_app_browser;
pub mod models;
pub mod takeover;
pub mod totp;
pub mod updater;
pub mod utils;
pub mod vault;
pub mod webdav;

use android_autofill::{consume_android_pending_saves, sync_android_autofill_records};
use models::{AccountRecord, TotpQrResult, TotpResult};
use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

pub struct AppState {
    pub master_password: RwLock<Option<String>>,
    pub vault_key: RwLock<Option<([u8; 32], [u8; 16])>>,
    pub records: RwLock<Vec<AccountRecord>>,
}

#[tauri::command]
fn check_vault_exists() -> bool {
    vault::vault_exists()
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct HelloStatus {
    pub available: bool,
    pub enrolled: bool,
}

#[tauri::command]
async fn check_windows_hello_status() -> Result<HelloStatus, String> {
    let available = hello::check_hello_availability().await.unwrap_or(false);
    let enrolled = hello::is_hello_enrolled();
    Ok(HelloStatus {
        available,
        enrolled,
    })
}

#[tauri::command]
async fn enable_windows_hello(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let password = {
        let guard = state.master_password.read();
        guard
            .as_ref()
            .ok_or("请先解锁保险库后再启用 Windows Hello")?
            .clone()
    };
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(target_os = "windows")]
    let raw_hwnd = window.hwnd().ok().map(|h| h.0 as isize);
    #[cfg(not(target_os = "windows"))]
    let raw_hwnd: Option<isize> = None;
    let verified =
        hello::verify_user_consent("验证身份以启用 Windows Hello / PIN 快速解锁", raw_hwnd).await?;
    if !verified {
        return Err("身份验证未通过或已取消".to_string());
    }
    hello::save_hello_credentials(&password)?;
    Ok(())
}

#[tauri::command]
fn disable_windows_hello() -> Result<(), String> {
    hello::disable_hello()
}

#[tauri::command]
async fn unlock_vault_with_hello(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<AccountRecord>, String> {
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(target_os = "windows")]
    let raw_hwnd = window.hwnd().ok().map(|h| h.0 as isize);
    #[cfg(not(target_os = "windows"))]
    let raw_hwnd: Option<isize> = None;
    let verified = hello::verify_user_consent(
        "验证 Windows Hello / PIN 身份以解锁账号管家",
        raw_hwnd,
    )
    .await?;
    if !verified {
        return Err("身份验证未通过或已取消".to_string());
    }
    let password = hello::get_hello_credentials()?;
    if !vault::vault_exists() {
        return Err("保险库数据库不存在，请先创建保险库".to_string());
    }
    let (mut records, key, salt) = vault::unlock_vault_db(&password)?;
    consume_android_pending_saves(&mut records, &key);
    sync_android_autofill_records(&records);

    *state.master_password.write() = Some(password);
    *state.vault_key.write() = Some((key, salt));
    *state.records.write() = records.clone();
    Ok(records.into_iter().filter(|r| r.deleted_at.is_none()).collect())
}

#[tauri::command]
fn unlock_vault(
    password: String,
    state: State<'_, AppState>,
) -> Result<Vec<AccountRecord>, String> {
    if !vault::vault_exists() {
        return Err("保险库数据库不存在，请先创建保险库".to_string());
    }
    let (mut records, key, salt) = vault::unlock_vault_db(&password)?;
    consume_android_pending_saves(&mut records, &key);
    sync_android_autofill_records(&records);

    *state.master_password.write() = Some(password);
    *state.vault_key.write() = Some((key, salt));
    *state.records.write() = records.clone();
    Ok(records.into_iter().filter(|r| r.deleted_at.is_none()).collect())
}

#[tauri::command]
fn create_vault(password: String, state: State<'_, AppState>) -> Result<(), String> {
    if password.trim().is_empty() {
        return Err("主密码不能为空".to_string());
    }
    let (key, salt) = vault::create_vault_db(&password)?;
    let records: Vec<AccountRecord> = Vec::new();
    *state.master_password.write() = Some(password);
    *state.vault_key.write() = Some((key, salt));
    *state.records.write() = records;
    Ok(())
}

#[tauri::command]
fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    *state.master_password.write() = None;
    *state.vault_key.write() = None;
    state.records.write().clear();
    Ok(())
}

#[tauri::command]
fn get_records(state: State<'_, AppState>) -> Result<Vec<AccountRecord>, String> {
    if state.master_password.read().is_none() {
        return Err("保险库已锁定".to_string());
    }
    let all = state.records.read();
    sync_android_autofill_records(&all);
    Ok(all.iter().filter(|r| r.deleted_at.is_none()).cloned().collect())
}

#[tauri::command]
fn save_record(
    mut record: AccountRecord,
    state: State<'_, AppState>,
) -> Result<AccountRecord, String> {
    let password_lock = state.master_password.read();
    let password = password_lock.as_ref().ok_or("保险库已锁定，无法保存")?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    if record.id.trim().is_empty() {
        record.id = uuid::Uuid::new_v4().to_string();
    }
    record.title = record.title.trim().to_string();
    record.login_url = record.login_url.trim().to_string();
    record.username = record.username.trim().to_string();
    record.email = record.email.trim().to_string();
    record.group = record.group.trim().to_string();
    record.plan = record.plan.trim().to_string();
    if record.status.trim().is_empty() {
        record.status = "正常".to_string();
    }
    record.updated_at = now;
    record.deleted_at = None;

    let mut records = state.records.write();
    if let Some(pos) = records.iter().position(|r| r.id == record.id) {
        if record.created_at == 0 {
            record.created_at = if records[pos].created_at != 0 {
                records[pos].created_at
            } else if records[pos].updated_at != 0 {
                records[pos].updated_at
            } else {
                now
            };
        }
        records[pos] = record.clone();
    } else {
        if record.created_at == 0 {
            record.created_at = now;
        }
        records.push(record.clone());
    }

    if let Some((key, _)) = state.vault_key.read().as_ref() {
        vault::save_record_to_db(&record, key)?;
    } else {
        vault::save_vault_atomic(&records, password, 30)?;
    }
    Ok(record)
}

#[tauri::command]
fn delete_record(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let password_lock = state.master_password.read();
    let password = password_lock.as_ref().ok_or("保险库已锁定，无法删除")?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut records = state.records.write();
    if let Some(pos) = records.iter().position(|r| r.id == id) {
        records[pos].deleted_at = Some(now);
        records[pos].updated_at = now;

        if let Some((key, _)) = state.vault_key.read().as_ref() {
            vault::save_record_to_db(&records[pos], key)?;
        } else {
            vault::save_vault_atomic(&records, password, 30)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn batch_update_records(
    ids: Vec<String>,
    group: Option<String>,
    status: Option<String>,
    plan: Option<String>,
    is_pinned: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<AccountRecord>, String> {
    let password_lock = state.master_password.read();
    let password = password_lock.as_ref().ok_or("保险库已锁定，无法批量修改")?;

    if ids.is_empty() {
        let all = state.records.read();
    sync_android_autofill_records(&all);
        return Ok(all.iter().filter(|r| r.deleted_at.is_none()).cloned().collect());
    }

    let id_set: std::collections::HashSet<String> = ids.into_iter().collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut records = state.records.write();
    let mut updated_rows = Vec::new();

    for r in records.iter_mut() {
        if r.deleted_at.is_none() && id_set.contains(&r.id) {
            if let Some(ref g) = group {
                r.group = g.trim().to_string();
            }
            if let Some(ref st) = status {
                r.status = st.trim().to_string();
            }
            if let Some(ref pl) = plan {
                r.plan = pl.trim().to_string();
            }
            if let Some(pin) = is_pinned {
                r.is_pinned = pin;
            }
            r.updated_at = now;
            updated_rows.push(r.clone());
        }
    }

    if !updated_rows.is_empty() {
        if let Some((key, _)) = state.vault_key.read().as_ref() {
            vault::save_records_batch_to_db(&updated_rows, key)?;
        } else {
            vault::save_vault_atomic(&records, password, 30)?;
        }
    }

    Ok(records
        .iter()
        .filter(|r| r.deleted_at.is_none())
        .cloned()
        .collect())
}

#[tauri::command]
fn batch_delete_records(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<AccountRecord>, String> {
    let password_lock = state.master_password.read();
    let password = password_lock.as_ref().ok_or("保险库已锁定，无法批量删除")?;

    let id_set: std::collections::HashSet<String> = ids.into_iter().collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut records = state.records.write();
    let mut deleted_rows = Vec::new();

    for r in records.iter_mut() {
        if r.deleted_at.is_none() && id_set.contains(&r.id) {
            r.deleted_at = Some(now);
            r.updated_at = now;
            deleted_rows.push(r.clone());
        }
    }

    if !deleted_rows.is_empty() {
        if let Some((key, _)) = state.vault_key.read().as_ref() {
            vault::save_records_batch_to_db(&deleted_rows, key)?;
        } else {
            vault::save_vault_atomic(&records, password, 30)?;
        }
    }

    Ok(records
        .iter()
        .filter(|r| r.deleted_at.is_none())
        .cloned()
        .collect())
}

#[tauri::command]
fn change_master_password(
    old_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let current_pwd = {
        let guard = state.master_password.read();
        guard
            .as_ref()
            .ok_or("保险库已锁定，请先解锁")?
            .clone()
    };

    if old_password != current_pwd {
        return Err("原主密码输入不正确".to_string());
    }
    if new_password.trim().is_empty() {
        return Err("新主密码不能为空".to_string());
    }
    if new_password.len() < 4 {
        return Err("新主密码长度建议至少 4 位".to_string());
    }

    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    let key = vault::derive_key(&new_password, &salt)?;

    let records = state.records.read().clone();
    vault::save_vault_atomic_with_key(&records, &key, &salt, 30)?;

    *state.master_password.write() = Some(new_password.clone());
    *state.vault_key.write() = Some((key, salt));

    if hello::is_hello_enrolled() {
        let _ = hello::save_hello_credentials(&new_password);
    }

    Ok(())
}

#[tauri::command]
fn get_totp(secret: String) -> Result<TotpResult, String> {
    totp::calculate_totp(&secret)
}

#[tauri::command]
fn get_totp_qr(
    secret: String,
    account: String,
    issuer: Option<String>,
) -> Result<TotpQrResult, String> {
    totp::generate_totp_qr(&secret, &account, issuer.as_deref())
}

#[tauri::command]
fn parse_totp_input(raw: String) -> Result<String, String> {
    totp::normalize_totp_secret(&raw)
}

#[tauri::command]
fn generate_pwd(length: usize, symbols: bool) -> Result<String, String> {
    utils::generate_password(length, symbols)
}

#[tauri::command]
fn generate_custom_pwd(options: utils::PasswordGenOptions) -> Result<String, String> {
    utils::generate_custom_password(options)
}

#[tauri::command]
async fn test_webdav_connection(config: webdav::WebDavConfig) -> Result<String, String> {
    webdav::test_connection(&config).await
}

#[tauri::command]
fn save_webdav_config(config: webdav::WebDavConfig) -> Result<(), String> {
    webdav::save_config(&config)
}

#[tauri::command]
fn load_webdav_config() -> Result<Option<webdav::WebDavConfig>, String> {
    webdav::load_config()
}

#[tauri::command]
async fn upload_webdav_vault(
    config: webdav::WebDavConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let password = {
        let guard = state.master_password.read();
        guard
            .as_ref()
            .cloned()
            .ok_or("保险库已锁定，无法上传")?
    };
    let current_records = state.records.read().clone();
    let vault_key_copy = *state.vault_key.read();
    let _ = webdav::upload_vault(&config, &current_records, &password, vault_key_copy.as_ref())
        .await?;
    Ok(())
}

#[tauri::command]
async fn sync_webdav_smart(
    state: State<'_, AppState>,
) -> Result<webdav::SmartSyncResult, String> {
    let password = {
        let password_lock = state.master_password.read();
        password_lock
            .as_ref()
            .cloned()
            .ok_or("请先解锁保险库，以便同步数据")?
    };

    let mut config = match webdav::load_config()? {
        Some(c) => c,
        None => {
            return Ok(webdav::SmartSyncResult {
                synced: false,
                message: "未配置 WebDAV 云端同步".to_string(),
                records_updated: false,
                records_count: 0,
                last_sync_time: 0,
            });
        }
    };

    let current_records = state.records.read().clone();
    let vault_key_copy = *state.vault_key.read();

    let (res, new_records_opt) = webdav::smart_sync_vault(
        &mut config,
        &current_records,
        &password,
        vault_key_copy.as_ref(),
    )
    .await?;

    if let Some(new_records) = new_records_opt {
        *state.records.write() = new_records;
    }

    Ok(res)
}

#[tauri::command]
async fn download_webdav_vault(
    config: webdav::WebDavConfig,
    state: State<'_, AppState>,
) -> Result<Vec<AccountRecord>, String> {
    let password = {
        let password_lock = state.master_password.read();
        password_lock
            .as_ref()
            .cloned()
            .ok_or("请先解锁保险库，以便验证并解密云端数据")?
    };
    let records = webdav::download_vault(&config, &password).await?;
    *state.records.write() = records.clone();
    Ok(records)
}

#[tauri::command]
fn list_vault_backups() -> Result<Vec<backups::BackupFileInfo>, String> {
    backups::list_backups()
}

#[tauri::command]
fn create_manual_vault_backup(
    state: State<'_, AppState>,
) -> Result<backups::BackupFileInfo, String> {
    if state.master_password.read().is_none() {
        return Err("请先解锁保险库".to_string());
    }
    backups::create_snapshot_now()
}

#[tauri::command]
fn restore_vault_backup(
    filename: String,
    state: State<'_, AppState>,
) -> Result<Vec<AccountRecord>, String> {
    let password_lock = state.master_password.read();
    let password = password_lock
        .as_ref()
        .ok_or("请先解锁保险库，以便解密历史快照")?;
    let records = backups::restore_backup(&filename, password)?;
    *state.records.write() = records.clone();
    Ok(records)
}

#[tauri::command]
fn export_records_csv_string(state: State<'_, AppState>) -> Result<String, String> {
    if state.master_password.read().is_none() {
        return Err("保险库已锁定，无法导出".to_string());
    }
    let records = state.records.read();
    Ok(backups::export_records_csv(&records))
}

#[tauri::command]
fn export_encrypted_vault_string(state: State<'_, AppState>) -> Result<String, String> {
    let password_lock = state.master_password.read();
    let password = password_lock
        .as_ref()
        .ok_or("保险库已锁定，无法导出密文文件")?;

    let records = state.records.read();
    if let Some((key, salt)) = state.vault_key.read().as_ref() {
        vault::encrypt_records_with_key(&records, key, salt)
    } else {
        vault::encrypt_records(&records, password)
    }
}

#[tauri::command]
fn import_encrypted_vault_blob(
    blob: String,
    password_override: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let password_lock = state.master_password.read();
    let current_password = password_lock
        .as_ref()
        .ok_or("保险库已锁定，请先解锁后再导入")?;
    let pwd = password_override.as_deref().unwrap_or(current_password);

    let (imported, _, _) = vault::decrypt_records_compat(&blob, pwd)?;
    let count = imported.len();
    if count == 0 {
        return Ok(0);
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut records = state.records.write();
    for mut r in imported {
        r.updated_at = now;
        r.deleted_at = None;
        if r.id.trim().is_empty() {
            r.id = uuid::Uuid::new_v4().to_string();
        }
        let match_pos = records.iter().position(|existing| {
            (!r.id.is_empty() && existing.id == r.id)
                || (existing.title.eq_ignore_ascii_case(&r.title)
                    && !r.primary_identifier().is_empty()
                    && existing
                        .primary_identifier()
                        .eq_ignore_ascii_case(r.primary_identifier()))
        });

        if let Some(pos) = match_pos {
            if r.created_at == 0 {
                r.created_at = if records[pos].created_at != 0 {
                    records[pos].created_at
                } else {
                    now
                };
            }
            records[pos] = r;
        } else {
            if r.created_at == 0 {
                r.created_at = now;
            }
            records.push(r);
        }
    }

    if let Some((key, salt)) = state.vault_key.read().as_ref() {
        vault::save_vault_atomic_with_key(&records, key, salt, 30)?;
    } else {
        vault::save_vault_atomic(&records, current_password, 30)?;
    }

    Ok(count)
}

#[tauri::command]
fn batch_import_records(
    new_records: Vec<AccountRecord>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let password_lock = state.master_password.read();
    let password = password_lock.as_ref().ok_or("保险库已锁定，无法导入")?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let mut records = state.records.write();
    let mut imported_count = 0;

    for mut r in new_records {
        r.title = r.title.trim().to_string();
        r.username = r.username.trim().to_string();
        r.email = r.email.trim().to_string();
        if r.username.is_empty() && !r.email.is_empty() {
            r.username = r.email.clone();
        }
        if r.primary_identifier().is_empty() && r.title.is_empty() {
            continue;
        }
        if r.id.trim().is_empty() {
            r.id = uuid::Uuid::new_v4().to_string();
        }
        r.updated_at = now;
        r.deleted_at = None;

        let match_pos = records.iter().position(|existing| {
            existing.title.eq_ignore_ascii_case(&r.title)
                && !r.primary_identifier().is_empty()
                && existing
                    .primary_identifier()
                    .eq_ignore_ascii_case(r.primary_identifier())
        });

        if let Some(pos) = match_pos {
            let existing = &mut records[pos];
            existing.updated_at = now;
            existing.deleted_at = None;
            if existing.created_at == 0 {
                existing.created_at = now;
            }
            if !r.password.trim().is_empty() {
                existing.password = r.password;
            }
            if !r.email.trim().is_empty() {
                existing.email = r.email;
            }
            if !r.login_url.trim().is_empty() {
                existing.login_url = r.login_url;
            }
            if !r.group.trim().is_empty() {
                existing.group = r.group;
            }
            if !r.recovery_email.trim().is_empty() {
                existing.recovery_email = r.recovery_email;
            }
            if !r.phone.trim().is_empty() {
                existing.phone = r.phone;
            }
            if !r.totp.trim().is_empty() {
                existing.totp = r.totp;
            }
            if !r.backup_codes.trim().is_empty() {
                existing.backup_codes = r.backup_codes;
            }
            if !r.notes.trim().is_empty() {
                existing.notes = r.notes;
            }
            if !r.status.trim().is_empty() {
                existing.status = r.status;
            }
            if !r.plan.trim().is_empty() {
                existing.plan = r.plan;
            }
            if !r.expire_at.trim().is_empty() {
                existing.expire_at = r.expire_at;
            }
            if !r.proxy.trim().is_empty() {
                existing.proxy = r.proxy;
            }
            if r.is_pinned {
                existing.is_pinned = true;
            }
        } else {
            if r.status.trim().is_empty() {
                r.status = "正常".to_string();
            }
            if r.created_at == 0 {
                r.created_at = now;
            }
            records.push(r);
        }
        imported_count += 1;
    }

    if let Some((key, salt)) = state.vault_key.read().as_ref() {
        vault::save_vault_atomic_with_key(&records, key, salt, 30)?;
    } else {
        vault::save_vault_atomic(&records, password, 30)?;
    }
    Ok(imported_count)
}

#[derive(serde::Serialize)]
pub struct BrowserBridgeStatusDto {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub running: bool,
}

#[tauri::command]
fn get_browser_bridge_status() -> BrowserBridgeStatusDto {
    #[cfg(not(target_os = "android"))]
    {
        let st = browser_bridge::get_status();
        BrowserBridgeStatusDto {
            enabled: st.enabled,
            port: st.port,
            token: st.token,
            running: st.running,
        }
    }
    #[cfg(target_os = "android")]
    {
        BrowserBridgeStatusDto {
            enabled: false,
            port: 47291,
            token: String::new(),
            running: false,
        }
    }
}

#[tauri::command]
fn set_browser_bridge_enabled(enabled: bool) -> Result<BrowserBridgeStatusDto, String> {
    #[cfg(not(target_os = "android"))]
    {
        let st = browser_bridge::set_enabled(enabled)?;
        Ok(BrowserBridgeStatusDto {
            enabled: st.enabled,
            port: st.port,
            token: st.token,
            running: st.running,
        })
    }
    #[cfg(target_os = "android")]
    {
        let _ = enabled;
        Err("Android 端不支持桌面浏览器扩展桥接".to_string())
    }
}

#[tauri::command]
fn regenerate_browser_bridge_token() -> Result<BrowserBridgeStatusDto, String> {
    #[cfg(not(target_os = "android"))]
    {
        let st = browser_bridge::regenerate_token()?;
        Ok(BrowserBridgeStatusDto {
            enabled: st.enabled,
            port: st.port,
            token: st.token,
            running: st.running,
        })
    }
    #[cfg(target_os = "android")]
    {
        Err("Android 端不支持桌面浏览器扩展桥接".to_string())
    }
}


#[tauri::command]
fn increment_hotp_counter(
    id: String,
    state: State<'_, AppState>,
) -> Result<AccountRecord, String> {
    let key_opt = *state.vault_key.read();
    let Some((key, _)) = key_opt else {
        return Err("保险库已锁定".to_string());
    };
    let now = chrono::Utc::now().timestamp();
    let mut records = state.records.write();
    let rec = records
        .iter_mut()
        .find(|r| r.id == id && r.deleted_at.is_none())
        .ok_or_else(|| "未找到对应账号".to_string())?;
    rec.totp = totp::increment_hotp_counter(&rec.totp)?;
    rec.updated_at = now;
    let updated = rec.clone();
    vault::save_record_to_db(&updated, &key)?;
    sync_android_autofill_records(&records);
    Ok(updated)
}


#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        master_password: RwLock::new(None),
        vault_key: RwLock::new(None),
        records: RwLock::new(Vec::new()),
    };

    let builder = tauri::Builder::default();

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(|app| {
            let data_dir = {
                #[cfg(target_os = "windows")]
                {
                    dirs::data_local_dir()
                        .map(|p| p.join("AccountVault"))
                        .or_else(|| app.path().app_data_dir().ok())
                        .unwrap_or_else(|| std::path::PathBuf::from("."))
                }
                #[cfg(not(target_os = "windows"))]
                {
                    app.path()
                        .app_data_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."))
                }
            };

            let _ = std::fs::create_dir_all(&data_dir);
            vault::init_vault_data_dir(data_dir);

            #[cfg(not(target_os = "android"))]
            browser_bridge::start_bridge_server(app.handle().clone());

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show_item = MenuItem::with_id(app, "show", "打开账号管家", true, None::<&str>)?;
                let lock_item = MenuItem::with_id(app, "lock", "立即锁定保险库", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出账号管家", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &lock_item, &quit_item])?;

                let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                    .menu(&menu)
                    .tooltip("账号管家 (Account Vault)")
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "lock" => {
                            let st = app.state::<AppState>();
                            *st.master_password.write() = None;
                            *st.vault_key.write() = None;
                            st.records.write().clear();
                            let _ = app.emit("vault-locked-from-tray", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                            && let Some(win) = tray.app_handle().get_webview_window("main")
                        {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }
                let _ = tray_builder.build(app)?;
            }

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
                && CLOSE_TO_TRAY.load(Ordering::Relaxed)
            {
                api.prevent_close();
                let _ = window.hide();
            }
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            check_vault_exists,
            unlock_vault,
            create_vault,
            lock_vault,
            get_records,
            save_record,
            delete_record,
            batch_update_records,
            batch_delete_records,
            change_master_password,
            get_totp,
            get_totp_qr,
            parse_totp_input,
            generate_pwd,
            in_app_browser::open_in_app_browser,
            in_app_browser::clear_account_browser_session,
            test_webdav_connection,
            save_webdav_config,
            load_webdav_config,
            upload_webdav_vault,
            download_webdav_vault,
            list_vault_backups,
            create_manual_vault_backup,
            restore_vault_backup,
            export_records_csv_string,
            export_encrypted_vault_string,
            import_encrypted_vault_blob,
            batch_import_records,
            check_windows_hello_status,
            enable_windows_hello,
            disable_windows_hello,
            unlock_vault_with_hello,
            generate_custom_pwd,
            updater::check_github_update,
            updater::open_external_url,
            updater::start_auto_update,
            sync_webdav_smart,
            takeover::start_browser_takeover,
            takeover::stop_browser_takeover,
            takeover::poll_browser_takeover,
            get_browser_bridge_status,
            set_browser_bridge_enabled,
            regenerate_browser_bridge_token,
            android_autofill::get_android_autofill_status,
            android_autofill::open_android_autofill_settings,
            favicon::get_cached_favicons,
            favicon::fetch_and_cache_favicon,
            increment_hotp_counter,
            set_close_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}