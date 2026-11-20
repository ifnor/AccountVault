use crate::vault;

#[tauri::command]
pub fn get_cached_favicons() -> Result<std::collections::HashMap<String, String>, String> {
    vault::load_all_cached_favicons()
}

fn detect_image_mime(bytes: &[u8], header_ct: &str) -> Option<&'static str> {
    if bytes.len() < 16 || bytes.len() > 262_144 {
        return None;
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"\x00\x00\x01\x00") || bytes.starts_with(b"\x00\x00\x02\x00") {
        return Some("image/x-icon");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let trimmed = String::from_utf8_lossy(&bytes[..bytes.len().min(128)]).trim_start().to_lowercase();
    if trimmed.starts_with("<svg") || (trimmed.starts_with("<?xml") && trimmed.contains("<svg")) {
        return Some("image/svg+xml");
    }
    if header_ct.starts_with("image/") && !trimmed.starts_with("<html") && !trimmed.starts_with("<!doctype") {
        return Some("image/png");
    }
    None
}

#[tauri::command]
pub async fn fetch_and_cache_favicon(domain: String) -> Result<Option<String>, String> {
    let clean_domain = domain.trim().to_lowercase();
    if clean_domain.is_empty() || !clean_domain.contains('.') {
        return Ok(None);
    }

    if let Ok(Some(cached)) = vault::get_cached_favicon(&clean_domain) {
        return Ok(Some(cached));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let candidates = [
        format!("https://icons.duckduckgo.com/ip3/{}.ico", clean_domain),
        format!("https://www.google.com/s2/favicons?domain={}&sz=64", clean_domain),
        format!("https://{}/favicon.ico", clean_domain),
    ];

    for url in candidates {
        if let Ok(resp) = client.get(&url).send().await {
            if !resp.status().is_success() {
                continue;
            }
            let ct = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();
            if let Ok(bytes) = resp.bytes().await
                && let Some(mime) = detect_image_mime(&bytes, &ct) {
                    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                    let data_url = format!("data:{};base64,{}", mime, b64);
                    let _ = vault::save_cached_favicon(&clean_domain, &data_url);
                    return Ok(Some(data_url));
                }
        }
    }

    Ok(None)
}