use crate::totp;
use crate::vault;
use tauri::Manager;

#[cfg(target_os = "android")]
pub(crate) fn find_app_class<'a>(
    env: &mut jni::JNIEnv<'a>,
    context_obj: &jni::objects::JObject<'a>,
    class_name: &str,
) -> Result<jni::objects::JClass<'a>, String> {
    if let Ok(class_loader_val) =
        env.call_method(context_obj, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
    {
        if let Ok(class_loader) = class_loader_val.l() {
            let dotted = class_name.replace('/', ".");
            if let Ok(j_name) = env.new_string(&dotted) {
                let load_res = env.call_method(
                    &class_loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[jni::objects::JValue::from(&j_name)],
                );
                match load_res {
                    Ok(val) => {
                        if let Ok(cls) = val.l() {
                            return Ok(cls.into());
                        }
                    }
                    Err(_) => {
                        let _ = env.exception_clear();
                    }
                }
            }
        }
    }

    match env.find_class(class_name) {
        Ok(c) => Ok(c),
        Err(e) => {
            let _ = env.exception_clear();
            Err(format!("无法加载应用类 {class_name}: {e}"))
        }
    }
}

fn is_localhost_callback_url(u: &tauri::Url) -> bool {
    let scheme = u.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    matches!(
        u.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("0.0.0.0")
    )
}

