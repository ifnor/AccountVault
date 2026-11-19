use std::time::{SystemTime, UNIX_EPOCH};
use totp_rs::{Algorithm, Secret, TOTP};

use crate::models::{TotpQrResult, TotpResult};

fn parse_hotp_uri(raw_input: &str) -> Result<Option<(String, u64)>, String> {
    let clean = raw_input.trim();
    if !clean.to_lowercase().starts_with("otpauth://hotp/") {
        return Ok(None);
    }
    let parsed = tauri::Url::parse(clean).map_err(|e| format!("无效的 HOTP 链接: {e}"))?;
    let mut secret_norm = String::new();
    let mut counter = 0u64;
    for (k, v) in parsed.query_pairs() {
        if k.eq_ignore_ascii_case("secret") {
            secret_norm = v
                .chars()
                .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
                .collect::<String>()
                .to_uppercase();
        } else if k.eq_ignore_ascii_case("counter") {
            counter = v.trim().parse::<u64>().unwrap_or(0);
        }
    }
    if secret_norm.is_empty() {
        return Err("HOTP 链接缺少 secret 参数".to_string());
    }
    let _ = Secret::Encoded(secret_norm.clone())
        .to_bytes()
        .map_err(|e| format!("HOTP 中的 Base32 密钥格式错误: {e}"))?;
    Ok(Some((secret_norm, counter)))
}

pub fn normalize_totp_secret(raw_input: &str) -> Result<String, String> {
    let clean = raw_input.trim();
    if clean.is_empty() {
        return Err("OTP 密钥为空".to_string());
    }

    if let Some((secret_norm, counter)) = parse_hotp_uri(clean)? {
        return Ok(format!("otpauth://hotp/Account?secret={secret_norm}&counter={counter}"));
    }

    if clean.to_lowercase().starts_with("otpauth://") {
        if let Ok(parsed) = tauri::Url::parse(clean) {
            for (k, v) in parsed.query_pairs() {
                if k.eq_ignore_ascii_case("secret") {
                    let norm: String = v
                        .chars()
                        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
                        .collect::<String>()
                        .to_uppercase();
                    if !norm.is_empty() {
                        let _ = Secret::Encoded(norm.clone())
                            .to_bytes()
                            .map_err(|e| format!("otpauth 中的 Base32 密钥格式错误: {e}"))?;
                        return Ok(norm);
                    }
                }
            }
        }
        let totp = TOTP::from_url(clean).map_err(|e| format!("无效的 otpauth 链接: {e}"))?;
        return Ok(totp.get_secret_base32());
    }

    let normalized: String = clean
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
        .collect::<String>()
        .to_uppercase();

    let secret = Secret::Encoded(normalized.clone());
    let _ = secret
        .to_bytes()
        .map_err(|e| format!("Base32 密钥格式错误: {e}"))?;

    Ok(normalized)
}

pub fn generate_totp_qr(
    raw_input: &str,
    account: &str,
    issuer: Option<&str>,
) -> Result<TotpQrResult, String> {
    let normalized_secret = normalize_totp_secret(raw_input)?;
    let secret_bytes = Secret::Encoded(normalized_secret.clone())
        .to_bytes()
        .map_err(|e| format!("Base32 密钥解码失败: {e}"))?;

    let account_name = if account.trim().is_empty() {
        "account".to_string()
    } else {
        account.trim().to_string()
    };

    let issuer_name = issuer
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("AccountVault")
        .to_string();

    let totp = TOTP::new_unchecked(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some(issuer_name),
        account_name,
    );

    let otpauth_url = totp.get_url();
    let qr_base64 = totp
        .get_qr_base64()
        .map_err(|e| format!("生成 2FA 二维码失败: {e}"))?;

    Ok(TotpQrResult {
        qr_base64: format!("data:image/png;base64,{qr_base64}"),
        otpauth_url,
        secret: normalized_secret,
    })
}

pub fn increment_hotp_counter(raw_input: &str) -> Result<String, String> {
    let Some((secret_norm, counter)) = parse_hotp_uri(raw_input)? else {
        return Err("当前账号不是 HOTP 类型".to_string());
    };
    let next = counter.saturating_add(1);
    Ok(format!("otpauth://hotp/Account?secret={secret_norm}&counter={next}"))
}

pub fn calculate_totp(raw_input: &str) -> Result<TotpResult, String> {
    if let Some((secret_norm, counter)) = parse_hotp_uri(raw_input)? {
        let secret_bytes = Secret::Encoded(secret_norm)
            .to_bytes()
            .map_err(|e| format!("Base32 密钥格式错误: {e}"))?;
        let hotp = TOTP::new_unchecked(
            Algorithm::SHA1,
            6,
            1,
            1,
            secret_bytes,
            None,
            "".to_string(),
        );
        let code = hotp.generate(counter);
        return Ok(TotpResult {
            code,
            remaining_seconds: 0,
            otp_type: "hotp".to_string(),
            counter,
        });
    }

    let normalized = normalize_totp_secret(raw_input)?;
    let secret = Secret::Encoded(normalized);
    let secret_bytes = secret
        .to_bytes()
        .map_err(|e| format!("Base32 密钥格式错误: {e}"))?;

    let totp = TOTP::new_unchecked(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        None,
        "".to_string(),
    );

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let code = totp.generate(now);
    let remaining_seconds = 30 - (now % 30);

    Ok(TotpResult {
        code,
        remaining_seconds,
        otp_type: "totp".to_string(),
        counter: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc6238_vector() {
        let res = calculate_totp("JBSWY3DPEHPK3PXP");
        match res {
            Ok(val) => {
                assert_eq!(val.code.len(), 6);
                assert_eq!(val.otp_type, "totp");
                assert!(val.remaining_seconds <= 30);
            }
            Err(e) => panic!("TOTP error: {}", e),
        }
    }

    #[test]
    fn test_rfc4226_hotp_vector_and_increment() {
        // RFC 4226 test secret "12345678901234567890" -> Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        let uri0 = "otpauth://hotp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&counter=0";
        let r0 = calculate_totp(uri0).expect("HOTP c=0 failed");
        assert_eq!(r0.otp_type, "hotp");
        assert_eq!(r0.counter, 0);
        assert_eq!(r0.code, "755224");

        let uri1 = increment_hotp_counter(uri0).expect("increment failed");
        let r1 = calculate_totp(&uri1).expect("HOTP c=1 failed");
        assert_eq!(r1.counter, 1);
        assert_eq!(r1.code, "287082");
    }
}
