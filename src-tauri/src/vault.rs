use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use base64::Engine;
use chrono::Local;
use rand::RngCore;
use rusqlite::{Connection, OptionalExtension, params};
use scrypt::{Params, scrypt};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::AccountRecord;

pub type UnlockedVault = (Vec<AccountRecord>, [u8; 32], [u8; 16]);

pub const AAD: &[u8] = b"AccountVault:1";
pub const RECORD_AAD: &[u8] = b"AccountVault:Record:1";
pub const SETTING_AAD: &[u8] = b"AccountVault:Setting:1";
pub const VERIFY_PLAINTEXT: &[u8] = b"AccountVault:Verify:1";
pub const LEGACY_GVAULT_AAD: &[u8] = b"GoogleAccountVault:1";

#[derive(Serialize, Deserialize, Debug)]
pub struct VaultEnvelope {
    pub version: u32,
    pub salt: String,
    pub nonce: String,
    pub data: String,
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(15, 8, 1, 32).map_err(|e| format!("Scrypt 参数错误: {e}"))?;
    let mut key = [0u8; 32];
    scrypt(password.as_bytes(), salt, &params, &mut key)
        .map_err(|e| format!("Scrypt 派生密钥失败: {e}"))?;
    Ok(key)
}

fn encrypt_bytes(plaintext: &[u8], key: &[u8; 32], aad: &[u8]) -> Result<(String, String), String> {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|e| format!("AES-GCM 加密失败: {e}"))?;

    Ok((
        hex::encode(nonce),
        base64::engine::general_purpose::STANDARD.encode(ciphertext),
    ))
}

fn decrypt_bytes(
    nonce_hex: &str,
    cipher_b64: &str,
    key: &[u8; 32],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let nonce = hex::decode(nonce_hex).map_err(|e| format!("Nonce 解码失败: {e}"))?;
    if nonce.len() != 12 {
        return Err("Nonce 长度不正确".to_string());
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(cipher_b64)
        .map_err(|e| format!("Ciphertext Base64 解码失败: {e}"))?;

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &data,
                aad,
            },
        )
        .map_err(|_| "主密码错误，或数据已被篡改/损坏".to_string())
}

// ==================== PORTABLE ENVELOPE (WebDAV & .avault/.gvault Export/Import) ====================

pub fn encrypt_records(records: &[AccountRecord], password: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(password, &salt)?;
    encrypt_records_with_key(records, &key, &salt)
}

pub fn encrypt_records_with_key(
    records: &[AccountRecord],
    key: &[u8; 32],
    salt: &[u8; 16],
) -> Result<String, String> {
    let raw = serde_json::to_vec(records).map_err(|e| e.to_string())?;
    let (nonce_hex, data_b64) = encrypt_bytes(&raw, key, AAD)?;
    let envelope = VaultEnvelope {
        version: 1,
        salt: hex::encode(salt),
        nonce: nonce_hex,
        data: data_b64,
    };
    serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())
}

pub fn decrypt_records(blob: &str, password: &str) -> Result<UnlockedVault, String> {
    decrypt_records_with_aad(blob, password, AAD)
}

/// 兼容解密：优先尝试 AccountVault:1，若失败则尝试 GoogleAccountVault:1（用于导入 .gvault 迁移数据）
pub fn decrypt_records_compat(blob: &str, password: &str) -> Result<UnlockedVault, String> {
    if let Ok(res) = decrypt_records_with_aad(blob, password, AAD) {
        return Ok(res);
    }
    let (mut records, key, salt) = decrypt_records_with_aad(blob, password, LEGACY_GVAULT_AAD)?;
    for r in records.iter_mut() {
        if r.title.trim().is_empty() {
            r.title = "Google".to_string();
        }
        if r.login_url.trim().is_empty() {
            r.login_url = "https://accounts.google.com".to_string();
        }
        if r.username.trim().is_empty() && !r.email.trim().is_empty() {
            r.username = r.email.clone();
        }
        if r.plan.trim().is_empty()
            && let Some(g_plan) = r.extra.get("google_one_plan")
                && !g_plan.trim().is_empty() && g_plan != "Free" {
                    r.plan = g_plan.clone();
                }
    }
    Ok((records, key, salt))
}

