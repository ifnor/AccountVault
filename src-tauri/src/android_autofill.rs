use crate::models::AccountRecord;
#[cfg(target_os = "android")]
use crate::in_app_browser::find_app_class;
#[cfg(target_os = "android")]
use crate::vault;

pub fn sync_android_autofill_records(records: &[AccountRecord]) {
    #[cfg(target_os = "android")]
    {
        let payload: Vec<serde_json::Value> = records
            .iter()
            .filter(|r| r.deleted_at.is_none())
            .map(|r| {
                serde_json::json!({
                    "id": r.id,
                    "title": r.title,
                    "account": r.primary_identifier(),
                    "password": r.password,
                    "login_url": r.login_url,
                    "totp": r.totp,
                    "passkeys": r.passkeys
                })
            })
            .collect();
        if let Ok(json) = serde_json::to_string(&payload) {
            let ctx = ndk_context::android_context();
            let vm = match unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) } {
                Ok(v) => v,
                Err(_) => return,
            };
            let mut env = match vm.attach_current_thread() {
                Ok(e) => e,
                Err(_) => return,
            };
            let context_obj = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
            if let Ok(cls) = find_app_class(&mut env, &context_obj, "com/ifnor/accountvault/MainActivity") {
                if let Ok(j_json) = env.new_string(&json) {
                    let _ = env.call_static_method(
                        cls,
                        "syncAutofillCredentials",
                        "(Landroid/content/Context;Ljava/lang/String;)Z",
                        &[
                            jni::objects::JValue::from(&context_obj),
                            jni::objects::JValue::from(&j_json),
                        ],
                    );
                }
            }
            std::mem::forget(context_obj);
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = records;
    }
}

pub fn consume_android_pending_saves(records: &mut Vec<AccountRecord>, key: &[u8; 32]) {
    #[cfg(target_os = "android")]
    {
        #[derive(serde::Deserialize)]
        struct PendingSave {
            title: String,
            url: String,
            account: String,
            password: String,
            #[serde(default)]
            passkey: Option<models::PasskeyCredential>,
        }
        let ctx = ndk_context::android_context();
        let vm = match unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) } {
            Ok(v) => v,
            Err(_) => return,
        };
        let mut env = match vm.attach_current_thread() {
            Ok(e) => e,
            Err(_) => return,
        };
        let context_obj = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
        let json_str = if let Ok(cls) = find_app_class(&mut env, &context_obj, "com/ifnor/accountvault/MainActivity") {
            match env.call_static_method(
                cls,
                "consumePendingAutofillSaves",
                "(Landroid/content/Context;)Ljava/lang/String;",
                &[jni::objects::JValue::from(&context_obj)],
            ) {
                Ok(val) => match val.l() {
                    Ok(obj) => env
                        .get_string(&jni::objects::JString::from(obj))
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|_| "[]".to_string()),
                    Err(_) => "[]".to_string(),
                },
                Err(_) => {
                    let _ = env.exception_clear();
                    "[]".to_string()
                }
            }
        } else {
            "[]".to_string()
        };
        std::mem::forget(context_obj);

        if let Ok(items) = serde_json::from_str::<Vec<PendingSave>>(&json_str) {
            let now = chrono::Utc::now().timestamp();
            for item in items {
                let acc = item.account.trim().to_string();
                let has_pk = item.passkey.is_some();
                if (acc.is_empty() || item.password.is_empty()) && !has_pk {
                    continue;
                }
                let is_email = acc.contains('@');
                let rec = AccountRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: if item.title.trim().is_empty() {
                        if has_pk { "PassKey 通行密钥".to_string() } else { "系统自动填充保存".to_string() }
                    } else {
                        item.title.trim().to_string()
                    },
                    login_url: item.url.trim().to_string(),
                    username: if is_email { String::new() } else { acc.clone() },
                    email: if is_email { acc.clone() } else { String::new() },
                    password: item.password,
                    group: if has_pk { "Passkey 通行密钥".to_string() } else { "自动填充保存".to_string() },
                    passkeys: item.passkey.into_iter().collect(),
                    created_at: now,
                    updated_at: now,
                    ..Default::default()
                };
                if vault::save_record_to_db(&rec, key).is_ok() {
                    records.push(rec);
                }
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (records, key);
    }
}

#[tauri::command]
pub fn get_android_autofill_status() -> bool {
    #[cfg(target_os = "android")]
    {
        let ctx = ndk_context::android_context();
        let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }) else {
            return false;
        };
        let Ok(mut env) = vm.attach_current_thread() else {
            return false;
        };
        let context_obj = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
        let res = if let Ok(cls) = find_app_class(&mut env, &context_obj, "com/ifnor/accountvault/MainActivity") {
            match env.call_static_method(
                cls,
                "isAutofillServiceEnabled",
                "(Landroid/content/Context;)Z",
                &[jni::objects::JValue::from(&context_obj)],
            ) {
                Ok(val) => val.z().unwrap_or(false),
                Err(_) => {
                    let _ = env.exception_clear();
                    false
                }
            }
        } else {
            false
        };
        std::mem::forget(context_obj);
        res
    }
    #[cfg(not(target_os = "android"))]
    {
        false
    }
}

#[tauri::command]
pub fn open_android_autofill_settings() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("获取 JavaVM 失败: {e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("附加线程失败: {e}"))?;
        let context_obj = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
        let cls = find_app_class(&mut env, &context_obj, "com/ifnor/accountvault/MainActivity")?;
        let ok = match env.call_static_method(
            cls,
            "openAutofillSettings",
            "(Landroid/content/Context;)Z",
            &[jni::objects::JValue::from(&context_obj)],
        ) {
            Ok(val) => val.z().unwrap_or(false),
            Err(e) => {
                let _ = env.exception_clear();
                std::mem::forget(context_obj);
                return Err(format!("打开系统自动填充设置失败: {e}"));
            }
        };
        std::mem::forget(context_obj);
        Ok(ok)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(false)
    }
}