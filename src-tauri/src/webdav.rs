use crate::models::AccountRecord;
use crate::vault;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    #[serde(default = "default_true")]
    pub auto_sync: bool,
    #[serde(default)]
    pub last_sync_time: Option<i64>,
    #[serde(default)]
    pub last_etag: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SmartSyncResult {
    pub synced: bool,
    pub message: String,
    pub records_updated: bool,
    pub records_count: usize,
    pub last_sync_time: i64,
}

pub fn webdav_config_path() -> PathBuf {
    vault::vault_data_dir().join("webdav.json")
}

pub fn load_config() -> Result<Option<WebDavConfig>, String> {
    if let Ok(Some(bytes)) = vault::load_encrypted_setting("webdav_config") {
        let data = String::from_utf8(bytes).map_err(|e| format!("解析 WebDAV 配置失败: {e}"))?;
        let config: WebDavConfig =
            serde_json::from_str(&data).map_err(|e| format!("解析 WebDAV 配置失败: {e}"))?;
        return Ok(Some(config));
    }

    // Auto-migrate legacy plaintext webdav.json into encrypted SQLite3 app_settings
    let path = webdav_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("读取 WebDAV 配置失败: {e}"))?;
    let config: WebDavConfig =
        serde_json::from_str(&data).map_err(|e| format!("解析 WebDAV 配置失败: {e}"))?;
    if save_config(&config).is_ok() {
        let _ = fs::remove_file(&path);
    }
    Ok(Some(config))
}

pub fn save_config(config: &WebDavConfig) -> Result<(), String> {
    let data =
        serde_json::to_string_pretty(config).map_err(|e| format!("序列化 WebDAV 配置失败: {e}"))?;
    vault::save_encrypted_setting("webdav_config", data.as_bytes())?;
    let legacy_path = webdav_config_path();
    if legacy_path.exists() {
        let _ = fs::remove_file(legacy_path);
    }
    Ok(())
}

fn normalize_base_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("WebDAV 地址必须以 http:// 或 https:// 开头".to_string());
    }
    if trimmed.ends_with('/') {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/"))
    }
}

fn file_url(base: &str) -> String {
    format!("{base}accounts.avault")
}

fn build_headers(config: &WebDavConfig) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        format!("{}:{}", config.username.trim(), config.password.trim()).as_bytes(),
    );
    if let Ok(val) = HeaderValue::from_str(&format!("Basic {token}")) {
        headers.insert(AUTHORIZATION, val);
    }
    headers
}

pub async fn test_connection(config: &WebDavConfig) -> Result<String, String> {
    let base = normalize_base_url(&config.url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .default_headers(build_headers(config))
        .build()
        .map_err(|e| format!("创建客户端失败: {e}"))?;

    let resp = client
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").unwrap_or(reqwest::Method::GET),
            &base,
        )
        .header("Depth", "0")
        .send()
        .await;

    match resp {
        Ok(r) => {
            let status = r.status().as_u16();
            if (200..300).contains(&status) || status == 207 || status == 405 {
                Ok("WebDAV 连接测试成功！".to_string())
            } else if status == 401 {
                Err("身份验证失败 (HTTP 401)，请核对账号与应用密码".to_string())
            } else {
                Ok(format!("WebDAV 服务器响应正常 (HTTP {status})"))
            }
        }
        Err(e) => Err(format!("连接 WebDAV 服务器失败: {e}")),
    }
}

pub async fn upload_vault(
    config: &WebDavConfig,
    records: &[AccountRecord],
    master_password: &str,
    vault_key: Option<&([u8; 32], [u8; 16])>,
) -> Result<Option<String>, String> {
    let blob_str = if let Some((k, s)) = vault_key {
        vault::encrypt_records_with_key(records, k, s)?
    } else {
        vault::encrypt_records(records, master_password)?
    };
    let blob = blob_str.into_bytes();

    let base = normalize_base_url(&config.url)?;
    let target = file_url(&base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .default_headers(build_headers(config))
        .build()
        .map_err(|e| format!("创建客户端失败: {e}"))?;

    let _ = client
        .request(
            reqwest::Method::from_bytes(b"MKCOL").unwrap_or(reqwest::Method::POST),
            &base,
        )
        .send()
        .await;

    let resp = client
        .put(&target)
        .header(CONTENT_TYPE, "application/octet-stream")
        .body(blob)
        .send()
        .await
        .map_err(|e| format!("上传请求发送失败: {e}"))?;

    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        let etag = resp
            .headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim_matches('"').to_string());
        Ok(etag)
    } else if status == 401 {
        Err("上传失败: 认证未通过 (HTTP 401)".to_string())
    } else {
        Err(format!("上传失败，服务器返回 HTTP {status}"))
    }
}