fn is_localhost_callback_str(raw: &str) -> bool {
    if let Ok(u) = tauri::Url::parse(raw) {
        return is_localhost_callback_url(&u);
    }
    false
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn build_localhost_callback_html(callback_url: &str, account_label: &str) -> String {
    let mut port_str = "本地回环".to_string();
    let mut code_param = String::new();

    if let Ok(parsed) = tauri::Url::parse(callback_url) {
        if let Some(p) = parsed.port() {
            port_str = format!("端口: {p}");
        }
        for (k, v) in parsed.query_pairs() {
            if k == "code" && !v.is_empty() {
                code_param = v.to_string();
                break;
            }
        }
        if code_param.is_empty()
            && let Some(frag) = parsed.fragment()
                && let Ok(frag_url) = tauri::Url::parse(&format!("http://localhost/?{frag}")) {
                    for (k, v) in frag_url.query_pairs() {
                        if (k == "code" || k == "access_token") && !v.is_empty() {
                            code_param = v.to_string();
                            break;
                        }
                    }
                }
    }

    let safe_url_html = html_escape(callback_url);
    let safe_account_html = html_escape(account_label);
    let safe_port_html = html_escape(&port_str);
    let safe_code_html = html_escape(&code_param);
    let url_json = serde_json::to_string(callback_url).unwrap_or_else(|_| "\"\"".to_string());
    let code_json = serde_json::to_string(&code_param).unwrap_or_else(|_| "\"\"".to_string());

    let code_section_html = if !code_param.is_empty() {
        format!(
            r###"
            <div style="margin-top:16px;padding:14px 16px;background:#f8fafd;border-radius:16px;border:1px solid #dadce0;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div style="min-width:0;flex:1;text-align:left;">
                    <div style="font-size:12px;color:#5f6368;font-weight:500;">已自动提取授权码 (<code style="color:#1a73e8;font-family:Consolas,monospace;">code</code> 参数)</div>
                    <div id="avaultCodeVal" style="font-family:Consolas,Monaco,monospace;font-size:12px;font-weight:600;color:#202124;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px;user-select:all;">{safe_code_html}</div>
                </div>
                <button id="avaultCopyCodeBtn" type="button" onclick="copyCode()" style="padding:7px 14px;background:#ffffff;color:#1a73e8;border:1px solid #dadce0;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;transition:all 0.15s;">
                    仅复制 Code
                </button>
            </div>
            "###
        )
    } else {
        String::new()
    };

    format!(
        r###"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>已捕获回调地址 - 账号管家</title>
</head>
<body style="min-height:100vh;margin:0;padding:24px;background:#f0f4f9;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif;box-sizing:border-box;">
    <div style="width:100%;max-width:520px;background:#ffffff;color:#202124;border:1px solid #dadce0;border-radius:24px;padding:28px;box-shadow:0 12px 32px rgba(0,0,0,0.08);box-sizing:border-box;">
        <div style="display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:20px;">
            <div style="width:42px;height:42px;border-radius:14px;background:#e8f0fe;color:#1a73e8;display:flex;align-items:center;justify-content:center;margin-bottom:10px;">
                <svg style="width:22px;height:22px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            </div>

            <h1 style="font-size:17px;font-weight:700;color:#202124;margin:2px 0;">已捕获回调地址</h1>
            <p style="font-size:12px;color:#5f6368;margin:4px 0 0 0;">当前授权账号：<span style="font-weight:600;color:#1a73e8;">{safe_account_html}</span></p>
            <div id="avaultLocalSyncNote" style="margin-top:10px;width:100%;padding:8px 12px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;font-size:12px;color:#166534;line-height:1.45;box-sizing:border-box;">
                ⚡ 正在同步将授权结果送达监听服务…
            </div>
        </div>

        <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <label style="font-size:12px;font-weight:600;color:#3c4043;">完整回调地址 (Callback URL)</label>
                <span style="font-size:12px;color:#80868b;font-family:Consolas,monospace;">{safe_port_html}</span>
            </div>

            <textarea id="avaultUrlInput" readonly rows="4" onclick="this.select()" style="width:100%;padding:12px;background:#f8fafd;border-radius:16px;border:1px solid #dadce0;font-family:Consolas,Monaco,monospace;font-size:12px;color:#202124;outline:none;resize:none;line-height:1.55;word-break:break-all;box-sizing:border-box;">{safe_url_html}</textarea>

            <button id="avaultCopyUrlBtn" type="button" onclick="copyFull()" style="margin-top:10px;width:100%;padding:11px 16px;background:#1a73e8;color:#ffffff;border:none;border-radius:12px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;box-shadow:0 2px 6px rgba(26,115,232,0.25);transition:all 0.15s;">
                <span id="avaultCopyBtnText">一键复制完整回调地址</span>
            </button>

            <button id="avaultJumpBtn" type="button" onclick="jumpToCallback()" style="margin-top:10px;width:100%;padding:10px 16px;background:#ffffff;color:#1a73e8;border:1px solid #dadce0;border-radius:12px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all 0.15s;">
                <span id="avaultJumpBtnText">跳转回调地址</span>
            </button>
        </div>

        {code_section_html}
    </div>

    <script>
        let fullUrl = {url_json};
        let codeParam = {code_json};
        let jumpResetTimer = null;

        (function syncLocationHash() {{
            try {{
                if (window.location && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(window.location.href)) {{
                    if (window.location.href.length > fullUrl.length && !window.location.href.includes("__avault_")) {{
                        fullUrl = window.location.href;
                        const urlInput = document.getElementById("avaultUrlInput");
                        if (urlInput) urlInput.value = fullUrl;
                    }}
                }}
            }} catch (_) {{}}
        }})();

        window.__avaultSetLocalStatus = function(localOk, isManual) {{
            const note = document.getElementById("avaultLocalSyncNote");
            const jumpBtn = document.getElementById("avaultJumpBtn");
            const jumpBtnText = document.getElementById("avaultJumpBtnText");
            if (localOk) {{
                if (note) {{
                    note.style.background = "#ecfdf5";
                    note.style.borderColor = "#6ee7b7";
                    note.style.color = "#065f46";
                    note.innerHTML = "✓ 回调已完成，已同步将授权结果送达监听服务";
                }}
                if (isManual && jumpBtn && jumpBtnText) {{
                    jumpBtn.style.background = "#ecfdf5";
                    jumpBtn.style.color = "#047857";
                    jumpBtn.style.borderColor = "#6ee7b7";
                    jumpBtnText.innerText = "✓ 已完成回调地址跳转！";
                }}
            }} else {{
                if (note) {{
                    note.style.background = "#eff6ff";
                    note.style.borderColor = "#bfdbfe";
                    note.style.color = "#1e40af";
                    note.innerHTML = "ℹ️ 未检测到本机开启该端口监听，请直接点击下方按钮复制回调地址或 Code";
                }}
                if (isManual && jumpBtn && jumpBtnText) {{
                    jumpBtn.style.background = "#eff6ff";
                    jumpBtn.style.color = "#1e40af";
                    jumpBtn.style.borderColor = "#bfdbfe";
                    jumpBtnText.innerText = "✓ 已触发回调（本机未监听该端口）";
                }}
            }}
            if (isManual && jumpBtn && jumpBtnText) {{
                if (jumpResetTimer) clearTimeout(jumpResetTimer);
                jumpResetTimer = setTimeout(() => {{
                    jumpBtn.style.background = "#ffffff";
                    jumpBtn.style.color = "#1a73e8";
                    jumpBtn.style.borderColor = "#dadce0";
                    jumpBtnText.innerText = "跳转回调地址";
                }}, 2200);
            }}
        }};

        function copyTextFallback(text) {{
            if (navigator.clipboard && navigator.clipboard.writeText) {{
                navigator.clipboard.writeText(text).catch(() => fallbackExecCopy(text));
            }} else {{
                fallbackExecCopy(text);
            }}
        }}

        function fallbackExecCopy(text) {{
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try {{ document.execCommand("copy"); }} catch (_) {{}}
            document.body.removeChild(ta);
        }}

        function copyFull() {{
            const urlInput = document.getElementById("avaultUrlInput");
            const copyUrlBtn = document.getElementById("avaultCopyUrlBtn");
            const copyBtnText = document.getElementById("avaultCopyBtnText");
            if (urlInput) urlInput.select();
            copyTextFallback(fullUrl);
            if (copyUrlBtn) copyUrlBtn.style.background = "#059669";
            if (copyBtnText) copyBtnText.innerText = "✓ 已成功复制完整回调地址！";
            setTimeout(() => {{
                if (copyUrlBtn) copyUrlBtn.style.background = "#1a73e8";
                if (copyBtnText) copyBtnText.innerText = "一键复制完整回调地址";
            }}, 2000);
        }}

        function jumpToCallback() {{
            const jumpBtn = document.getElementById("avaultJumpBtn");
            const jumpBtnText = document.getElementById("avaultJumpBtnText");
            const note = document.getElementById("avaultLocalSyncNote");
            if (jumpBtnText) jumpBtnText.innerText = "正在触发回调地址…";
            if (note) {{
                note.style.background = "#f0fdf4";
                note.style.borderColor = "#bbf7d0";
                note.style.color = "#166534";
                note.innerHTML = "⚡ 正在同步将授权结果送达监听服务…";
            }}
            try {{
                const oldFrame = document.getElementById("avaultManualTriggerFrame");
                if (oldFrame && oldFrame.parentNode) oldFrame.parentNode.removeChild(oldFrame);
                const pFrame = document.createElement("iframe");
                pFrame.id = "avaultManualTriggerFrame";
                pFrame.style.display = "none";
                pFrame.src = "http://localhost/__avault_manual_callback__?t=" + Date.now();
                document.body.appendChild(pFrame);
            }} catch (_) {{}}
            if (jumpResetTimer) clearTimeout(jumpResetTimer);
            jumpResetTimer = setTimeout(() => {{
                if (jumpBtn) {{
                    jumpBtn.style.background = "#ffffff";
                    jumpBtn.style.color = "#1a73e8";
                    jumpBtn.style.borderColor = "#dadce0";
                }}
                if (jumpBtnText && jumpBtnText.innerText === "正在触发回调地址…") {{
                    jumpBtnText.innerText = "跳转回调地址";
                }}
            }}, 3500);
        }}

        function copyCode() {{
            const copyCodeBtn = document.getElementById("avaultCopyCodeBtn");
            copyTextFallback(codeParam);
            if (copyCodeBtn) {{
                copyCodeBtn.innerText = "✓ 已复制";
                copyCodeBtn.style.background = "#ecfdf5";
                copyCodeBtn.style.color = "#047857";
                copyCodeBtn.style.borderColor = "#6ee7b7";
                setTimeout(() => {{
                    copyCodeBtn.innerText = "仅复制 Code";
                    copyCodeBtn.style.background = "#ffffff";
                    copyCodeBtn.style.color = "#1a73e8";
                    copyCodeBtn.style.borderColor = "#dadce0";
                }}, 2000);
            }}
        }}
    </script>
</body>
</html>"###
    )
}

#[cfg(target_os = "windows")]
fn trigger_localhost_callback_in_background(
    window: tauri::WebviewWindow,
    callback_url: String,
    is_manual: bool,
) {
    tauri::async_runtime::spawn(async move {
        let client_res = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(std::time::Duration::from_millis(1200))
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let host = attempt.url().host_str().unwrap_or("");
                if host.eq_ignore_ascii_case("localhost")
                    || host == "127.0.0.1"
                    || host == "::1"
                    || host == "[::1]"
                {
                    if attempt.previous().len() >= 5 {
                        attempt.stop()
                    } else {
                        attempt.follow()
                    }
                } else {
                    attempt.stop()
                }
            }))
            .build();

        let local_ok = if let Ok(client) = client_res {
            let mut ok = false;
            if let Ok(mut parsed) = tauri::Url::parse(&callback_url)
                && parsed
                    .host_str()
                    .map(|h| h.eq_ignore_ascii_case("localhost"))
                    .unwrap_or(false)
                {
                    let host_header = match parsed.port() {
                        Some(p) => format!("localhost:{p}"),
                        None => "localhost".to_string(),
                    };
                    if parsed.set_host(Some("127.0.0.1")).is_ok()
                        && client
                            .get(parsed.as_str())
                            .header("Host", host_header)
                            .send()
                            .await
                            .is_ok()
                        {
                            ok = true;
                        }
                }
            if !ok {
                ok = client.get(&callback_url).send().await.is_ok();
            }
            ok
        } else {
            false
        };

        let js = format!(
            "if (window.__avaultSetLocalStatus) {{ window.__avaultSetLocalStatus({}, {}); }}",
            if local_ok { "true" } else { "false" },
            if is_manual { "true" } else { "false" }
        );
        std::thread::spawn(move || {
            let delays: &[u64] = if is_manual {
                &[0, 100]
            } else {
                &[0, 120, 400, 1000]
            };
            for &delay_ms in delays {
                if delay_ms > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                }
                let _ = window.eval(&js);
            }
        });
    });
}