fn decrypt_records_with_aad(
    blob: &str,
    password: &str,
    aad: &[u8],
) -> Result<UnlockedVault, String> {
    let envelope: VaultEnvelope =
        serde_json::from_str(blob).map_err(|e| format!("解析保险库结构失败: {e}"))?;
    if envelope.version != 1 {
        return Err("不支持的保险库文件版本".to_string());
    }
    let salt_vec = hex::decode(&envelope.salt).map_err(|e| format!("Salt 解码失败: {e}"))?;
    if salt_vec.len() != 16 {
        return Err("保险库 Salt 长度不正确".to_string());
    }
    let mut salt = [0u8; 16];
    salt.copy_from_slice(&salt_vec);

    let key = derive_key(password, &salt)?;
    let decrypted = decrypt_bytes(&envelope.nonce, &envelope.data, &key, aad)?;

    let records: Vec<AccountRecord> =
        serde_json::from_slice(&decrypted).map_err(|e| format!("账号数据反序列化失败: {e}"))?;
    Ok((records, key, salt))
}

// ==================== DATA DIRECTORY & PATHS ====================

static VAULT_DATA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn init_vault_data_dir(path: PathBuf) {
    let _ = VAULT_DATA_DIR.set(path);
}

pub fn vault_data_dir() -> PathBuf {
    if let Some(dir) = VAULT_DATA_DIR.get() {
        return dir.clone();
    }

    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = dirs::data_local_dir() {
        return local_app_data.join("AccountVault");
    }

    PathBuf::from(".")
}

pub fn vault_db_path() -> PathBuf {
    vault_data_dir().join("vault.db")
}

pub fn legacy_vault_file_path() -> PathBuf {
    vault_data_dir().join("accounts.avault")
}

fn has_initialized_vault(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    if let Ok(conn) = Connection::open(path)
        && let Ok(Some(_)) = get_meta(&conn, "salt") {
            return true;
        }
    false
}

pub fn vault_exists() -> bool {
    has_initialized_vault(&vault_db_path()) || legacy_vault_file_path().exists()
}

// ==================== SQLITE3 STORAGE ENGINE ====================

fn open_connection(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("打开 SQLite 数据库失败: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        ",
    )
    .map_err(|e| format!("初始化 SQLite 参数失败: {e}"))?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS vault_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            group_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '',
            is_pinned INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            deleted_at INTEGER,
            nonce TEXT NOT NULL,
            payload TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_accounts_deleted ON accounts(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_accounts_updated ON accounts(updated_at);

        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            cipher_blob TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favicon_cache (
            domain TEXT PRIMARY KEY,
            data_url TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("初始化 SQLite 表结构失败: {e}"))
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO vault_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("写入数据库元数据失败: {e}"))?;
    Ok(())
}

fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM vault_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("读取数据库元数据失败: {e}"))
}

fn get_or_create_settings_key(conn: &Connection) -> Result<[u8; 32], String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(hex_blob) = get_meta(conn, "settings_dpapi_key")? {
            let protected = hex::decode(hex_blob.trim()).map_err(|e| format!("解码设置密钥失败: {e}"))?;
            let raw = crate::hello::dpapi_unprotect(&protected)?;
            if raw.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&raw);
                return Ok(key);
            }
        }
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        let protected = crate::hello::dpapi_protect(&key)?;
        set_meta(conn, "settings_dpapi_key", &hex::encode(protected))?;
        Ok(key)
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(hex_key) = get_meta(conn, "settings_local_key")? {
            let raw = hex::decode(hex_key.trim()).map_err(|e| format!("解码设置密钥失败: {e}"))?;
            if raw.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&raw);
                return Ok(key);
            }
        }
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        set_meta(conn, "settings_local_key", &hex::encode(key))?;
        Ok(key)
    }
}

