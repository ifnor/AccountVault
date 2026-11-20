use crate::models::{AccountRecord, PasskeyCredential};
use crate::{totp, vault, AppState};
use parking_lot::RwLock;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_BRIDGE_PORT: u16 = 47291;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserBridgeConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserBridgeStatus {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgeCredentialDto {
    pub id: String,
    pub title: String,
    pub account: String,
    pub password: String,
    pub login_url: String,
    pub has_totp: bool,
    pub totp_code: String,
    pub totp_remaining: u64,
    pub passkeys_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BridgePasskeyDto {
    pub record_id: String,
    pub title: String,
    pub credential_id: String,
    pub rp_id: String,
    pub rp_name: String,
    pub user_id: String,
    pub user_name: String,
    pub user_display_name: String,
    pub private_key_jwk: String,
    pub public_key_spki: String,
    pub sign_count: u32,
}

#[derive(Debug, Deserialize)]
struct PasskeyMatchRequest {
    #[serde(default)]
    rp_id: String,
    #[serde(default)]
    allow_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PasskeySaveRequest {
    #[serde(default)]
    rp_id: String,
    #[serde(default)]
    rp_name: String,
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    user_name: String,
    #[serde(default)]
    user_display_name: String,
    #[serde(default)]
    credential_id: String,
    #[serde(default)]
    private_key_jwk: String,
    #[serde(default)]
    public_key_spki: String,
    #[serde(default)]
    url: String,
}

#[derive(Debug, Deserialize)]
struct PasskeyBumpRequest {
    #[serde(default)]
    credential_id: String,
    #[serde(default)]
    sign_count: u32,
}

#[derive(Debug, Deserialize)]
struct MatchRequest {
    #[serde(default)]
    url: String,
    #[serde(default)]
    domain: String,
}

#[derive(Debug, Deserialize)]
struct SaveRequest {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    account: String,
    #[serde(default)]
    password: String,
}

static BRIDGE_CONFIG: OnceLock<RwLock<BrowserBridgeConfig>> = OnceLock::new();
static BRIDGE_RUNNING: AtomicBool = AtomicBool::new(false);

fn generate_token() -> String {
    let mut buf = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

fn config_file_path() -> PathBuf {
    vault::vault_data_dir().join("browser_bridge.json")
}

fn load_or_init_config() -> BrowserBridgeConfig {
    if let Ok(Some(bytes)) = vault::load_encrypted_setting("browser_bridge_config") {
        if let Ok(raw) = String::from_utf8(bytes) {
            if let Ok(mut cfg) = serde_json::from_str::<BrowserBridgeConfig>(&raw) {
                if cfg.port == 0 {
                    cfg.port = DEFAULT_BRIDGE_PORT;
                }
                if cfg.token.trim().len() < 16 {
                    cfg.token = generate_token();
                    let _ = save_config_to_disk(&cfg);
                }
                return cfg;
            }
        }
    }

    // Auto-migrate legacy plaintext browser_bridge.json into encrypted SQLite3 app_settings
    let path = config_file_path();
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(mut cfg) = serde_json::from_str::<BrowserBridgeConfig>(&raw) {
            if cfg.port == 0 {
                cfg.port = DEFAULT_BRIDGE_PORT;
            }
            if cfg.token.trim().len() < 16 {
                cfg.token = generate_token();
            }
            let _ = save_config_to_disk(&cfg);
            let _ = std::fs::remove_file(&path);
            return cfg;
        }
    }
    let cfg = BrowserBridgeConfig {
        enabled: true,
        port: DEFAULT_BRIDGE_PORT,
        token: generate_token(),
    };
    let _ = save_config_to_disk(&cfg);
    cfg
}

fn save_config_to_disk(cfg: &BrowserBridgeConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    vault::save_encrypted_setting("browser_bridge_config", json.as_bytes())?;
    let legacy_path = config_file_path();
    if legacy_path.exists() {
        let _ = std::fs::remove_file(legacy_path);
    }
    Ok(())
}

fn config_lock() -> &'static RwLock<BrowserBridgeConfig> {
    BRIDGE_CONFIG.get_or_init(|| RwLock::new(load_or_init_config()))
}

pub fn get_status() -> BrowserBridgeStatus {
    let cfg = config_lock().read().clone();
    BrowserBridgeStatus {
        enabled: cfg.enabled,
        port: cfg.port,
        token: cfg.token,
        running: BRIDGE_RUNNING.load(Ordering::Relaxed),
    }
}

pub fn set_enabled(enabled: bool) -> Result<BrowserBridgeStatus, String> {
    let mut cfg = config_lock().write();
    cfg.enabled = enabled;
    save_config_to_disk(&cfg)?;
    Ok(BrowserBridgeStatus {
        enabled: cfg.enabled,
        port: cfg.port,
        token: cfg.token.clone(),
        running: BRIDGE_RUNNING.load(Ordering::Relaxed),
    })
}

pub fn regenerate_token() -> Result<BrowserBridgeStatus, String> {
    let mut cfg = config_lock().write();
    cfg.token = generate_token();
    save_config_to_disk(&cfg)?;
    Ok(BrowserBridgeStatus {
        enabled: cfg.enabled,
        port: cfg.port,
        token: cfg.token.clone(),
        running: BRIDGE_RUNNING.load(Ordering::Relaxed),
    })
}

pub fn start_bridge_server(app: AppHandle) {
    let cfg = config_lock().read().clone();
    let port = cfg.port;

    std::thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", port);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => {
                BRIDGE_RUNNING.store(true, Ordering::Relaxed);
                l
            }
            Err(e) => {
                eprintln!("[BrowserBridge] Failed to bind {}: {}", addr, e);
                BRIDGE_RUNNING.store(false, Ordering::Relaxed);
                return;
            }
        };

        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        handle_connection(s, &app_clone);
                    });
                }
                Err(_) => break,
            }
        }
        BRIDGE_RUNNING.store(false, Ordering::Relaxed);
    });
}

