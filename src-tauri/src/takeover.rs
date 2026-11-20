
mod takeover_engine {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Mutex;

    static TAKEOVER_SESSION_ID: AtomicU64 = AtomicU64::new(0);
    static TAKEOVER_ACTIVE: AtomicBool = AtomicBool::new(false);
    static CAPTURED_TAKEOVER_URL: Mutex<Option<String>> = Mutex::new(None);
    static CLI_STARTUP_CHECKED: AtomicBool = AtomicBool::new(false);

    pub fn extract_url_from_text(text: &str, require_oauth_hint: bool) -> Option<String> {
        let lower = text.to_lowercase();
        if lower.contains("--type=")
            || lower.contains("--no-startup-window")
            || lower.contains("--watcher")
            || lower.contains("crashpad")
            || lower.contains("clients2.google.com/cr/report")
        {
            return None;
        }

        let candidate_slice = if let Some(idx) = lower.find("--single-argument") {
            let after = &text[idx + "--single-argument".len()..];
            after.trim().trim_matches(|c| c == '"' || c == '\'')
        } else {
            let idx = lower.find("https://").or_else(|| lower.find("http://"))?;
            let rest = &text[idx..];
            let end = rest
                .find(|c: char| {
                    c == '"' || c == '\'' || c == ' ' || c == '\t' || c == '\r' || c == '\n'
                })
                .unwrap_or(rest.len());
            &rest[..end]
        };

        let unescaped = candidate_slice.replace("^&", "&");
        let parsed = tauri::Url::parse(&unescaped).ok()?;
        let scheme = parsed.scheme();
        if scheme != "http" && scheme != "https" {
            return None;
        }
        let host = parsed.host_str().unwrap_or_default().to_lowercase();
        if host.is_empty() {
            return None;
        }

        if require_oauth_hint {
            let u_low = unescaped.to_lowercase();
            let has_hint = u_low.contains("oauth")
                || u_low.contains("client_id=")
                || u_low.contains("redirect_uri=")
                || u_low.contains("signin")
                || u_low.contains("login")
                || u_low.contains("auth")
                || u_low.contains("sso")
                || u_low.contains("authorize")
                || u_low.contains("token");
            if !has_hint {
                return None;
            }
        }

        Some(unescaped)
    }

    pub fn set_captured_url(url: String) {
        if let Ok(mut guard) = CAPTURED_TAKEOVER_URL.lock()
            && guard.is_none() {
                *guard = Some(url);
            }
        TAKEOVER_ACTIVE.store(false, Ordering::SeqCst);
    }

    pub fn take_captured_url() -> Option<String> {
        if !CLI_STARTUP_CHECKED.swap(true, Ordering::SeqCst) {
            for arg in std::env::args().skip(1) {
                if let Some(u) = extract_url_from_text(&arg, false) {
                    TAKEOVER_ACTIVE.store(false, Ordering::SeqCst);
                    return Some(u);
                }
            }
        }
        CAPTURED_TAKEOVER_URL.lock().ok().and_then(|mut g| g.take())
    }

    pub fn stop_takeover() {
        TAKEOVER_ACTIVE.store(false, Ordering::SeqCst);
        TAKEOVER_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    }

    pub fn start_takeover(duration_secs: u64) {
        if let Ok(mut guard) = CAPTURED_TAKEOVER_URL.lock() {
            *guard = None;
        }
        let session_id = TAKEOVER_SESSION_ID.fetch_add(1, Ordering::SeqCst) + 1;
        TAKEOVER_ACTIVE.store(true, Ordering::SeqCst);

        #[cfg(target_os = "windows")]
        windows_sniffer::spawn_sniffer_thread(session_id, duration_secs);
        #[cfg(not(target_os = "windows"))]
        let _ = (session_id, duration_secs);
    }

    pub fn is_active() -> bool {
        TAKEOVER_ACTIVE.load(Ordering::SeqCst)
    }

    #[cfg(target_os = "windows")]
    mod windows_sniffer {
        use super::{
            extract_url_from_text, set_captured_url, TAKEOVER_ACTIVE, TAKEOVER_SESSION_ID,
        };
        use std::collections::HashSet;
        use std::sync::atomic::Ordering;
        use std::time::{Duration, Instant};

        const TH32CS_SNAPPROCESS: u32 = 0x00000002;
        const INVALID_HANDLE_VALUE: isize = -1;
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        const PROCESS_TERMINATE: u32 = 0x0001;
        const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
        const CF_UNICODETEXT: u32 = 13;