pub fn save_encrypted_setting(setting_key: &str, plaintext: &[u8]) -> Result<(), String> {
    let conn = open_connection(&vault_db_path())?;
    init_schema(&conn)?;
    let key = get_or_create_settings_key(&conn)?;
    let (nonce_hex, cipher_b64) = encrypt_bytes(plaintext, &key, SETTING_AAD)?;
    let blob = format!("{nonce_hex}:{cipher_b64}");
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO app_settings (setting_key, cipher_blob, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(setting_key) DO UPDATE SET cipher_blob = excluded.cipher_blob, updated_at = excluded.updated_at",
        params![setting_key, blob, now],
    )
    .map_err(|e| format!("写入加密配置失败: {e}"))?;
    Ok(())
}

pub fn load_encrypted_setting(setting_key: &str) -> Result<Option<Vec<u8>>, String> {
    let db_path = vault_db_path();
    if !db_path.exists() {
        return Ok(None);
    }
    let conn = open_connection(&db_path)?;
    init_schema(&conn)?;
    let blob_opt: Option<String> = conn
        .query_row(
            "SELECT cipher_blob FROM app_settings WHERE setting_key = ?1",
            params![setting_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("读取加密配置失败: {e}"))?;
    let Some(blob) = blob_opt else {
        return Ok(None);
    };
    let Some((nonce_hex, cipher_b64)) = blob.split_once(':') else {
        return Err("配置密文格式无效".to_string());
    };
    let key = get_or_create_settings_key(&conn)?;
    decrypt_bytes(nonce_hex, cipher_b64, &key, SETTING_AAD).map(Some)
}

pub fn delete_encrypted_setting(setting_key: &str) -> Result<(), String> {
    let db_path = vault_db_path();
    if !db_path.exists() {
        return Ok(());
    }
    let conn = open_connection(&db_path)?;
    init_schema(&conn)?;
    conn.execute(
        "DELETE FROM app_settings WHERE setting_key = ?1",
        params![setting_key],
    )
    .map_err(|e| format!("删除配置失败: {e}"))?;
    Ok(())
}

pub fn load_all_cached_favicons() -> Result<std::collections::HashMap<String, String>, String> {
    let db_path = vault_db_path();
    if !db_path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    let conn = open_connection(&db_path)?;
    init_schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT domain, data_url FROM favicon_cache")
        .map_err(|e| format!("查询头像缓存失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let domain: String = row.get(0)?;
            let data_url: String = row.get(1)?;
            Ok((domain, data_url))
        })
        .map_err(|e| format!("读取头像缓存失败: {e}"))?;
    let mut map = std::collections::HashMap::new();
    for item in rows.flatten() {
        map.insert(item.0, item.1);
    }
    Ok(map)
}

pub fn get_cached_favicon(domain: &str) -> Result<Option<String>, String> {
    let db_path = vault_db_path();
    if !db_path.exists() {
        return Ok(None);
    }
    let conn = open_connection(&db_path)?;
    init_schema(&conn)?;
    conn.query_row(
        "SELECT data_url FROM favicon_cache WHERE domain = ?1",
        params![domain],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("查询单条头像缓存失败: {e}"))
}

pub fn save_cached_favicon(domain: &str, data_url: &str) -> Result<(), String> {
    let conn = open_connection(&vault_db_path())?;
    init_schema(&conn)?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO favicon_cache (domain, data_url, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(domain) DO UPDATE SET data_url = excluded.data_url, updated_at = excluded.updated_at",
        params![domain, data_url, now],
    )
    .map_err(|e| format!("保存头像缓存失败: {e}"))?;
    Ok(())
}

fn write_verifier_meta(
    conn: &Connection,
    key: &[u8; 32],
    salt: &[u8; 16],
) -> Result<(), String> {
    let (v_nonce, v_cipher) = encrypt_bytes(VERIFY_PLAINTEXT, key, AAD)?;
    set_meta(conn, "version", "1")?;
    set_meta(conn, "salt", &hex::encode(salt))?;
    set_meta(conn, "verifier_nonce", &v_nonce)?;
    set_meta(conn, "verifier_cipher", &v_cipher)?;
    Ok(())
}

fn insert_or_replace_account(
    tx: &rusqlite::Transaction<'_>,
    record: &AccountRecord,
    key: &[u8; 32],
) -> Result<(), String> {
    let raw = serde_json::to_vec(record).map_err(|e| format!("序列化账号失败: {e}"))?;
    let (nonce_hex, payload_b64) = encrypt_bytes(&raw, key, RECORD_AAD)?;
    tx.execute(
        "INSERT INTO accounts (
            id, title, username, email, group_name, status,
            is_pinned, updated_at, created_at, deleted_at, nonce, payload
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            username = excluded.username,
            email = excluded.email,
            group_name = excluded.group_name,
            status = excluded.status,
            is_pinned = excluded.is_pinned,
            updated_at = excluded.updated_at,
            created_at = excluded.created_at,
            deleted_at = excluded.deleted_at,
            nonce = excluded.nonce,
            payload = excluded.payload",
        params![
            record.id,
            record.title,
            record.username,
            record.email,
            record.group,
            record.status,
            if record.is_pinned { 1i64 } else { 0i64 },
            record.updated_at,
            record.created_at,
            record.deleted_at,
            nonce_hex,
            payload_b64,
        ],
    )
    .map_err(|e| format!("写入账号记录失败: {e}"))?;
    Ok(())
}

pub fn create_vault_db_at(path: &Path, password: &str) -> Result<([u8; 32], [u8; 16]), String> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(password, &salt)?;

    let conn = open_connection(path)?;
    init_schema(&conn)?;
    write_verifier_meta(&conn, &key, &salt)?;
    Ok((key, salt))
}