pub async fn download_vault(
    config: &WebDavConfig,
    master_password: &str,
) -> Result<Vec<AccountRecord>, String> {
    let base = normalize_base_url(&config.url)?;
    let target = file_url(&base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .default_headers(build_headers(config))
        .build()
        .map_err(|e| format!("创建客户端失败: {e}"))?;

    let resp = client
        .get(&target)
        .send()
        .await
        .map_err(|e| format!("下载请求发送失败: {e}"))?;

    let status = resp.status().as_u16();
    if status == 404 {
        return Err("云端尚未保存任何保险库文件 (404 Not Found)".to_string());
    } else if status == 401 {
        return Err("下载失败: 认证未通过 (HTTP 401)".to_string());
    } else if !(200..300).contains(&status) {
        return Err(format!("下载失败，服务器返回 HTTP {status}"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取云端响应数据失败: {e}"))?;
    let blob =
        String::from_utf8(bytes.to_vec()).map_err(|_| "云端文件不是有效的文本格式".to_string())?;

    let (records, key, salt) = vault::decrypt_records(&blob, master_password)?;
    vault::save_vault_atomic_with_key(&records, &key, &salt, 30)?;
    Ok(records)
}

fn record_merge_key(r: &AccountRecord) -> String {
    if !r.id.trim().is_empty() {
        r.id.trim().to_string()
    } else {
        format!(
            "{}::{}",
            r.title.trim().to_lowercase(),
            r.primary_identifier().to_lowercase()
        )
    }
}

/// 核心智能合并算法：按账号 ID 或 平台+账号 匹配，依据毫秒级时间戳与删除墓碑进行仲裁
pub fn smart_merge_records(
    local_records: &[AccountRecord],
    remote_records: &[AccountRecord],
) -> (Vec<AccountRecord>, bool) {
    let mut map: std::collections::HashMap<String, AccountRecord> = std::collections::HashMap::new();
    let mut needs_upload = false;

    for r in local_records {
        map.insert(record_merge_key(r), r.clone());
    }

    for r in remote_records {
        let key = record_merge_key(r);
        if let Some(existing) = map.get_mut(&key) {
            let local_time = existing.deleted_at.unwrap_or(existing.updated_at);
            let remote_time = r.deleted_at.unwrap_or(r.updated_at);

            let earlier_created = match (existing.created_at, r.created_at) {
                (a, b) if a > 0 && b > 0 => std::cmp::min(a, b),
                (a, _) if a > 0 => a,
                (_, b) => b,
            };

            if remote_time > local_time {
                *existing = r.clone();
            } else if local_time > remote_time {
                needs_upload = true;
            }
            existing.created_at = earlier_created;
        } else {
            map.insert(key, r.clone());
        }
    }

    if !needs_upload {
        for local_r in local_records {
            let key = record_merge_key(local_r);
            let exists_in_remote = remote_records.iter().any(|rem| record_merge_key(rem) == key);
            if !exists_in_remote {
                needs_upload = true;
                break;
            }
        }
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let thirty_days_ms: i64 = 30 * 24 * 3600 * 1000;

    let mut merged: Vec<AccountRecord> = map
        .into_values()
        .filter(|r| {
            if let Some(del_ts) = r.deleted_at
                && del_ts > 1_000_000_000_000 && now_ms - del_ts > thirty_days_ms {
                    needs_upload = true;
                    return false;
                }
            true
        })
        .collect();

    merged.sort_by(|a, b| {
        let ka = format!("{} {}", a.title, a.primary_identifier()).to_lowercase();
        let kb = format!("{} {}", b.title, b.primary_identifier()).to_lowercase();
        ka.cmp(&kb)
    });
    (merged, needs_upload)
}

pub async fn smart_sync_vault(
    config: &mut WebDavConfig,
    current_records: &[AccountRecord],
    master_password: &str,
    vault_key: Option<&([u8; 32], [u8; 16])>,
) -> Result<(SmartSyncResult, Option<Vec<AccountRecord>>), String> {
    if config.url.trim().is_empty() {
        return Ok((
            SmartSyncResult {
                synced: false,
                message: "未配置 WebDAV 服务器地址".to_string(),
                records_updated: false,
                records_count: current_records.len(),
                last_sync_time: config.last_sync_time.unwrap_or(0),
            },
            None,
        ));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let base = normalize_base_url(&config.url)?;
    let target = file_url(&base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .default_headers(build_headers(config))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let head_resp = client.head(&target).send().await;

    match head_resp {
        Ok(head_r) => {
            let status = head_r.status().as_u16();
            if status == 404 {
                let etag = upload_vault(config, current_records, master_password, vault_key).await?;
                config.last_sync_time = Some(now);
                config.last_etag = etag;
                let _ = save_config(config);

                return Ok((
                    SmartSyncResult {
                        synced: true,
                        message: "云端尚无数据，已初始化上传本地保险库至云端".to_string(),
                        records_updated: false,
                        records_count: current_records.len(),
                        last_sync_time: now,
                    },
                    None,
                ));
            } else if status == 401 {
                return Err("WebDAV 认证失败 (HTTP 401)，请核对账号密码".to_string());
            } else if !(200..300).contains(&status) {
                return Err(format!("检测云端文件状态失败 (HTTP {status})"));
            }

            let remote_etag = head_r
                .headers()
                .get("ETag")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim_matches('"').to_string());

            let local_max_time = current_records
                .iter()
                .map(|r| r.deleted_at.unwrap_or(r.updated_at))
                .max()
                .unwrap_or(0);

            let last_sync = config.last_sync_time.unwrap_or(0);
            let has_local_newer_edits = local_max_time > last_sync;

            if !has_local_newer_edits
                && remote_etag.is_some()
                && remote_etag == config.last_etag
            {
                config.last_sync_time = Some(now);
                let _ = save_config(config);
                return Ok((
                    SmartSyncResult {
                        synced: true,
                        message: "本地与云端数据已是最新".to_string(),
                        records_updated: false,
                        records_count: current_records.len(),
                        last_sync_time: now,
                    },
                    None,
                ));
            }

            let get_resp = client
                .get(&target)
                .send()
                .await
                .map_err(|e| format!("下载云端文件失败: {e}"))?;

            let get_etag = get_resp
                .headers()
                .get("ETag")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim_matches('"').to_string());

            let bytes = get_resp
                .bytes()
                .await
                .map_err(|e| format!("读取云端密文失败: {e}"))?;
            let blob = String::from_utf8(bytes.to_vec())
                .map_err(|_| "云端文件编码异常，无法解析为字符串".to_string())?;

            let (remote_records, _, _) = vault::decrypt_records(&blob, master_password)?;

            let (merged_records, needs_upload) =
                smart_merge_records(current_records, &remote_records);

            if let Some((k, s)) = vault_key {
                vault::save_vault_atomic_with_key(&merged_records, k, s, 30)?;
            } else {
                vault::save_vault_atomic(&merged_records, master_password, 30)?;
            }

            let final_etag = if needs_upload {
                upload_vault(config, &merged_records, master_password, vault_key).await?
            } else {
                get_etag
            };

            config.last_sync_time = Some(now);
            config.last_etag = final_etag;
            let _ = save_config(config);

            let active_count = merged_records.iter().filter(|r| r.deleted_at.is_none()).count();
            Ok((
                SmartSyncResult {
                    synced: true,
                    message: "云端智能合并同步完成".to_string(),
                    records_updated: true,
                    records_count: active_count,
                    last_sync_time: now,
                },
                Some(merged_records),
            ))
        }
        Err(e) => Err(format!("连接 WebDAV 服务器失败: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_record(id: &str, title: &str, username: &str, updated: i64, deleted: Option<i64>) -> AccountRecord {
        AccountRecord {
            id: id.to_string(),
            title: title.to_string(),
            username: username.to_string(),
            password: "pwd".to_string(),
            group: "Work".to_string(),
            status: "正常".to_string(),
            updated_at: updated,
            created_at: updated,
            deleted_at: deleted,
            ..Default::default()
        }
    }

    #[test]
    fn test_smart_merge_additive() {
        let local = vec![mock_record("1", "GitHub", "alice", 100, None)];
        let remote = vec![mock_record("2", "GitLab", "bob", 150, None)];

        let (merged, needs_upload) = smart_merge_records(&local, &remote);
        assert_eq!(merged.len(), 2);
        assert!(needs_upload);
    }

    #[test]
    fn test_smart_merge_newer_remote_wins() {
        let local = vec![mock_record("1", "GitHub", "alice", 100, None)];
        let mut r = mock_record("1", "GitHub", "alice", 200, None);
        r.password = "new_pwd".to_string();
        let remote = vec![r];

        let (merged, needs_upload) = smart_merge_records(&local, &remote);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].password, "new_pwd");
        assert!(!needs_upload);
    }

    #[test]
    fn test_smart_merge_tombstone_wins() {
        let local = vec![mock_record("1", "GitHub", "alice", 200, Some(200))];
        let remote = vec![mock_record("1", "GitHub", "alice", 100, None)];

        let (merged, needs_upload) = smart_merge_records(&local, &remote);
        assert_eq!(merged.len(), 1);
        assert!(merged[0].deleted_at.is_some());
        assert!(needs_upload);
    }
}