        #[repr(C)]
        struct PROCESSENTRY32W {
            dw_size: u32,
            cnt_usage: u32,
            th32_process_id: u32,
            th32_default_heap_id: usize,
            th32_module_id: u32,
            cnt_threads: u32,
            th32_parent_process_id: u32,
            pc_pri_class_base: i32,
            dw_flags: u32,
            sz_exe_file: [u16; 260],
        }

        #[repr(C)]
        struct UNICODE_STRING {
            length: u16,
            maximum_length: u16,
            buffer: *const u16,
        }

        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> isize;
            fn Process32FirstW(h_snapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
            fn Process32NextW(h_snapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
            fn OpenProcess(
                dw_desired_access: u32,
                b_inherit_handle: i32,
                dw_process_id: u32,
            ) -> isize;
            fn TerminateProcess(h_process: isize, u_exit_code: u32) -> i32;
            fn CloseHandle(h_object: isize) -> i32;
            fn GlobalLock(h_mem: isize) -> *const u16;
            fn GlobalUnlock(h_mem: isize) -> i32;
        }

        #[link(name = "ntdll")]
        unsafe extern "system" {
            fn NtQueryInformationProcess(
                process_handle: isize,
                process_information_class: u32,
                process_information: *mut u8,
                process_information_length: u32,
                return_length: *mut u32,
            ) -> i32;
        }

        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetClipboardSequenceNumber() -> u32;
            fn OpenClipboard(h_wnd_new_owner: isize) -> i32;
            fn GetClipboardData(u_format: u32) -> isize;
            fn CloseClipboard() -> i32;
        }

        fn read_clipboard_text() -> Option<String> {
            unsafe {
                if OpenClipboard(0) == 0 {
                    return None;
                }
                let result = (|| {
                    let h_data = GetClipboardData(CF_UNICODETEXT);
                    if h_data == 0 {
                        return None;
                    }
                    let ptr = GlobalLock(h_data);
                    if ptr.is_null() {
                        return None;
                    }
                    let mut len = 0usize;
                    while len < 8192 && *ptr.add(len) != 0 {
                        len += 1;
                    }
                    let slice = std::slice::from_raw_parts(ptr, len);
                    let s = String::from_utf16_lossy(slice);
                    let _ = GlobalUnlock(h_data);
                    Some(s)
                })();
                let _ = CloseClipboard();
                result
            }
        }

        fn is_browser_exe_name(exe: &str) -> bool {
            matches!(
                exe,
                "msedge.exe"
                    | "chrome.exe"
                    | "brave.exe"
                    | "firefox.exe"
                    | "vivaldi.exe"
                    | "opera.exe"
                    | "arc.exe"
                    | "centbrowser.exe"
                    | "chromium.exe"
                    | "thorium.exe"
                    | "waterfox.exe"
                    | "librewolf.exe"
                    | "360chrome.exe"
                    | "qqbrowser.exe"
                    | "sogouexplorer.exe"
            )
        }

        fn query_process_cmdline(h_proc: isize, buf: &mut Vec<u8>) -> Option<String> {
            unsafe {
                let mut ret_len: u32 = 0;
                let status = NtQueryInformationProcess(
                    h_proc,
                    PROCESS_COMMAND_LINE_INFORMATION,
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut ret_len,
                );
                if status < 0 {
                    return None;
                }
                if (ret_len as usize) < std::mem::size_of::<UNICODE_STRING>() {
                    return None;
                }
                let ustr = &*(buf.as_ptr() as *const UNICODE_STRING);
                if ustr.length == 0 || ustr.buffer.is_null() {
                    return None;
                }
                let char_count = (ustr.length / 2) as usize;
                let slice = std::slice::from_raw_parts(ustr.buffer, char_count);
                Some(String::from_utf16_lossy(slice))
            }
        }

        fn snapshot_all_pids() -> HashSet<u32> {
            let mut set = HashSet::with_capacity(512);
            unsafe {
                let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                if snap == INVALID_HANDLE_VALUE || snap == 0 {
                    return set;
                }
                let mut entry: PROCESSENTRY32W = std::mem::zeroed();
                entry.dw_size = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                if Process32FirstW(snap, &mut entry) != 0 {
                    loop {
                        set.insert(entry.th32_process_id);
                        if Process32NextW(snap, &mut entry) == 0 {
                            break;
                        }
                    }
                }
                let _ = CloseHandle(snap);
            }
            set
        }

