#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: u64,
    pub asset_type: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub release_url: String,
    pub download_url: Option<String>,
    pub setup_url: Option<String>,
    pub portable_url: Option<String>,
    pub apk_url: Option<String>,
    pub current_install_type: String,
    pub assets: Vec<ReleaseAsset>,
}

fn detect_install_type() -> &'static str {
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe()
            && let Some(parent) = exe_path.parent() {
                if parent.join("uninstall.exe").exists()
                    || parent.join("Uninstall 账号管家.exe").exists()
                {
                    return "setup";
                }
                let path_str = parent.to_string_lossy().to_lowercase();
                if path_str.contains("program files") || path_str.contains("programs") {
                    return "setup";
                }
            }
        "portable"
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        "desktop"
    }
}

const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

fn parse_semver(v: &str) -> (u32, u32, u32) {
    let trimmed = v.trim();
    let clean = trimmed
        .find(|c: char| c.is_ascii_digit())
        .map(|idx| &trimmed[idx..])
        .unwrap_or(trimmed);
    let parts: Vec<&str> = clean.split('.').collect();
    let major = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts
        .get(2)
        .and_then(|s| {
            s.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .ok()
        })
        .unwrap_or(0);
    (major, minor, patch)
}

#[tauri::command]
pub async fn check_github_update(
    repo: Option<String>,
    mirror: Option<String>,
) -> Result<UpdateInfo, String> {
    let target_repo = repo.unwrap_or_else(|| "ifnor/AccountVault".to_string());
    let direct_api_url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        target_repo.trim()
    );

    let mirror_prefix: Option<String> = mirror.and_then(|m| {
        let trimmed = m.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("official") {
            None
        } else if trimmed.eq_ignore_ascii_case("gh-proxy")
            || trimmed.eq_ignore_ascii_case("gh_proxy")
            || trimmed.contains("gh-proxy.com")
        {
            Some("https://gh-proxy.com/".to_string())
        } else if trimmed.eq_ignore_ascii_case("ghproxy") || trimmed.contains("ghproxy.net") {
            Some("https://ghproxy.net/".to_string())
        } else {
            let pfx = if trimmed.ends_with('/') {
                trimmed.to_string()
            } else {
                format!("{}/", trimmed)
            };
            Some(pfx)
        }
    });

    let client = reqwest::Client::builder()
        .user_agent(concat!("account-vault/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;

    let resp_res = if let Some(ref pfx) = mirror_prefix {
        let proxied_api_url = format!("{}{}", pfx, direct_api_url);
        match client.get(&proxied_api_url).send().await {
            Ok(r) if r.status().is_success() => Ok(r),
            _ => client.get(&direct_api_url).send().await,
        }
    } else {
        client.get(&direct_api_url).send().await
    };

    let resp = resp_res.map_err(|e| format!("请求 GitHub Releases 失败: {e}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            current_version: CURRENT_APP_VERSION.to_string(),
            latest_version: CURRENT_APP_VERSION.to_string(),
            has_update: false,
            release_name: "暂无发布版本".to_string(),
            release_notes: format!("仓库 {} 尚未发布任何公开 Release", target_repo),
            published_at: String::new(),
            release_url: format!("https://github.com/{}", target_repo),
            download_url: None,
            setup_url: None,
            portable_url: None,
            apk_url: None,
            current_install_type: detect_install_type().to_string(),
            assets: Vec::new(),
        });
    }

    if !resp.status().is_success() {
        return Err(format!("GitHub API 响应异常: HTTP {}", resp.status()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取 GitHub 响应文本失败: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("解析 Release JSON 失败: {e}"))?;

    let tag = json["tag_name"]
        .as_str()
        .unwrap_or(CURRENT_APP_VERSION)
        .to_string();
    let name = json["name"].as_str().unwrap_or(&tag).to_string();
    let notes = json["body"].as_str().unwrap_or("").to_string();
    let published_at = json["published_at"].as_str().unwrap_or("").to_string();
    let html_url = json["html_url"]
        .as_str()
        .unwrap_or(&format!("https://github.com/{}/releases", target_repo))
        .to_string();

    let mut asset_list = Vec::new();
    let mut setup_url = None;
    let mut portable_url = None;
    let mut apk_url = None;

    if let Some(assets) = json["assets"].as_array() {
        for asset in assets {
            if let (Some(asset_name), Some(raw_browser_url)) = (
                asset["name"].as_str(),
                asset["browser_download_url"].as_str(),
            ) {
                let browser_url = if let Some(ref pfx) = mirror_prefix {
                    format!("{}{}", pfx, raw_browser_url)
                } else {
                    raw_browser_url.to_string()
                };

                let size = asset["size"].as_u64().unwrap_or(0);
                let name_lower = asset_name.to_lowercase();
                let asset_type = if name_lower.ends_with(".apk") {
                    apk_url = Some(browser_url.clone());
                    "apk"
                } else if (name_lower.contains("setup") || name_lower.contains("installer"))
                    && name_lower.ends_with(".exe")
                {
                    setup_url = Some(browser_url.clone());
                    "setup"
                } else if name_lower.contains("portable") && name_lower.ends_with(".exe") {
                    portable_url = Some(browser_url.clone());
                    "portable"
                } else if name_lower.ends_with(".exe") {
                    if setup_url.is_none() {
                        setup_url = Some(browser_url.clone());
                    }
                    "setup"
                } else {
                    "other"
                };

                asset_list.push(ReleaseAsset {
                    name: asset_name.to_string(),
                    download_url: browser_url,
                    size,
                    asset_type: asset_type.to_string(),
                });
            }
        }
    }

    let install_type = detect_install_type();
    let download_url = match install_type {
        "android" => apk_url.clone(),
        "portable" => portable_url.clone().or_else(|| setup_url.clone()),
        _ => setup_url.clone().or_else(|| portable_url.clone()),
    };

    let current = parse_semver(CURRENT_APP_VERSION);
    let latest = parse_semver(&tag);
    let has_update = latest > current;

    Ok(UpdateInfo {
        current_version: CURRENT_APP_VERSION.to_string(),
        latest_version: tag,
        has_update,
        release_name: name,
        release_notes: notes,
        published_at,
        release_url: html_url,
        download_url,
        setup_url,
        portable_url,
        apk_url,
        current_install_type: install_type.to_string(),
        assets: asset_list,
    })
}

#[tauri::command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("打开系统浏览器链接失败: {e}"))
}

#[cfg(target_os = "android")]
fn install_apk_android(apk_path: &str) -> Result<(), String> {
    let ctx = ndk_context::android_context();
    let vm_ptr = ctx.vm();
    if vm_ptr.is_null() {
        return Err("获取 Android JavaVM 失败".to_string());
    }
    let context_ptr = ctx.context();
    if context_ptr.is_null() {
        return Err("获取 Android Context 失败".to_string());
    }

    let vm = unsafe { jni::JavaVM::from_raw(vm_ptr.cast()) }
        .map_err(|e| format!("初始化 JavaVM 句柄失败: {e}"))?;

    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("附加当前线程至 JVM 失败: {e}"))?;

    let context_obj = unsafe { jni::objects::JObject::from_raw(context_ptr.cast()) };
    let path_jstring = env
        .new_string(apk_path)
        .map_err(|e| format!("创建 APK 路径字符串失败: {e}"))?;

    let class = find_app_class(&mut env, &context_obj, "com/ifnor/accountvault/MainActivity")
        .map_err(|e| format!("未找到 MainActivity 类: {e}"))?;

    let res = env
        .call_static_method(
            class,
            "installApk",
            "(Landroid/content/Context;Ljava/lang/String;)Z",
            &[
                jni::objects::JValue::from(&context_obj),
                jni::objects::JValue::from(&path_jstring),
            ],
        )
        .map_err(|e| format!("调用 MainActivity.installApk 失败: {e}"))?;

    let success = res.z().unwrap_or(false);
    if !success {
        return Err("调用系统安装器失败，请检查文件权限或允许安装未知应用".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn start_auto_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;
    use tauri::Emitter;

    let client = reqwest::Client::builder()
        .user_agent(concat!("account-vault/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("初始化下载客户端失败: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("发起下载请求失败: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("下载响应错误: HTTP {}", resp.status()));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let url_lower = url.to_lowercase();
    let is_apk = url_lower.ends_with(".apk") || url_lower.contains(".apk?");
    let is_setup = url_lower.contains("setup") || (!url_lower.contains("portable") && !is_apk);

    let temp_dir = {
        #[cfg(target_os = "android")]
        {
            app.path()
                .app_cache_dir()
                .or_else(|_| app.path().cache_dir())
                .unwrap_or_else(|_| std::env::temp_dir())
        }
        #[cfg(not(target_os = "android"))]
        {
            std::env::temp_dir()
        }
    };

    let _ = std::fs::create_dir_all(&temp_dir);

    let temp_file_path = if is_apk {
        temp_dir.join("AccountVault_Update.apk")
    } else if is_setup {
        temp_dir.join("AccountVault_Update_Setup.exe")
    } else {
        temp_dir.join("AccountVault_Update_Portable.exe")
    };

    let mut file = std::fs::File::create(&temp_file_path)
        .map_err(|e| format!("创建更新临时文件失败: {e}"))?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_percent: u32 = 0;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("下载更新数据包中断: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入更新文件失败: {e}"))?;
        downloaded += chunk.len() as u64;

        if total_bytes > 0 {
            let percent = ((downloaded as f64 / total_bytes as f64) * 100.0) as u32;
            if percent != last_percent {
                last_percent = percent;
                let _ = app.emit(
                    "update-download-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": total_bytes,
                        "percent": percent
                    }),
                );
            }
        }
    }

    file.flush()
        .map_err(|e| format!("保存更新文件失败: {e}"))?;
    drop(file);

    let _ = app.emit(
        "update-download-progress",
        serde_json::json!({
            "downloaded": downloaded,
            "total": downloaded,
            "percent": 100
        }),
    );

    #[cfg(target_os = "windows")]
    {
        if is_setup {
            std::process::Command::new(&temp_file_path)
                .spawn()
                .map_err(|e| format!("启动安装升级程序失败: {e}"))?;
            app.exit(0);
        } else if let Ok(current_exe) = std::env::current_exe() {
            let current_exe_str = current_exe.to_string_lossy().to_string();
            let temp_str = temp_file_path.to_string_lossy().to_string();
            let cmd_arg = format!(
                "ping 127.0.0.1 -n 2 > nul & copy /y \"{}\" \"{}\" & start \"\" \"{}\"",
                temp_str, current_exe_str, current_exe_str
            );
            std::process::Command::new("cmd.exe")
                .args(["/C", &cmd_arg])
                .spawn()
                .map_err(|e| format!("启动便携程序替换进程失败: {e}"))?;
            app.exit(0);
        } else {
            std::process::Command::new(&temp_file_path)
                .spawn()
                .map_err(|e| format!("启动更新程序失败: {e}"))?;
            app.exit(0);
        }
    }

    #[cfg(target_os = "android")]
    {
        let path_str = temp_file_path.to_string_lossy().to_string();
        install_apk_android(&path_str)?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(&url, None::<&str>);
    }

    Ok(())
}