pub fn create_vault_db(password: &str) -> Result<([u8; 32], [u8; 16]), String> {
    create_vault_db_at(&vault_db_path(), password)
}

pub fn unlock_vault_db_at(path: &Path, password: &str) -> Result<UnlockedVault, String> {
    let conn = open_connection(path)?;
    init_schema(&conn)?;

    let salt_hex = get_meta(&conn, "salt")?.ok_or("数据库缺少加密 Salt 元数据")?;
    let v_nonce = get_meta(&conn, "verifier_nonce")?.ok_or("数据库缺少校验 Nonce")?;
    let v_cipher = get_meta(&conn, "verifier_cipher")?.ok_or("数据库缺少主密码校验密文")?;

    let salt_vec = hex::decode(&salt_hex).map_err(|e| format!("Salt 解码失败: {e}"))?;
    if salt_vec.len() != 16 {
        return Err("数据库 Salt 长度不正确".to_string());
    }
    let mut salt = [0u8; 16];
    salt.copy_from_slice(&salt_vec);

    let key = derive_key(password, &salt)?;
    let verified = decrypt_bytes(&v_nonce, &v_cipher, &key, AAD)?;
    if verified.as_slice() != VERIFY_PLAINTEXT {
        return Err("主密码错误，或数据库已被篡改".to_string());
    }

    let mut stmt = conn
        .prepare("SELECT nonce, payload FROM accounts")
        .map_err(|e| format!("查询账号记录失败: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let nonce: String = row.get(0)?;
            let payload: String = row.get(1)?;
            Ok((nonce, payload))
        })
        .map_err(|e| format!("读取账号行失败: {e}"))?;

    let mut records = Vec::new();
    for row_res in rows {
        let (nonce, payload) = row_res.map_err(|e| format!("解析账号行失败: {e}"))?;
        let plain = decrypt_bytes(&nonce, &payload, &key, RECORD_AAD)?;
        let rec: AccountRecord =
            serde_json::from_slice(&plain).map_err(|e| format!("反序列化账号记录失败: {e}"))?;
        records.push(rec);
    }

    Ok((records, key, salt))
}