#[cfg(target_os = "windows")]
fn attach_webview2_localhost_interceptor(
    window: &tauri::WebviewWindow,
    account_label: String,
    initial_localhost_url: Option<String>,
) {
    let win_for_webview = window.clone();
    let _ = window.with_webview(move |webview| {
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT, ICoreWebView2, ICoreWebView2_2,
                ICoreWebView2NewWindowRequestedEventArgs,
                ICoreWebView2WebResourceRequestedEventArgs,
            };
            use webview2_com::{
                NewWindowRequestedEventHandler, WebResourceRequestedEventHandler,
            };
            use windows::Win32::Foundation::E_FAIL;
            use windows::Win32::UI::Shell::SHCreateMemStream;
            use windows::core::{Interface, PCWSTR, PWSTR};

            let Ok(core_wv2) = webview.controller().CoreWebView2() else {
                return;
            };

            let new_win_handler = NewWindowRequestedEventHandler::create(Box::new(
                move |wv: Option<ICoreWebView2>,
                      args: Option<ICoreWebView2NewWindowRequestedEventArgs>| {
                    let Some(args) = args else { return Ok(()) };
                    let mut uri_pwstr = PWSTR::null();
                    if args.Uri(&mut uri_pwstr).is_err() || uri_pwstr.is_null() {
                        return Ok(());
                    }
                    let uri_str = uri_pwstr.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(uri_pwstr.0 as *const _));

                    if uri_str.starts_with("http://") || uri_str.starts_with("https://") {
                        let needs_opener = uri_str.contains("redirect_uri=postmessage")
                            || uri_str.contains("storagerelay%3A")
                            || uri_str.contains("storagerelay:");
                        if !needs_opener {
                            let _ = args.SetHandled(true);
                            if let Some(wv) = wv {
                                let wide_uri: Vec<u16> =
                                    uri_str.encode_utf16().chain(std::iter::once(0)).collect();
                                let _ = wv.Navigate(PCWSTR(wide_uri.as_ptr()));
                            }
                        }
                    }
                    Ok(())
                },
            ));
            let mut new_win_token = 0i64;
            let _ = core_wv2.add_NewWindowRequested(&new_win_handler, &mut new_win_token);

            for pattern in [
                "*",
                "http://localhost/*",
                "http://localhost:*/*",
                "https://localhost/*",
                "https://localhost:*/*",
                "http://127.0.0.1/*",
                "http://127.0.0.1:*/*",
                "https://127.0.0.1/*",
                "https://127.0.0.1:*/*",
            ] {
                let wide: Vec<u16> = pattern.encode_utf16().chain(std::iter::once(0)).collect();
                let _ = core_wv2.AddWebResourceRequestedFilter(
                    PCWSTR(wide.as_ptr()),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                );
            }

            let env_res = core_wv2
                .cast::<ICoreWebView2_2>()
                .and_then(|wv2_2| wv2_2.Environment());

            let label_for_handler = account_label.clone();
            let win_for_handler = win_for_webview.clone();
            let latest_callback_url = std::sync::Arc::new(std::sync::Mutex::new(
                initial_localhost_url.clone().unwrap_or_default(),
            ));
            let last_auto_triggered = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let handler = WebResourceRequestedEventHandler::create(Box::new(
                move |wv: Option<ICoreWebView2>,
                      args: Option<ICoreWebView2WebResourceRequestedEventArgs>| {
                    let Some(args) = args else { return Ok(()) };
                    let Ok(req) = args.Request() else { return Ok(()) };
                    let mut uri_pwstr = PWSTR::null();
                    if req.Uri(&mut uri_pwstr).is_err() || uri_pwstr.is_null() {
                        return Ok(());
                    }
                    let uri_str = uri_pwstr.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(uri_pwstr.0 as *const _));

                    if uri_str.contains("__avault_manual_callback__") {
                        let cb_url = latest_callback_url
                            .lock()
                            .ok()
                            .map(|g| g.clone())
                            .unwrap_or_default();
                        if !cb_url.is_empty() {
                            trigger_localhost_callback_in_background(
                                win_for_handler.clone(),
                                cb_url,
                                true,
                            );
                        }
                        if let Ok(ref env) = env_res
                            && let Some(stream) = SHCreateMemStream(Some(b"ok")) {
                                let status_wide: Vec<u16> = "OK".encode_utf16().chain(std::iter::once(0)).collect();
                                let headers_wide: Vec<u16> = "Content-Type: text/plain\r\nCache-Control: no-store"
                                    .encode_utf16()
                                    .chain(std::iter::once(0))
                                    .collect();
                                if let Ok(resp) = env.CreateWebResourceResponse(
                                    &stream,
                                    200,
                                    PCWSTR(status_wide.as_ptr()),
                                    PCWSTR(headers_wide.as_ptr()),
                                ) {
                                    let _ = args.SetResponse(&resp);
                                }
                            }
                        return Ok(());
                    }

                    if is_localhost_callback_str(&uri_str) {
                        if let Ok(mut guard) = latest_callback_url.lock() {
                            *guard = uri_str.clone();
                        }
                        let should_auto = if let Ok(mut guard) = last_auto_triggered.lock() {
                            if *guard != uri_str {
                                *guard = uri_str.clone();
                                true
                            } else {
                                false
                            }
                        } else {
                            true
                        };
                        if should_auto {
                            trigger_localhost_callback_in_background(
                                win_for_handler.clone(),
                                uri_str.clone(),
                                false,
                            );
                        }

                        let html = build_localhost_callback_html(&uri_str, &label_for_handler);
                        if let Ok(ref env) = env_res {
                            let bytes = html.as_bytes();
                            if let Some(stream) = SHCreateMemStream(Some(bytes)) {
                                let status_wide: Vec<u16> = "OK".encode_utf16().chain(std::iter::once(0)).collect();
                                let headers_wide: Vec<u16> = "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store"
                                    .encode_utf16()
                                    .chain(std::iter::once(0))
                                    .collect();
                                if let Ok(resp) = env.CreateWebResourceResponse(
                                    &stream,
                                    200,
                                    PCWSTR(status_wide.as_ptr()),
                                    PCWSTR(headers_wide.as_ptr()),
                                ) {
                                    let _ = args.SetResponse(&resp);
                                    return Ok(());
                                }
                            }
                        }
                        if let Some(wv) = wv {
                            let html_wide: Vec<u16> = html.encode_utf16().chain(std::iter::once(0)).collect();
                            let _ = wv.NavigateToString(PCWSTR(html_wide.as_ptr()));
                            return Err(windows::core::Error::from_hresult(E_FAIL));
                        }
                    }
                    Ok(())
                },
            ));

            let mut token = 0i64;
            let _ = core_wv2.add_WebResourceRequested(&handler, &mut token);

            if let Some(init_url) = initial_localhost_url {
                trigger_localhost_callback_in_background(
                    win_for_webview.clone(),
                    init_url.clone(),
                    false,
                );
                let html = build_localhost_callback_html(&init_url, &account_label);
                let html_wide: Vec<u16> = html.encode_utf16().chain(std::iter::once(0)).collect();
                let _ = core_wv2.NavigateToString(PCWSTR(html_wide.as_ptr()));
            }
        }
    });
}