fn extract_host(raw_url: &str) -> String {
    let trimmed = raw_url.trim().to_lowercase();
    if trimmed.is_empty() {
        return String::new();
    }
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(&trimmed);
    let host_port = without_scheme.split('/').next().unwrap_or("");
    let host = host_port.split(':').next().unwrap_or("");
    host.strip_prefix("www.").unwrap_or(host).to_string()
}

fn known_platform_domain(title: &str) -> Option<&'static str> {
    let t = title.trim().to_lowercase();
    if t.contains("google") || t.contains("gmail") || t.contains("谷歌") {
        Some("google.com")
    } else if t.contains("github") {
        Some("github.com")
    } else if t.contains("microsoft") || t.contains("outlook") || t.contains("微软") {
        Some("microsoft.com")
    } else if t.contains("apple") || t.contains("icloud") || t.contains("苹果") {
        Some("apple.com")
    } else if t.contains("openai") || t.contains("chatgpt") {
        Some("openai.com")
    } else if t.contains("claude") || t.contains("anthropic") {
        Some("claude.ai")
    } else if t.contains("steam") {
        Some("steampowered.com")
    } else if t.contains("discord") {
        Some("discord.com")
    } else if t.contains("twitter") || t == "x" {
        Some("x.com")
    } else if t.contains("bilibili") || t.contains("b站") {
        Some("bilibili.com")
    } else if t.contains("zhihu") || t.contains("知乎") {
        Some("zhihu.com")
    } else if t.contains("taobao") || t.contains("淘宝") {
        Some("taobao.com")
    } else if t.contains("aliyun") || t.contains("阿里云") {
        Some("aliyun.com")
    } else if t.contains("tencent") || t.contains("qq") || t.contains("微信") {
        Some("qq.com")
    } else {
        None
    }
}

fn registrable_domain(host: &str) -> String {
    let parts: Vec<&str> = host.split('.').filter(|p| !p.is_empty()).collect();
    if parts.len() <= 2 {
        return host.to_string();
    }
    let last2 = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
    let multi_tlds = [
        "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk", "co.jp", "ne.jp",
        "com.hk", "com.tw", "com.au", "co.kr",
    ];
    if multi_tlds.contains(&last2.as_str()) && parts.len() >= 3 {
        format!("{}.{}", parts[parts.len() - 3], last2)
    } else {
        last2
    }
}

