use crate::models::AccountRecord;
use crate::vault;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupFileInfo {
    pub filename: String,
    pub timestamp: String,
    pub size_bytes: u64,
}

pub fn list_backups() -> Result<Vec<BackupFileInfo>, String> {
    let backup_dir = vault::vault_data_dir().join("backups");
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    let entries = fs::read_dir(&backup_dir).map_err(|e| format!("读取备份目录失败: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let is_backup = path
            .extension()
            .is_some_and(|ext| ext == "db" || ext == "avault");
        if is_backup
            && let Ok(metadata) = entry.metadata() {
                let filename = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let timestamp = if let Ok(time) = metadata.modified() {
                    let dt: chrono::DateTime<chrono::Local> = time.into();
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                } else {
                    "—".to_string()
                };

                result.push(BackupFileInfo {
                    filename,
                    timestamp,
                    size_bytes: metadata.len(),
                });
            }
    }

    result.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(result)
}

pub fn create_snapshot_now() -> Result<BackupFileInfo, String> {
    let backup_file = vault::create_db_snapshot(30, Some("manual"))?;
    let filename = backup_file
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let size_bytes = fs::metadata(&backup_file).map(|m| m.len()).unwrap_or(0);
    let now = chrono::Local::now();
    Ok(BackupFileInfo {
        filename,
        timestamp: now.format("%Y-%m-%d %H:%M:%S").to_string(),
        size_bytes,
    })
}

pub fn restore_backup(filename: &str, master_password: &str) -> Result<Vec<AccountRecord>, String> {
    let backup_path = vault::vault_data_dir().join("backups").join(filename);
    if !backup_path.exists() {
        return Err(format!("备份文件不存在: {filename}"));
    }

    let (records, key, salt) = if backup_path.extension().is_some_and(|ext| ext == "db") {
        vault::unlock_vault_db_at(&backup_path, master_password)?
    } else {
        let blob = fs::read_to_string(&backup_path).map_err(|e| format!("读取备份失败: {e}"))?;
        vault::decrypt_records(&blob, master_password)?
    };

    vault::save_vault_atomic_with_key(&records, &key, &salt, 30)?;
    Ok(records
        .into_iter()
        .filter(|r| r.deleted_at.is_none())
        .collect())
}

pub fn export_records_csv(records: &[AccountRecord]) -> String {
    let mut csv = String::from(
        "平台名称,登录账号,绑定邮箱,登录密码,账号状态,分组,登录网址,绑定手机,恢复邮箱/密保,TOTP密钥,会员/套餐,到期日期,独立代理,备用验证码,已用备用码,备注\n",
    );
    for r in records.iter().filter(|r| r.deleted_at.is_none()) {
        let status = if r.status.trim().is_empty() {
            "正常"
        } else {
            &r.status
        };
        let line = format!(
            "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
            r.title.replace('\"', "\"\""),
            r.username.replace('\"', "\"\""),
            r.email.replace('\"', "\"\""),
            r.password.replace('\"', "\"\""),
            status.replace('\"', "\"\""),
            r.group.replace('\"', "\"\""),
            r.login_url.replace('\"', "\"\""),
            r.phone.replace('\"', "\"\""),
            r.recovery_email.replace('\"', "\"\""),
            r.totp.replace('\"', "\"\""),
            r.plan.replace('\"', "\"\""),
            r.expire_at.replace('\"', "\"\""),
            r.proxy.replace('\"', "\"\""),
            r.backup_codes.replace('\"', "\"\""),
            r.used_backup_codes.replace('\"', "\"\""),
            r.notes.replace('\"', "\"\"")
        );
        csv.push_str(&line);
    }
    csv
}