fn build_session_label(session_key: &str) -> String {
    let clean = session_key.trim().to_lowercase();
    let key_uuid = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, clean.as_bytes());
    format!("browser-{}", &key_uuid.to_string()[..8])
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn open_in_app_browser(
    _app: tauri::AppHandle,
    session_key: String,
    title: Option<String>,
    username: Option<String>,
    email: Option<String>,
    password: Option<String>,
    totp_secret: Option<String>,
    recovery_email: Option<String>,
    proxy: Option<String>,
    url: String,
) -> Result<(), String> {
    let safe_label = build_session_label(&session_key);
    let primary_account = username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| email.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .unwrap_or("")
        .to_string();
    let platform_title = title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("独立会话")
        .to_string();

    let mut parsed_url = tauri::Url::parse(&url).map_err(|e| format!("无效网址: {e}"))?;
    let hint_email = email
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&primary_account);
    if !hint_email.is_empty()
        && parsed_url
            .host_str()
            .map(|h| h.eq_ignore_ascii_case("accounts.google.com"))
            .unwrap_or(false)
    {
        let path = parsed_url.path();
        let is_oauth_or_login = path.contains("/oauth")
            || path.contains("/signin")
            || path.contains("/ServiceLogin")
            || path.contains("/AccountChooser")
            || path.contains("/v3/signin");
        let has_login_hint = parsed_url
            .query_pairs()
            .any(|(k, _)| k.eq_ignore_ascii_case("login_hint"));
        if is_oauth_or_login && !has_login_hint {
            parsed_url
                .query_pairs_mut()
                .append_pair("login_hint", hint_email);
        }
    }

    let safe_title_json =
        serde_json::to_string(&platform_title).unwrap_or_else(|_| "\"\"".to_string());
    let safe_account_json =
        serde_json::to_string(&primary_account).unwrap_or_else(|_| "\"\"".to_string());
    let safe_email_json = serde_json::to_string(&email.as_deref().unwrap_or_default())
        .unwrap_or_else(|_| "\"\"".to_string());
    let safe_pwd_json = serde_json::to_string(&password.as_deref().unwrap_or_default())
        .unwrap_or_else(|_| "\"\"".to_string());
    let safe_rec_email_json =
        serde_json::to_string(&recovery_email.as_deref().unwrap_or_default())
            .unwrap_or_else(|_| "\"\"".to_string());
    let normalized_totp_secret = totp_secret
        .as_ref()
        .and_then(|s| totp::normalize_totp_secret(s).ok())
        .unwrap_or_default();
    let safe_totp_secret_json =
        serde_json::to_string(&normalized_totp_secret).unwrap_or_else(|_| "\"\"".to_string());

    let badge_char = platform_title
        .chars()
        .next()
        .or_else(|| primary_account.chars().next())
        .unwrap_or('A')
        .to_uppercase()
        .to_string();
    let safe_badge_json = serde_json::to_string(&badge_char).unwrap_or_else(|_| "\"A\"".to_string());

    let autofill_script = format!(
        r#"
        (function() {{
            const targetTitle = {safe_title_json};
            const targetAccount = {safe_account_json};
            const targetEmail = {safe_email_json} || targetAccount;
            const targetPassword = {safe_pwd_json};
            const targetTotpSecret = {safe_totp_secret_json};
            const targetRecEmail = {safe_rec_email_json};
            const badgeChar = {safe_badge_json};
            let accountFilled = false;
            let pwdFilled = false;
            let totpFilled = false;
            let lastAutoFilledTotp = "";
            let recEmailFilled = false;

            function base32ToBytes(b32) {{
                const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
                const clean = (b32 || "").replace(/[^A-Z2-7]/gi, "").toUpperCase();
                let bits = 0, value = 0;
                const out = [];
                for (let i = 0; i < clean.length; i++) {{
                    const idx = alphabet.indexOf(clean[i]);
                    if (idx === -1) continue;
                    value = (value << 5) | idx;
                    bits += 5;
                    if (bits >= 8) {{
                        out.push((value >>> (bits - 8)) & 0xff);
                        bits -= 8;
                    }}
                }}
                return new Uint8Array(out);
            }}

            function sha1Bytes(msg) {{
                const ml = msg.length * 8;
                const withOne = msg.length + 1;
                const padLen = (withOne % 64 <= 56 ? 56 : 120) - (withOne % 64);
                const totalLen = withOne + padLen + 8;
                const buf = new Uint8Array(totalLen);
                buf.set(msg, 0);
                buf[msg.length] = 0x80;
                const dv = new DataView(buf.buffer);
                dv.setUint32(totalLen - 4, ml >>> 0, false);
                dv.setUint32(totalLen - 8, Math.floor(ml / 4294967296) >>> 0, false);

                let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
                const w = new Int32Array(80);
                for (let i = 0; i < totalLen; i += 64) {{
                    for (let j = 0; j < 16; j++) {{
                        w[j] = dv.getInt32(i + j * 4, false);
                    }}
                    for (let j = 16; j < 80; j++) {{
                        const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
                        w[j] = (n << 1) | (n >>> 31);
                    }}
                    let a = h0, b = h1, c = h2, d = h3, e = h4;
                    for (let j = 0; j < 80; j++) {{
                        let f, k;
                        if (j < 20) {{
                            f = (b & c) | ((~b) & d);
                            k = 0x5a827999;
                        }} else if (j < 40) {{
                            f = b ^ c ^ d;
                            k = 0x6ed9eba1;
                        }} else if (j < 60) {{
                            f = (b & c) | (b & d) | (c & d);
                            k = 0x8f1bbcdc;
                        }} else {{
                            f = b ^ c ^ d;
                            k = 0xca62c1d6;
                        }}
                        const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
                        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
                    }}
                    h0 = (h0 + a) | 0;
                    h1 = (h1 + b) | 0;
                    h2 = (h2 + c) | 0;
                    h3 = (h3 + d) | 0;
                    h4 = (h4 + e) | 0;
                }}
                const out = new Uint8Array(20);
                const outDv = new DataView(out.buffer);
                outDv.setInt32(0, h0, false);
                outDv.setInt32(4, h1, false);
                outDv.setInt32(8, h2, false);
                outDv.setInt32(12, h3, false);
                outDv.setInt32(16, h4, false);
                return out;
            }}

            function computeRealtimeTotp(secret) {{
                if (!secret) return "";
                let key = base32ToBytes(secret);
                if (!key.length) return "";
                if (key.length > 64) key = sha1Bytes(key);
                const ipad = new Uint8Array(64);
                const opad = new Uint8Array(64);
                for (let i = 0; i < 64; i++) {{
                    const b = i < key.length ? key[i] : 0;
                    ipad[i] = b ^ 0x36;
                    opad[i] = b ^ 0x5c;
                }}
                const counter = Math.floor(Date.now() / 30000);
                const msg = new Uint8Array(8);
                const msgDv = new DataView(msg.buffer);
                msgDv.setUint32(0, Math.floor(counter / 4294967296) >>> 0, false);
                msgDv.setUint32(4, counter >>> 0, false);

                const innerInput = new Uint8Array(72);
                innerInput.set(ipad, 0);
                innerInput.set(msg, 64);
                const innerHash = sha1Bytes(innerInput);

                const outerInput = new Uint8Array(84);
                outerInput.set(opad, 0);
                outerInput.set(innerHash, 64);
                const hmac = sha1Bytes(outerInput);

                const offset = hmac[19] & 0x0f;
                const binCode = ((hmac[offset] & 0x7f) << 24) |
                                ((hmac[offset + 1] & 0xff) << 16) |
                                ((hmac[offset + 2] & 0xff) << 8) |
                                (hmac[offset + 3] & 0xff);
                return String(binCode % 1000000).padStart(6, "0");
            }}

            function isVisible(el) {{
                return !!(el && (el.offsetParent !== null || el.getClientRects().length > 0));
            }}

            function fillValueIntoInput(el, val) {{
                if (!el || !val) return false;
                try {{
                    el.focus();
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                    if (nativeSetter) {{
                        nativeSetter.call(el, val);
                    }} else {{
                        el.value = val;
                    }}
                    el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                    el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    return true;
                }} catch (_) {{
                    return false;
                }}
            }}

            function findAccountInput() {{
                const selectors = [
                    '#identifierId',
                    'input[autocomplete="username"]',
                    'input[autocomplete="email"]',
                    'input[type="email"]',
                    'input[name="login"]',
                    'input[name="username"]',
                    'input[name="account"]',
                    'input[name="identifier"]',
                    'input[name*="user" i]',
                    'input[name*="email" i]',
                    'input[id*="user" i]',
                    'input[id*="email" i]'
                ];
                for (const sel of selectors) {{
                    const el = document.querySelector(sel);
                    if (isVisible(el)) return el;
                }}
                return null;
            }}

            function findPasswordInput() {{
                const selectors = [
                    'input[name="Passwd"]',
                    'input[autocomplete="current-password"]',
                    'input[type="password"]'
                ];
                for (const sel of selectors) {{
                    const el = document.querySelector(sel);
                    if (isVisible(el)) return el;
                }}
                return null;
            }}

            function findTotpInput() {{
                const selectors = [
                    'input[name="totpPin"]',
                    '#idvPin',
                    'input[autocomplete="one-time-code"]',
                    'input[name*="totp" i]',
                    'input[name*="otp" i]',
                    'input[type="tel"][maxlength="6"]',
                    'input[inputmode="numeric"][maxlength="6"]'
                ];
                for (const sel of selectors) {{
                    const el = document.querySelector(sel);
                    if (isVisible(el)) return el;
                }}
                return null;
            }}

            function isRegisterPage() {{
                const p = (window.location.pathname || "").toLowerCase();
                if (p.includes("register") || p.includes("signup") || p.includes("sign-up") || p.includes("create-account")) {{
                    return true;
                }}
                if (document.querySelector('input[autocomplete="new-password"]')) {{
                    return true;
                }}
                const visiblePwds = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible);
                return visiblePwds.length >= 2;
            }}

            function autoFill() {{
                if (isRegisterPage()) return;
                // 1. Fill Account / Username / Email
                if (targetAccount && !accountFilled) {{
                    const accInput = findAccountInput();
                    if (accInput) {{
                        if (!accInput.value) {{
                            fillValueIntoInput(accInput, targetAccount);
                        }}
                        accountFilled = true;
                    }}
                }}

                // 2. Fill Password
                if (targetPassword && !pwdFilled) {{
                    const pwdInput = findPasswordInput();
                    if (pwdInput) {{
                        if (!pwdInput.value) {{
                            fillValueIntoInput(pwdInput, targetPassword);
                        }}
                        pwdFilled = true;
                    }}
                }}

                // 3. Fill 2FA TOTP code in real time
                if (targetTotpSecret) {{
                    const totpInput = findTotpInput();
                    if (totpInput) {{
                        const liveTotp = computeRealtimeTotp(targetTotpSecret);
                        if (liveTotp) {{
                            const shouldUpdate = !totpFilled || (totpInput.value === lastAutoFilledTotp && totpInput.value !== liveTotp);
                            if (shouldUpdate && totpInput.value !== liveTotp) {{
                                fillValueIntoInput(totpInput, liveTotp);
                                lastAutoFilledTotp = liveTotp;
                                totpFilled = true;
                            }}
                        }}
                    }}
                }}

                // 4. Fill Recovery Email if present on Google recovery prompt
                if (targetRecEmail && !recEmailFilled) {{
                    const recInput = document.getElementById("knowledge-preregistered-email-response") ||
                                     document.querySelector('input[name="knowledgePreregisteredEmailResponse"]');
                    if (isVisible(recInput)) {{
                        if (!recInput.value) {{
                            fillValueIntoInput(recInput, targetRecEmail);
                        }}
                        recEmailFilled = true;
                    }}
                }}
            }}

            let lastActiveInput = null;
            document.addEventListener("focusin", (e) => {{
                const el = e.target;
                if (el && el.tagName === "INPUT" && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio") {{
                    lastActiveInput = el;
                }}
            }}, true);

            async function copyToClipboardSafe(text) {{
                if (!text) return false;
                try {{
                    await navigator.clipboard.writeText(text);
                    return true;
                }} catch (_) {{
                    try {{
                        const ta = document.createElement("textarea");
                        ta.value = text;
                        ta.style.position = "fixed";
                        ta.style.opacity = "0";
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        ta.remove();
                        return true;
                    }} catch (_) {{
                        return false;
                    }}
                }}
            }}

            function mountFloatingCapsule() {{
                if (window !== window.top) return;
                if (document.getElementById("__avault_capsule_host__")) return;
                if (document.getElementById("avaultUrlInput")) return;
                if (!document.body && !document.documentElement) return;

                const host = document.createElement("div");
                host.id = "__avault_capsule_host__";
                host.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:24px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
                const savedTop = sessionStorage.getItem("__avault_cap_top__");
                if (savedTop) {{
                    const y = parseFloat(savedTop);
                    if (!isNaN(y) && y >= 12 && y <= window.innerHeight - 60) {{
                        host.style.bottom = "auto";
                        host.style.top = y + "px";
                    }}
                }}

                const shadow = host.attachShadow({{ mode: "open" }});
                shadow.innerHTML = `
                    <style>
                        * {{ box-sizing: border-box; user-select: none; -webkit-user-select: none; }}
                        .wrap {{ pointer-events: auto; position: relative; display: flex; flex-direction: column; align-items: flex-end; }}
                        .pill {{
                            display: inline-flex; align-items: center; gap: 6px;
                            height: 36px; padding: 0 13px; border-radius: 999px;
                            background: rgba(255, 255, 255, 0.96); color: #202124;
                            border: 1px solid rgba(26, 115, 232, 0.32);
                            box-shadow: 0 4px 16px rgba(15, 23, 42, 0.14);
                            font-size: 12px; font-weight: 600; cursor: pointer;
                            backdrop-filter: blur(10px); transition: box-shadow 0.15s, border-color 0.15s;
                        }}
                        .pill:hover {{ border-color: #1a73e8; box-shadow: 0 6px 20px rgba(26, 115, 232, 0.22); }}
                        .grip {{ color: #9aa0a6; font-size: 13px; margin-right: 1px; cursor: grab; }}
                        .code {{ font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: #1a73e8; font-weight: 700; letter-spacing: 0.5px; }}
                        .sec {{ font-size: 11px; color: #5f6368; font-weight: 500; }}
                        .panel {{
                            display: none; width: 292px; border-radius: 18px; padding: 12px;
                            background: rgba(255, 255, 255, 0.98); color: #202124;
                            border: 1px solid #dadce0;
                            box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
                            backdrop-filter: blur(12px);
                        }}
                        .panel.open {{ display: block; }}
                        .hdr {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 9px; border-bottom: 1px solid #f1f3f4; margin-bottom: 9px; }}
                        .hdr-left {{ display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; cursor: pointer; }}
                        .g-badge {{
                            width: 26px; height: 26px; border-radius: 8px; background: #e8f0fe; color: #1a73e8;
                            display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; flex-shrink: 0;
                        }}
                        .email {{ font-size: 11.5px; font-weight: 700; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
                        .sub {{ font-size: 10px; color: #5f6368; }}
                        .close-btn {{
                            width: 24px; height: 24px; border-radius: 999px; border: none; background: #f1f3f4;
                            color: #5f6368; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                        }}
                        .close-btn:hover {{ background: #e8eaed; color: #202124; }}
                        .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }}
                        .card {{
                            padding: 7px 9px; border-radius: 11px; border: 1px solid #e8eaed; background: #f8fafd;
                            cursor: pointer; text-align: left; transition: all 0.12s; display: flex; flex-direction: column; gap: 2px;
                        }}
                        .card:hover {{ border-color: #1a73e8; background: #e8f0fe; }}
                        .card.full {{ grid-column: span 2; }}
                        .c-lbl {{ font-size: 10px; color: #5f6368; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }}
                        .c-val {{ font-size: 11.5px; font-weight: 700; color: #202124; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
                        .tools {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }}
                        .t-btn {{
                            padding: 6px 2px; border-radius: 9px; border: 1px solid #e8eaed; background: #ffffff;
                            color: #3c4043; font-size: 10.5px; font-weight: 600; cursor: pointer; text-align: center; transition: all 0.12s;
                        }}
                        .t-btn:hover {{ background: #f1f3f4; border-color: #dadce0; color: #1a73e8; }}
                        .toast {{
                            position: absolute; bottom: calc(100% + 8px); right: 0;
                            background: rgba(32, 33, 36, 0.92); color: #fff; padding: 5px 11px;
                            border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.18); opacity: 0; pointer-events: none; transition: opacity 0.15s;
                        }}
                        .toast.show {{ opacity: 1; }}
                    </style>
                    <div class="wrap">
                        <div class="toast" id="capToast"></div>
                        <div class="pill" id="capPill" title="点击展开快捷凭据面板（支持上下拖拽）">
                            <span class="grip">⠿</span>
                            <span id="pillText">🔑 快捷凭据</span>
                        </div>
                        <div class="panel" id="capPanel">
                            <div class="hdr">
                                <div class="hdr-left" id="copyAccountHdr" title="点击填入并复制账号">
                                    <div class="g-badge" id="hdrBadge"></div>
                                    <div style="min-width:0;flex:1">
                                        <div class="email" id="hdrAccount"></div>
                                        <div class="sub" id="hdrTitle">点击卡片自动填入并复制</div>
                                    </div>
                                </div>
                                <button class="close-btn" id="capClose" title="收起">✕</button>
                            </div>
                            <div class="grid">
                                <button class="card" id="btnFillPwd">
                                    <div class="c-lbl"><span>🔑 登录密码</span></div>
                                    <div class="c-val" id="valPwd"></div>
                                </button>
                                <button class="card" id="btnFillTotp">
                                    <div class="c-lbl"><span>⏱️ 2FA 验证码</span><span id="valTotpSec"></span></div>
                                    <div class="c-val" id="valTotp" style="color:#1a73e8"></div>
                                </button>
                                <button class="card full" id="btnFillRec" style="display:none">
                                    <div class="c-lbl"><span>🛡️ 恢复信息 / 辅助邮箱</span></div>
                                    <div class="c-val" id="valRec"></div>
                                </button>
                            </div>
                            <div class="tools">
                                <button class="t-btn" id="btnBack" title="返回上一页">← 后退</button>
                                <button class="t-btn" id="btnReload" title="刷新当前页面">↻ 刷新</button>
                                <button class="t-btn" id="btnRefill" title="重新执行智能填充">⚡ 重填</button>
                                <button class="t-btn" id="btnCopyUrl" title="复制当前页面网址">🔗 网址</button>
                            </div>
                        </div>
                    </div>
                `;

                (document.body || document.documentElement).appendChild(host);

                const pill = shadow.getElementById("capPill");
                const pillText = shadow.getElementById("pillText");
                const panel = shadow.getElementById("capPanel");
                const toastEl = shadow.getElementById("capToast");
                const hdrBadge = shadow.getElementById("hdrBadge");
                const hdrAccount = shadow.getElementById("hdrAccount");
                const hdrTitle = shadow.getElementById("hdrTitle");
                const valPwd = shadow.getElementById("valPwd");
                const valTotp = shadow.getElementById("valTotp");
                const valTotpSec = shadow.getElementById("valTotpSec");
                const btnFillRec = shadow.getElementById("btnFillRec");
                const valRec = shadow.getElementById("valRec");

                hdrBadge.textContent = badgeChar;
                hdrAccount.textContent = targetAccount || targetEmail || "未指定账号";
                hdrTitle.textContent = (targetTitle || "独立会话") + " · 点击复制/填入账号";
                valPwd.textContent = targetPassword ? "••••••••" : "未记录";
                if (targetRecEmail) {{
                    btnFillRec.style.display = "flex";
                    valRec.textContent = targetRecEmail;
                }}

                let toastTimer = null;
                function showCapToast(msg) {{
                    toastEl.textContent = msg;
                    toastEl.classList.add("show");
                    if (toastTimer) clearTimeout(toastTimer);
                    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
                }}

                let autoCollapseTimer = null;
                function resetAutoCollapse() {{
                    if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
                    autoCollapseTimer = setTimeout(() => {{
                        panel.classList.remove("open");
                        pill.style.display = "inline-flex";
                    }}, 8000);
                }}

                function openPanel() {{
                    pill.style.display = "none";
                    panel.classList.add("open");
                    resetAutoCollapse();
                }}

                function closePanel() {{
                    if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
                    panel.classList.remove("open");
                    pill.style.display = "inline-flex";
                }}

                let startY = 0, startTop = 0, dragging = false;
                pill.addEventListener("mousedown", (e) => {{
                    if (e.button !== 0) return;
                    startY = e.clientY;
                    startTop = host.getBoundingClientRect().top;
                    dragging = false;

                    const onMove = (me) => {{
                        const dy = me.clientY - startY;
                        if (Math.abs(dy) > 5) {{
                            dragging = true;
                            const nextTop = Math.max(12, Math.min(window.innerHeight - 52, startTop + dy));
                            host.style.bottom = "auto";
                            host.style.top = nextTop + "px";
                            sessionStorage.setItem("__avault_cap_top__", String(nextTop));
                        }}
                    }};
                    const onUp = () => {{
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                        if (!dragging) {{
                            openPanel();
                        }}
                    }};
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                }});

                shadow.getElementById("capClose").addEventListener("click", (e) => {{
                    e.stopPropagation();
                    closePanel();
                }});

                shadow.getElementById("copyAccountHdr").addEventListener("click", async () => {{
                    resetAutoCollapse();
                    const val = targetAccount || targetEmail;
                    if (!val) return;
                    await copyToClipboardSafe(val);
                    const accEl = findAccountInput() || lastActiveInput;
                    const filled = fillValueIntoInput(accEl, val);
                    showCapToast(filled ? "✓ 已填入并复制账号" : "✓ 已复制账号");
                }});

                shadow.getElementById("btnFillPwd").addEventListener("click", async () => {{
                    resetAutoCollapse();
                    if (!targetPassword) {{
                        showCapToast("当前账号未记录密码");
                        return;
                    }}
                    await copyToClipboardSafe(targetPassword);
                    const pwdEl = findPasswordInput() || lastActiveInput;
                    const filled = fillValueIntoInput(pwdEl, targetPassword);
                    showCapToast(filled ? "✓ 已填入并复制密码" : "✓ 已复制密码");
                }});

                shadow.getElementById("btnFillTotp").addEventListener("click", async () => {{
                    resetAutoCollapse();
                    const code = computeRealtimeTotp(targetTotpSecret);
                    if (!code) {{
                        showCapToast("当前账号未配置 2FA 密钥");
                        return;
                    }}
                    await copyToClipboardSafe(code);
                    const totpEl = findTotpInput() || lastActiveInput;
                    const filled = fillValueIntoInput(totpEl, code);
                    showCapToast(filled ? `✓ 已填入并复制验证码 ${{code}}` : `✓ 已复制验证码 ${{code}}`);
                }});

                btnFillRec.addEventListener("click", async () => {{
                    resetAutoCollapse();
                    if (!targetRecEmail) return;
                    await copyToClipboardSafe(targetRecEmail);
                    const recEl = document.getElementById("knowledge-preregistered-email-response") ||
                                  document.querySelector('input[name="knowledgePreregisteredEmailResponse"]') ||
                                  document.querySelector('input[type="email"]') ||
                                  lastActiveInput;
                    const filled = fillValueIntoInput(recEl, targetRecEmail);
                    showCapToast(filled ? "✓ 已填入并复制恢复信息" : "✓ 已复制恢复信息");
                }});

                shadow.getElementById("btnBack").addEventListener("click", () => {{
                    window.history.back();
                }});
                shadow.getElementById("btnReload").addEventListener("click", () => {{
                    window.location.reload();
                }});
                shadow.getElementById("btnRefill").addEventListener("click", () => {{
                    resetAutoCollapse();
                    accountFilled = false;
                    pwdFilled = false;
                    totpFilled = false;
                    recEmailFilled = false;
                    autoFill();
                    showCapToast("⚡ 已重新执行自动填充");
                }});
                shadow.getElementById("btnCopyUrl").addEventListener("click", async () => {{
                    resetAutoCollapse();
                    await copyToClipboardSafe(window.location.href);
                    showCapToast("✓ 已复制当前页面网址");
                }});

                function refreshCapsuleTotp() {{
                    if (targetTotpSecret) {{
                        const code = computeRealtimeTotp(targetTotpSecret);
                        const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
                        if (code) {{
                            const fmt = code.slice(0, 3) + " " + code.slice(3);
                            pillText.innerHTML = `⏱️ <span class="code">${{fmt}}</span> <span class="sec">(${{rem}}s)</span>`;
                            valTotp.textContent = fmt;
                            valTotpSec.textContent = rem + "s";
                            return;
                        }}
                    }}
                    pillText.textContent = targetRecEmail ? "🛡️ 辅助凭据" : "🔑 快捷凭据";
                    valTotp.textContent = "未配置";
                    valTotpSec.textContent = "";
                }}

                refreshCapsuleTotp();
                setInterval(refreshCapsuleTotp, 1000);
            }}

            function tickAll() {{
                autoFill();
                mountFloatingCapsule();
            }}

            window.addEventListener("DOMContentLoaded", tickAll);
            window.addEventListener("load", tickAll);
            const observer = new MutationObserver(tickAll);
            if (document.documentElement) {{
                observer.observe(document.documentElement, {{ childList: true, subtree: true }});
            }}
            const timer = setInterval(tickAll, 400);
            setTimeout(() => {{
                clearInterval(timer);
                observer.disconnect();
            }}, 600000);
        }})();
        "#
    );

    #[cfg(target_os = "android")]
    {
        let _ = (
            safe_label,
            safe_title_json,
            safe_account_json,
            safe_email_json,
            safe_pwd_json,
            safe_rec_email_json,
            normalized_totp_secret,
            safe_totp_secret_json,
            safe_badge_json,
            autofill_script,
            proxy,
        );
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
        let account_j = env.new_string(&primary_account).map_err(|e| e.to_string())?;
        let url_j = env.new_string(parsed_url.as_str()).map_err(|e| e.to_string())?;
        let pwd_j = env
            .new_string(password.unwrap_or_default())
            .map_err(|e| e.to_string())?;
        let totp_j = env
            .new_string(totp_secret.unwrap_or_default())
            .map_err(|e| e.to_string())?;
        let rec_email_j = env
            .new_string(recovery_email.unwrap_or_default())
            .map_err(|e| e.to_string())?;
        let title_j = env.new_string(&platform_title).map_err(|e| e.to_string())?;
        let session_j = env.new_string(&session_key).map_err(|e| e.to_string())?;

        let class_res = find_app_class(&mut env, &context_obj, "com/ifnor/accountvault/MainActivity");
        let opened = if let Ok(class) = class_res {
            let res = env.call_static_method(
                class,
                "openIsolatedBrowser",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z",
                &[
                    jni::objects::JValue::from(&context_obj),
                    jni::objects::JValue::from(&account_j),
                    jni::objects::JValue::from(&url_j),
                    jni::objects::JValue::from(&pwd_j),
                    jni::objects::JValue::from(&totp_j),
                    jni::objects::JValue::from(&rec_email_j),
                    jni::objects::JValue::from(&title_j),
                    jni::objects::JValue::from(&session_j),
                ],
            );
            match res {
                Ok(v) => v.z().unwrap_or(false),
                Err(e) => {
                    eprintln!("JNI 调用 openIsolatedBrowser 异常: {e}");
                    let _ = env.exception_clear();
                    false
                }
            }
        } else {
            eprintln!("find_app_class MainActivity 失败");
            false
        };

        if !opened {
            let _ = tauri_plugin_opener::open_url(parsed_url.as_str(), None::<&str>);
        }

        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    {
        let app = &_app;
        if let Some(w) = app.get_webview_window(&safe_label) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.navigate(parsed_url);
            let _ = w.eval(&autofill_script);
            return Ok(());
        }

        let session_dir = vault::vault_data_dir().join("sessions").join(&safe_label);
        let _ = std::fs::create_dir_all(&session_dir);

        let clean_proxy = proxy.as_deref().unwrap_or("").trim().to_string();
        let display_name = if primary_account.is_empty() {
            platform_title.clone()
        } else {
            format!("{platform_title} · {primary_account}")
        };
        let window_title = if !clean_proxy.is_empty() {
            format!("独立会话 - {} [独立代理: {}]", display_name, clean_proxy)
        } else {
            format!("独立会话 - {}", display_name)
        };

        let initial_localhost_url = if is_localhost_callback_url(&parsed_url) {
            Some(parsed_url.as_str().to_string())
        } else {
            None
        };

        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            &safe_label,
            tauri::WebviewUrl::External(parsed_url),
        )
        .title(window_title)
        .inner_size(1050.0, 750.0)
        .center()
        .devtools(true)
        .initialization_script(&autofill_script)
        .data_directory(session_dir);

        if !clean_proxy.is_empty() {
            let normalized_proxy = if clean_proxy.contains("://") {
                clean_proxy.clone()
            } else {
                format!("http://{}", clean_proxy)
            };
            if let Ok(proxy_url) = tauri::Url::parse(&normalized_proxy) {
                builder = builder.proxy_url(proxy_url);
            }
            #[cfg(target_os = "windows")]
            {
                builder = builder.additional_browser_args(&format!(
                    "--proxy-server={} --proxy-bypass-list=<-loopback>;localhost;127.0.0.1;[::1]",
                    clean_proxy
                ));
            }
        }

        let _window = builder
            .build()
            .map_err(|e| format!("创建独立窗口失败: {e}"))?;
        let _ = _window.unminimize();
        let _ = _window.show();
        let _ = _window.set_focus();
        #[cfg(target_os = "windows")]
        attach_webview2_localhost_interceptor(&_window, display_name, initial_localhost_url);
        #[cfg(debug_assertions)]
        _window.open_devtools();
        Ok(())
    }
}