fn hosts_match(a: &str, b: &str) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a == b || a.ends_with(&format!(".{}", b)) || b.ends_with(&format!(".{}", a)) {
        return true;
    }
    let ra = registrable_domain(a);
    let rb = registrable_domain(b);
    !ra.is_empty() && ra == rb
}

fn domain_matches(record: &AccountRecord, target_host: &str) -> bool {
    if target_host.is_empty() {
        return false;
    }
    let rec_host = extract_host(&record.login_url);
    if hosts_match(&rec_host, target_host) {
        return true;
    }
    for pk in &record.passkeys {
        let pk_host = extract_host(&pk.rp_id);
        if hosts_match(&pk_host, target_host) {
            return true;
        }
    }
    if let Some(known) = known_platform_domain(&record.title) {
        if hosts_match(known, target_host) {
            return true;
        }
    }
    let title_lower = record.title.trim().to_lowercase();
    if title_lower.len() >= 3 {
        let base_label = target_host.split('.').next().unwrap_or("");
        if base_label.len() >= 3 && (title_lower.contains(base_label) || base_label.contains(&title_lower)) {
            return true;
        }
    }
    false
}

fn to_dto(rec: &AccountRecord) -> BridgeCredentialDto {
    let mut totp_code = String::new();
    let mut totp_remaining = 0u64;
    let has_totp = !rec.totp.trim().is_empty();
    if has_totp {
        if let Ok(res) = totp::calculate_totp(&rec.totp) {
            totp_code = res.code;
            totp_remaining = res.remaining_seconds;
        }
    }
    let title = if !rec.title.trim().is_empty() {
        rec.title.trim().to_string()
    } else {
        extract_host(&rec.login_url)
    };
    BridgeCredentialDto {
        id: rec.id.clone(),
        title,
        account: rec.primary_identifier().to_string(),
        password: rec.password.clone(),
        login_url: rec.login_url.clone(),
        has_totp,
        totp_code,
        totp_remaining,
        passkeys_count: rec.passkeys.len(),
    }
}

fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    cors_origin: Option<&str>,
    body: &str,
) {
    let allow_origin = cors_origin.unwrap_or("*");
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: {}\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        allow_origin,
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn handle_connection(mut stream: TcpStream, app: &AppHandle) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let Ok(stream_clone) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(stream_clone);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let parts: Vec<&str> = request_line.trim_end().split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let full_path = parts[1];
    let (path, query) = match full_path.split_once('?') {
        Some((p, q)) => (p, q),
        None => (full_path, ""),
    };

    let mut headers: HashMap<String, String> = HashMap::new();
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let key_lower = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if key_lower == "content-length" {
                content_length = val.parse::<usize>().unwrap_or(0).min(1024 * 1024);
            }
            headers.insert(key_lower, val);
        }
    }

    // Reject requests from ordinary http/https web pages (CSRF / DNS rebinding protection)
    let origin = headers.get("origin").map(|s| s.as_str()).unwrap_or("");
    let origin_lower = origin.to_lowercase();
    if origin_lower.starts_with("http://") || origin_lower.starts_with("https://") {
        write_json_response(
            &mut stream,
            403,
            "Forbidden",
            None,
            r#"{"error":"Web origin forbidden"}"#,
        );
        return;
    }

    let cors_origin = if origin.is_empty() { None } else { Some(origin) };

    if method == "OPTIONS" {
        write_json_response(&mut stream, 204, "No Content", cors_origin, "");
        return;
    }

    let mut body_buf = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body_buf).is_err() {
        write_json_response(
            &mut stream,
            400,
            "Bad Request",
            cors_origin,
            r#"{"error":"Incomplete body"}"#,
        );
        return;
    }
    let body_str = String::from_utf8_lossy(&body_buf).to_string();

    let cfg = config_lock().read().clone();
    let state = app.state::<AppState>();
    let is_unlocked = state.vault_key.read().is_some();

    if method == "GET" && path == "/api/ping" {
        let payload = serde_json::json!({
            "ok": true,
            "app": "AccountVault",
            "enabled": cfg.enabled,
            "unlocked": is_unlocked
        });
        write_json_response(&mut stream, 200, "OK", cors_origin, &payload.to_string());
        return;
    }

    if !cfg.enabled {
        write_json_response(
            &mut stream,
            503,
            "Service Unavailable",
            cors_origin,
            r#"{"error":"Browser bridge is disabled in AccountVault settings"}"#,
        );
        return;
    }

    // Verify Bearer token
    let auth_header = headers.get("authorization").map(|s| s.as_str()).unwrap_or("");
    let provided_token = auth_header.strip_prefix("Bearer ").unwrap_or("").trim();
    if provided_token != cfg.token {
        write_json_response(
            &mut stream,
            401,
            "Unauthorized",
            cors_origin,
            r#"{"error":"Invalid pairing token"}"#,
        );
        return;
    }

    if method == "POST" && path == "/api/focus" {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        write_json_response(&mut stream, 200, "OK", cors_origin, r#"{"ok":true}"#);
        return;
    }

    if !is_unlocked {
        write_json_response(
            &mut stream,
            423,
            "Locked",
            cors_origin,
            r#"{"locked":true,"error":"AccountVault is locked"}"#,
        );
        return;
    }

    match (method, path) {
        ("POST", "/api/match") => {
            let req: MatchRequest = serde_json::from_str(&body_str).unwrap_or(MatchRequest {
                url: String::new(),
                domain: String::new(),
            });
            let target_host = if !req.domain.trim().is_empty() {
                extract_host(&req.domain)
            } else {
                extract_host(&req.url)
            };

            let records = state.records.read();
            let matched: Vec<BridgeCredentialDto> = records
                .iter()
                .filter(|r| r.deleted_at.is_none() && domain_matches(r, &target_host))
                .map(to_dto)
                .collect();

            let payload = serde_json::json!({
                "ok": true,
                "domain": target_host,
                "items": matched
            });
            write_json_response(&mut stream, 200, "OK", cors_origin, &payload.to_string());
        }
        ("GET", "/api/accounts") => {
            let q = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("q="))
                .unwrap_or("");
            let q_decoded = url_decode(q).to_lowercase();
            let records = state.records.read();
            let items: Vec<BridgeCredentialDto> = records
                .iter()
                .filter(|r| {
                    if r.deleted_at.is_some() {
                        return false;
                    }
                    if q_decoded.is_empty() {
                        return true;
                    }
                    r.title.to_lowercase().contains(&q_decoded)
                        || r.username.to_lowercase().contains(&q_decoded)
                        || r.email.to_lowercase().contains(&q_decoded)
                        || r.login_url.to_lowercase().contains(&q_decoded)
                })
                .take(50)
                .map(to_dto)
                .collect();

            let payload = serde_json::json!({
                "ok": true,
                "items": items
            });
            write_json_response(&mut stream, 200, "OK", cors_origin, &payload.to_string());
        }
        ("POST", "/api/save") => {
            let req: SaveRequest = match serde_json::from_str(&body_str) {
                Ok(r) => r,
                Err(_) => {
                    write_json_response(
                        &mut stream,
                        400,
                        "Bad Request",
                        cors_origin,
                        r#"{"error":"Invalid JSON"}"#,
                    );
                    return;
                }
            };
            let account = req.account.trim().to_string();
            let password = req.password.clone();
            if account.is_empty() || password.is_empty() {
                write_json_response(
                    &mut stream,
                    400,
                    "Bad Request",
                    cors_origin,
                    r#"{"error":"Account and password are required"}"#,
                );
                return;
            }

            let key_opt = *state.vault_key.read();
            let Some((key, _salt)) = key_opt else {
                write_json_response(&mut stream, 423, "Locked", cors_origin, r#"{"locked":true}"#);
                return;
            };

            let host = extract_host(&req.url);
            let now = chrono::Utc::now().timestamp();
            let mut records = state.records.write();

            // Check if an active record with same account & domain already exists
            let existing_idx = records.iter().position(|r| {
                r.deleted_at.is_none()
                    && r.primary_identifier().eq_ignore_ascii_case(&account)
                    && (host.is_empty() || domain_matches(r, &host))
            });

            let saved_record = if let Some(idx) = existing_idx {
                let rec = &mut records[idx];
                rec.password = password;
                if rec.login_url.trim().is_empty() && !req.url.trim().is_empty() {
                    rec.login_url = req.url.trim().to_string();
                }
                if rec.title.trim().is_empty() && !req.title.trim().is_empty() {
                    rec.title = req.title.trim().to_string();
                }
                rec.updated_at = now;
                rec.clone()
            } else {
                let title = if !req.title.trim().is_empty() {
                    req.title.trim().to_string()
                } else if !host.is_empty() {
                    host.clone()
                } else {
                    "网页账号".to_string()
                };
                let is_email = account.contains('@');
                let new_rec = AccountRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    title,
                    login_url: req.url.trim().to_string(),
                    username: if is_email { String::new() } else { account.clone() },
                    email: if is_email { account.clone() } else { String::new() },
                    password,
                    group: "浏览器保存".to_string(),
                    created_at: now,
                    updated_at: now,
                    ..Default::default()
                };
                records.push(new_rec.clone());
                new_rec
            };

            if let Err(e) = vault::save_record_to_db(&saved_record, &key) {
                write_json_response(
                    &mut stream,
                    500,
                    "Internal Server Error",
                    cors_origin,
                    &serde_json::json!({ "error": e }).to_string(),
                );
                return;
            }
            drop(records);

            let _ = app.emit("vault-records-updated", ());
            write_json_response(
                &mut stream,
                200,
                "OK",
                cors_origin,
                &serde_json::json!({ "ok": true, "id": saved_record.id }).to_string(),
            );
        }
        ("POST", "/api/passkeys/match") => {
            let req: PasskeyMatchRequest =
                serde_json::from_str(&body_str).unwrap_or(PasskeyMatchRequest {
                    rp_id: String::new(),
                    allow_ids: Vec::new(),
                });
            let rp_host = extract_host(&req.rp_id);
            let records = state.records.read();
            let mut items: Vec<BridgePasskeyDto> = Vec::new();
            for rec in records.iter().filter(|r| r.deleted_at.is_none()) {
                for pk in &rec.passkeys {
                    let pk_host = extract_host(&pk.rp_id);
                    let domain_ok = !rp_host.is_empty() && hosts_match(&pk_host, &rp_host);
                    let allow_ok = req.allow_ids.is_empty()
                        || req.allow_ids.iter().any(|id| id == &pk.credential_id);
                    if domain_ok && allow_ok {
                        items.push(BridgePasskeyDto {
                            record_id: rec.id.clone(),
                            title: if !rec.title.trim().is_empty() {
                                rec.title.clone()
                            } else {
                                pk.rp_name.clone()
                            },
                            credential_id: pk.credential_id.clone(),
                            rp_id: pk.rp_id.clone(),
                            rp_name: pk.rp_name.clone(),
                            user_id: pk.user_id.clone(),
                            user_name: pk.user_name.clone(),
                            user_display_name: pk.user_display_name.clone(),
                            private_key_jwk: pk.private_key_jwk.clone(),
                            public_key_spki: pk.public_key_spki.clone(),
                            sign_count: pk.sign_count,
                        });
                    }
                }
            }
            let payload = serde_json::json!({ "ok": true, "items": items });
            write_json_response(&mut stream, 200, "OK", cors_origin, &payload.to_string());
        }
        ("POST", "/api/passkeys/save") => {
            let req: PasskeySaveRequest = match serde_json::from_str(&body_str) {
                Ok(r) => r,
                Err(_) => {
                    write_json_response(&mut stream, 400, "Bad Request", cors_origin, r#"{"error":"Invalid JSON"}"#);
                    return;
                }
            };
            if req.credential_id.trim().is_empty()
                || req.rp_id.trim().is_empty()
                || req.private_key_jwk.trim().is_empty()
            {
                write_json_response(
                    &mut stream,
                    400,
                    "Bad Request",
                    cors_origin,
                    r#"{"error":"Missing passkey fields"}"#,
                );
                return;
            }
            let key_opt = *state.vault_key.read();
            let Some((key, _)) = key_opt else {
                write_json_response(&mut stream, 423, "Locked", cors_origin, r#"{"locked":true}"#);
                return;
            };
            let now = chrono::Utc::now().timestamp();
            let new_pk = PasskeyCredential {
                credential_id: req.credential_id.trim().to_string(),
                rp_id: req.rp_id.trim().to_string(),
                rp_name: req.rp_name.trim().to_string(),
                user_id: req.user_id.trim().to_string(),
                user_name: req.user_name.trim().to_string(),
                user_display_name: req.user_display_name.trim().to_string(),
                private_key_jwk: req.private_key_jwk.clone(),
                public_key_spki: req.public_key_spki.clone(),
                sign_count: 0,
                created_at: now,
            };

            let rp_host = extract_host(&req.rp_id);
            let mut records = state.records.write();
            let existing_idx = records.iter().position(|r| {
                r.deleted_at.is_none()
                    && domain_matches(r, &rp_host)
                    && (req.user_name.trim().is_empty()
                        || r.primary_identifier().eq_ignore_ascii_case(req.user_name.trim()))
            });

            let saved_record = if let Some(idx) = existing_idx {
                let rec = &mut records[idx];
                rec.passkeys.retain(|p| p.credential_id != new_pk.credential_id);
                rec.passkeys.push(new_pk);
                rec.updated_at = now;
                rec.clone()
            } else {
                let uname = req.user_name.trim().to_string();
                let is_email = uname.contains('@');
                let new_rec = AccountRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: if !req.rp_name.trim().is_empty() {
                        req.rp_name.trim().to_string()
                    } else {
                        rp_host.clone()
                    },
                    login_url: if !req.url.trim().is_empty() {
                        req.url.trim().to_string()
                    } else {
                        format!("https://{}", rp_host)
                    },
                    username: if is_email { String::new() } else { uname.clone() },
                    email: if is_email { uname } else { String::new() },
                    group: "Passkey 通行密钥".to_string(),
                    passkeys: vec![new_pk],
                    created_at: now,
                    updated_at: now,
                    ..Default::default()
                };
                records.push(new_rec.clone());
                new_rec
            };

            if let Err(e) = vault::save_record_to_db(&saved_record, &key) {
                write_json_response(
                    &mut stream,
                    500,
                    "Internal Server Error",
                    cors_origin,
                    &serde_json::json!({ "error": e }).to_string(),
                );
                return;
            }
            drop(records);
            let _ = app.emit("vault-records-updated", ());
            write_json_response(&mut stream, 200, "OK", cors_origin, r#"{"ok":true}"#);
        }
        ("POST", "/api/passkeys/bump") => {
            let req: PasskeyBumpRequest = match serde_json::from_str(&body_str) {
                Ok(r) => r,
                Err(_) => {
                    write_json_response(&mut stream, 400, "Bad Request", cors_origin, r#"{"error":"Invalid JSON"}"#);
                    return;
                }
            };
            let key_opt = *state.vault_key.read();
            let Some((key, _)) = key_opt else {
                write_json_response(&mut stream, 423, "Locked", cors_origin, r#"{"locked":true}"#);
                return;
            };
            let now = chrono::Utc::now().timestamp();
            let mut records = state.records.write();
            let mut updated_rec: Option<AccountRecord> = None;
            for rec in records.iter_mut().filter(|r| r.deleted_at.is_none()) {
                if let Some(pk) = rec.passkeys.iter_mut().find(|p| p.credential_id == req.credential_id) {
                    pk.sign_count = req.sign_count.max(pk.sign_count + 1);
                    rec.updated_at = now;
                    updated_rec = Some(rec.clone());
                    break;
                }
            }
            drop(records);
            if let Some(rec) = updated_rec {
                let _ = vault::save_record_to_db(&rec, &key);
                let _ = app.emit("vault-records-updated", ());
            }
            write_json_response(&mut stream, 200, "OK", cors_origin, r#"{"ok":true}"#);
        }
        _ => {
            write_json_response(
                &mut stream,
                404,
                "Not Found",
                cors_origin,
                r#"{"error":"Not found"}"#,
            );
        }
    }
}

fn url_decode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).to_string()
}