pub fn unlock_vault_db(password: &str) -> Result<UnlockedVault, String> {
    let db_path = vault_db_path();
    if has_initialized_vault(&db_path) {
        return unlock_vault_db_at(&db_path, password);
    }

    // 自动从旧版 accounts.avault 文本格式迁移到 SQLite3 (vault.db)
    let legacy_path = legacy_vault_file_path();
    if legacy_path.exists() {
        let blob =
            fs::read_to_string(&legacy_path).map_err(|e| format!("读取旧版保险库文件失败: {e}"))?;
        let (records, key, salt) = decrypt_records(&blob, password)?;
        replace_all_records_db_at(&db_path, &records, &key, &salt)?;
        return Ok((records, key, salt));
    }

    Err("保险库数据库不存在，请先创建保险库".to_string())
}

pub fn upsert_record_db_at(
    path: &Path,
    record: &AccountRecord,
    key: &[u8; 32],
) -> Result<(), String> {
    let mut conn = open_connection(path)?;
    init_schema(&conn)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启 SQLite 事务失败: {e}"))?;
    insert_or_replace_account(&tx, record, key)?;
    tx.commit()
        .map_err(|e| format!("提交 SQLite 事务失败: {e}"))?;
    Ok(())
}

pub fn upsert_records_batch_db_at(
    path: &Path,
    records: &[AccountRecord],
    key: &[u8; 32],
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let mut conn = open_connection(path)?;
    init_schema(&conn)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启 SQLite 事务失败: {e}"))?;
    for r in records {
        insert_or_replace_account(&tx, r, key)?;
    }
    tx.commit()
        .map_err(|e| format!("提交 SQLite 事务失败: {e}"))?;
    Ok(())
}

pub fn replace_all_records_db_at(
    path: &Path,
    records: &[AccountRecord],
    key: &[u8; 32],
    salt: &[u8; 16],
) -> Result<(), String> {
    let mut conn = open_connection(path)?;
    init_schema(&conn)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启 SQLite 事务失败: {e}"))?;
    write_verifier_meta(conn_from_tx(&tx), key, salt)?;
    tx.execute("DELETE FROM accounts", [])
        .map_err(|e| format!("清空旧账号表失败: {e}"))?;
    for r in records {
        insert_or_replace_account(&tx, r, key)?;
    }
    tx.commit()
        .map_err(|e| format!("提交 SQLite 事务失败: {e}"))?;
    Ok(())
}

fn conn_from_tx<'a>(tx: &'a rusqlite::Transaction<'a>) -> &'a Connection {
    tx
}

// ==================== SNAPSHOTS & CONVENIENCE WRAPPERS ====================

pub fn create_db_snapshot(keep_backups: usize, tag: Option<&str>) -> Result<PathBuf, String> {
    let db_path = vault_db_path();
    if !db_path.exists() {
        return Err("本地保险库数据库尚不存在".to_string());
    }
    let backup_dir = vault_data_dir().join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;

    let timestamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let suffix = &uuid::Uuid::new_v4().to_string()[..6];
    let backup_name = match tag {
        Some(t) if !t.is_empty() => format!("{timestamp}-{t}-{suffix}.db"),
        _ => format!("{timestamp}-{suffix}.db"),
    };
    let backup_file = backup_dir.join(backup_name);

    let src_conn = open_connection(&db_path)?;
    let mut dst_conn = Connection::open(&backup_file)
        .map_err(|e| format!("创建快照数据库文件失败: {e}"))?;
    {
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)
            .map_err(|e| format!("初始化 SQLite 热备份失败: {e}"))?;
        backup
            .run_to_completion(100, std::time::Duration::from_millis(10), None)
            .map_err(|e| format!("执行 SQLite 热备份失败: {e}"))?;
    }

    if let Ok(entries) = fs::read_dir(&backup_dir) {
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.extension()
                    .is_some_and(|ext| ext == "db" || ext == "avault")
            })
            .collect();
        files.sort();
        files.reverse();
        let limit = keep_backups.max(1);
        if files.len() > limit {
            for old in &files[limit..] {
                let _ = fs::remove_file(old);
            }
        }
    }

    Ok(backup_file)
}

pub fn save_record_to_db(record: &AccountRecord, key: &[u8; 32]) -> Result<(), String> {
    if vault_db_path().exists() {
        let _ = create_db_snapshot(30, None);
    }
    upsert_record_db_at(&vault_db_path(), record, key)
}