#[tauri::command]
pub async fn clear_account_browser_session(
    app: tauri::AppHandle,
    session_key: String,
    label_hint: Option<String>,
) -> Result<String, String> {
    let safe_label = build_session_label(&session_key);
    let display = label_hint.unwrap_or_else(|| session_key.clone());

    #[cfg(not(target_os = "android"))]
    {
        if let Some(w) = app.get_webview_window(&safe_label) {
            let _ = w.close();
            std::thread::sleep(std::time::Duration::from_millis(350));
        }

        let session_dir = vault::vault_data_dir().join("sessions").join(&safe_label);
        if session_dir.exists() {
            let mut removed = false;
            for _ in 0..8 {
                if std::fs::remove_dir_all(&session_dir).is_ok() {
                    removed = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            if !removed {
                let eb_default = session_dir.join("EBWebView").join("Default");
                for sub in [
                    "Network",
                    "Local Storage",
                    "Session Storage",
                    "IndexedDB",
                    "Cache",
                    "Code Cache",
                    "Service Worker",
                    "Cookies",
                    "Cookies-journal",
                ] {
                    let target = eb_default.join(sub);
                    let _ = if target.is_dir() {
                        std::fs::remove_dir_all(&target)
                    } else {
                        std::fs::remove_file(&target)
                    };
                }
            }
        }
        Ok(format!("已清理账号 [{}] 的独立会话 Cookie 与本地缓存", display))
    }

    #[cfg(target_os = "android")]
    {
        let _ = (app, safe_label);
        Ok(format!("请在独立浏览器底部抽屉中点击「清理沙箱」清理 [{}] 的会话", display))
    }
}