        pub fn spawn_sniffer_thread(session_id: u64, duration_secs: u64) {
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(duration_secs);
                let self_pid = std::process::id();
                let mut seen_pids = snapshot_all_pids();
                seen_pids.insert(self_pid);

                let mut last_clip_seq = unsafe { GetClipboardSequenceNumber() };
                let initial_clip_text = read_clipboard_text().unwrap_or_default();
                let mut cmd_buf = vec![0u8; 32768];

                while Instant::now() < deadline {
                    if !TAKEOVER_ACTIVE.load(Ordering::SeqCst)
                        || TAKEOVER_SESSION_ID.load(Ordering::SeqCst) != session_id
                    {
                        return;
                    }

                    let cur_clip_seq = unsafe { GetClipboardSequenceNumber() };
                    if cur_clip_seq != last_clip_seq {
                        last_clip_seq = cur_clip_seq;
                        if let Some(clip_str) = read_clipboard_text() {
                            let trimmed = clip_str.trim();
                            if !trimmed.is_empty() && trimmed != initial_clip_text.trim() {
                                let is_pure_url = !trimmed.contains(char::is_whitespace)
                                    && (trimmed.starts_with("http://")
                                        || trimmed.starts_with("https://"));
                                if let Some(url) = extract_url_from_text(trimmed, !is_pure_url) {
                                    set_captured_url(url);
                                    return;
                                }
                            }
                        }
                    }

                    unsafe {
                        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
                        if snap != INVALID_HANDLE_VALUE && snap != 0 {
                            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
                            entry.dw_size = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                            if Process32FirstW(snap, &mut entry) != 0 {
                                loop {
                                    let pid = entry.th32_process_id;
                                    if !seen_pids.contains(&pid) {
                                        seen_pids.insert(pid);
                                        let exe_len = entry
                                            .sz_exe_file
                                            .iter()
                                            .position(|&c| c == 0)
                                            .unwrap_or(entry.sz_exe_file.len());
                                        let exe_name =
                                            String::from_utf16_lossy(&entry.sz_exe_file[..exe_len])
                                                .to_lowercase();
                                        let is_browser = is_browser_exe_name(&exe_name);

                                        let mut h_proc = OpenProcess(
                                            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                                            0,
                                            pid,
                                        );
                                        let can_terminate = if h_proc == 0 {
                                            h_proc = OpenProcess(
                                                PROCESS_QUERY_LIMITED_INFORMATION,
                                                0,
                                                pid,
                                            );
                                            false
                                        } else {
                                            true
                                        };

                                        if h_proc != 0 {
                                            if let Some(cmd) =
                                                query_process_cmdline(h_proc, &mut cmd_buf)
                                                && let Some(url) =
                                                    extract_url_from_text(&cmd, !is_browser)
                                                {
                                                    if is_browser && can_terminate {
                                                        let _ = TerminateProcess(h_proc, 0);
                                                    }
                                                    let _ = CloseHandle(h_proc);
                                                    let _ = CloseHandle(snap);
                                                    set_captured_url(url);
                                                    return;
                                                }
                                            let _ = CloseHandle(h_proc);
                                        }
                                    }

                                    if Process32NextW(snap, &mut entry) == 0 {
                                        break;
                                    }
                                }
                            }
                            let _ = CloseHandle(snap);
                        }
                    }

                    std::thread::sleep(Duration::from_millis(12));
                }

                if TAKEOVER_SESSION_ID.load(Ordering::SeqCst) == session_id {
                    TAKEOVER_ACTIVE.store(false, Ordering::SeqCst);
                }
            });
        }
    }
}

#[tauri::command]
pub fn start_browser_takeover(duration_secs: Option<u64>) -> Result<(), String> {
    takeover_engine::start_takeover(duration_secs.unwrap_or(60));
    Ok(())
}

#[tauri::command]
pub fn stop_browser_takeover() -> Result<(), String> {
    takeover_engine::stop_takeover();
    Ok(())
}

#[tauri::command]
pub fn poll_browser_takeover(clipboard_text: Option<String>) -> Result<Option<String>, String> {
    if let Some(url) = takeover_engine::take_captured_url() {
        return Ok(Some(url));
    }
    if takeover_engine::is_active()
        && let Some(clip) = clipboard_text {
            let trimmed = clip.trim();
            if !trimmed.is_empty() {
                let is_pure_url = !trimmed.contains(char::is_whitespace)
                    && (trimmed.starts_with("http://") || trimmed.starts_with("https://"));
                if let Some(url) = takeover_engine::extract_url_from_text(trimmed, !is_pure_url) {
                    takeover_engine::stop_takeover();
                    return Ok(Some(url));
                }
            }
        }
    Ok(None)
}