pub fn save_records_batch_to_db(records: &[AccountRecord], key: &[u8; 32]) -> Result<(), String> {
    if vault_db_path().exists() {
        let _ = create_db_snapshot(30, None);
    }
    upsert_records_batch_db_at(&vault_db_path(), records, key)
}

pub fn save_vault_atomic_with_key(
    records: &[AccountRecord],
    key: &[u8; 32],
    salt: &[u8; 16],
    keep_backups: usize,
) -> Result<(), String> {
    if vault_db_path().exists() {
        let _ = create_db_snapshot(keep_backups, None);
    }
    replace_all_records_db_at(&vault_db_path(), records, key, salt)
}

pub fn save_vault_atomic(
    records: &[AccountRecord],
    password: &str,
    keep_backups: usize,
) -> Result<(), String> {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let key = derive_key(password, &salt)?;
    save_vault_atomic_with_key(records, &key, &salt, keep_backups)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_roundtrip() {
        let sample = vec![AccountRecord {
            id: "test-uuid-1".to_string(),
            title: "GitHub".to_string(),
            login_url: "https://github.com/login".to_string(),
            username: "alice".to_string(),
            email: "alice@example.com".to_string(),
            password: "SecurePassword123!".to_string(),
            group: "开发".to_string(),
            plan: "Pro".to_string(),
            status: "正常".to_string(),
            ..Default::default()
        }];
        let password = "MyMasterPassword@2026";
        let blob = encrypt_records(&sample, password).expect("Encrypt failed");
        let (decrypted, key, salt) = decrypt_records(&blob, password).expect("Decrypt failed");
        assert_eq!(decrypted.len(), 1);
        assert_eq!(decrypted[0].title, "GitHub");

        let blob_fast =
            encrypt_records_with_key(&decrypted, &key, &salt).expect("Fast encrypt failed");
        let (decrypted_fast, _, _) =
            decrypt_records(&blob_fast, password).expect("Fast decrypt failed");
        assert_eq!(decrypted_fast.len(), 1);

        let wrong = decrypt_records(&blob, "WrongPassword");
        assert!(wrong.is_err());
    }

    #[test]
    fn test_sqlite_vault_crud_and_rekey() {
        let temp_dir = std::env::temp_dir().join(format!("avault_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("vault.db");

        let pwd1 = "MasterPwd#1";
        let (key1, salt1) = create_vault_db_at(&db_path, pwd1).expect("Create SQLite DB failed");

        let rec = AccountRecord {
            id: "rec-1".to_string(),
            title: "OpenAI".to_string(),
            username: "user@example.com".to_string(),
            password: "Secret#Password".to_string(),
            totp: "JBSWY3DPEHPK3PXP".to_string(),
            status: "正常".to_string(),
            updated_at: 1000,
            created_at: 1000,
            ..Default::default()
        };
        upsert_record_db_at(&db_path, &rec, &key1).expect("Upsert failed");

        // Wrong password must fail
        assert!(unlock_vault_db_at(&db_path, "WrongPwd").is_err());

        // Correct password unlocks and decrypts record
        let (loaded, loaded_key, loaded_salt) =
            unlock_vault_db_at(&db_path, pwd1).expect("Unlock failed");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "OpenAI");
        assert_eq!(loaded[0].password, "Secret#Password");
        assert_eq!(loaded_key, key1);
        assert_eq!(loaded_salt, salt1);

        // Rekey with new password
        let pwd2 = "NewMasterPwd#2";
        let mut salt2 = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt2);
        let key2 = derive_key(pwd2, &salt2).unwrap();
        replace_all_records_db_at(&db_path, &loaded, &key2, &salt2).expect("Rekey failed");

        assert!(unlock_vault_db_at(&db_path, pwd1).is_err());
        let (reloaded, _, _) = unlock_vault_db_at(&db_path, pwd2).expect("Unlock with new pwd failed");
        assert_eq!(reloaded.len(), 1);
        assert_eq!(reloaded[0].totp, "JBSWY3DPEHPK3PXP");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
