package com.ifnor.accountvault

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class AutofillCred(
    val id: String,
    val title: String,
    val account: String,
    val password: String,
    val loginUrl: String,
    val totpSecret: String
)

object AutofillCredentialStore {
    private const val PREFS_NAME = "avault_autofill_prefs"
    private const val KEY_CREDS_ENC = "creds_enc"
    private const val KEY_PENDING_SAVES_ENC = "pending_saves_enc"
    private const val KEYSTORE_ALIAS = "account_vault_autofill_aes_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    @Volatile
    private var memoryCache: List<AutofillCred>? = null

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = ks.getKey(KEYSTORE_ALIAS, null) as? SecretKey
        if (existing != null) return existing

        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        kg.init(spec)
        return kg.generateKey()
    }

    private fun encryptString(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(1 + iv.size + ciphertext.size)
        combined[0] = iv.size.toByte()
        System.arraycopy(iv, 0, combined, 1, iv.size)
        System.arraycopy(ciphertext, 0, combined, 1 + iv.size, ciphertext.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decryptString(encoded: String): String? {
        return try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            if (combined.size < 14) return null
            val ivLen = combined[0].toInt() and 0xFF
            val iv = combined.copyOfRange(1, 1 + ivLen)
            val ciphertext = combined.copyOfRange(1 + ivLen, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (e: Throwable) {
            android.util.Log.w("AccountVaultAutofill", "Decrypt failed", e)
            null
        }
    }

    private fun parseJson(json: String): List<AutofillCred> {
        val list = mutableListOf<AutofillCred>()
        try {
            val arr = JSONArray(json)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val account = obj.optString("account", "").trim()
                val password = obj.optString("password", "")
                if (account.isEmpty() && password.isEmpty()) continue
                list.add(
                    AutofillCred(
                        id = obj.optString("id", ""),
                        title = obj.optString("title", ""),
                        account = account,
                        password = password,
                        loginUrl = obj.optString("login_url", ""),
                        totpSecret = obj.optString("totp", "")
                    )
                )
            }
        } catch (e: Throwable) {
            android.util.Log.w("AccountVaultAutofill", "Parse json failed", e)
        }
        return list
    }

    fun syncCredentials(context: Context, json: String) {
        val parsed = parseJson(json)
        memoryCache = parsed
        try {
            val enc = encryptString(json)
            context.applicationContext
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CREDS_ENC, enc)
                .apply()
        } catch (e: Throwable) {
            android.util.Log.w("AccountVaultAutofill", "Persist encrypted creds failed", e)
        }
    }

    fun clearCredentials(context: Context) {
        memoryCache = null
        context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_CREDS_ENC)
            .apply()
    }

    fun getAllCredentials(context: Context): List<AutofillCred> {
        memoryCache?.let { return it }
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val enc = prefs.getString(KEY_CREDS_ENC, null) ?: return emptyList()
        val plain = decryptString(enc) ?: return emptyList()
        val parsed = parseJson(plain)
        memoryCache = parsed
        return parsed
    }

    private fun extractHost(rawUrl: String): String {
        val trimmed = rawUrl.trim().lowercase()
        if (trimmed.isEmpty()) return ""
        val noScheme = trimmed.removePrefix("https://").removePrefix("http://")
        val hostPort = noScheme.substringBefore('/')
        val host = hostPort.substringBefore(':')
        return host.removePrefix("www.")
    }

    private fun knownDomainForTitle(title: String): String? {
        val t = title.trim().lowercase()
        return when {
            t.contains("google") || t.contains("gmail") || t.contains("谷歌") -> "google.com"
            t.contains("github") -> "github.com"
            t.contains("microsoft") || t.contains("outlook") || t.contains("微软") -> "microsoft.com"
            t.contains("apple") || t.contains("icloud") || t.contains("苹果") -> "apple.com"
            t.contains("openai") || t.contains("chatgpt") -> "openai.com"
            t.contains("claude") || t.contains("anthropic") -> "claude.ai"
            t.contains("steam") -> "steampowered.com"
            t.contains("discord") -> "discord.com"
            t.contains("twitter") || t == "x" -> "x.com"
            t.contains("bilibili") || t.contains("b站") -> "bilibili.com"
            t.contains("zhihu") || t.contains("知乎") -> "zhihu.com"
            t.contains("taobao") || t.contains("淘宝") -> "taobao.com"
            t.contains("alipay") || t.contains("支付宝") -> "alipay.com"
            t.contains("aliyun") || t.contains("阿里云") -> "aliyun.com"
            t.contains("wechat") || t.contains("微信") -> "weixin.qq.com"
            t.contains("qq") -> "qq.com"
            else -> null
        }
    }

    private fun packageKeywords(pkg: String): List<String> {
        val p = pkg.lowercase()
        val hints = mutableListOf<String>()
        when {
            p.contains("tencent.mm") -> hints.addAll(listOf("wechat", "微信", "weixin.qq.com"))
            p.contains("tencent.mobileqq") -> hints.addAll(listOf("qq", "qq.com"))
            p.contains("alipay") || p.contains("eg.android.alipaygphone") -> hints.addAll(listOf("alipay", "支付宝", "alipay.com"))
            p.contains("taobao") -> hints.addAll(listOf("taobao", "淘宝", "taobao.com"))
            p.contains("danmaku.bili") || p.contains("bilibili") -> hints.addAll(listOf("bilibili", "b站", "bilibili.com"))
            p.contains("zhihu") -> hints.addAll(listOf("zhihu", "知乎", "zhihu.com"))
            p.contains("github") -> hints.addAll(listOf("github", "github.com"))
            p.contains("openai") || p.contains("chatgpt") -> hints.addAll(listOf("openai", "chatgpt", "openai.com"))
            p.contains("discord") -> hints.addAll(listOf("discord", "discord.com"))
            p.contains("steam") || p.contains("valvesoftware") -> hints.addAll(listOf("steam", "steampowered.com"))
            p.contains("google") -> hints.addAll(listOf("google", "gmail", "google.com"))
            p.contains("microsoft") -> hints.addAll(listOf("microsoft", "outlook", "microsoft.com"))
            p.contains("twitter") -> hints.addAll(listOf("twitter", "x.com"))
        }
        val parts = p.split('.').filter {
            it.length >= 3 && it !in setOf("com", "org", "net", "app", "android", "client", "mobile")
        }
        hints.addAll(parts)
        return hints.distinct()
    }

    fun matchCredentials(context: Context, webDomain: String?, packageName: String?): List<AutofillCred> {
        val all = getAllCredentials(context)
        if (all.isEmpty()) return emptyList()

        val targetHost = extractHost(webDomain ?: "")
        val pkgHints = if (!packageName.isNullOrBlank()) packageKeywords(packageName) else emptyList()

        val scored = all.mapNotNull { cred ->
            var score = 0
            val recHost = extractHost(cred.loginUrl)
            val titleLower = cred.title.trim().lowercase()

            if (targetHost.isNotEmpty()) {
                if (recHost.isNotEmpty() && (recHost == targetHost || targetHost.endsWith(".$recHost") || recHost.endsWith(".$targetHost"))) {
                    score += 100
                }
                val known = knownDomainForTitle(cred.title)
                if (known != null && (known == targetHost || targetHost.endsWith(".$known"))) {
                    score += 80
                }
                val baseLabel = targetHost.substringBefore('.')
                if (baseLabel.length >= 3 && titleLower.contains(baseLabel)) {
                    score += 50
                }
            }

            if (pkgHints.isNotEmpty()) {
                for (hint in pkgHints) {
                    if (recHost.contains(hint) || titleLower.contains(hint)) {
                        score += 60
                        break
                    }
                }
            }

            if (score > 0) Pair(score, cred) else null
        }.sortedByDescending { it.first }

        return scored.map { it.second }
    }

    fun queuePendingSave(
        context: Context,
        title: String,
        url: String,
        account: String,
        password: String
    ) {
        if (account.isBlank() || password.isBlank()) return
        try {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val existingPlain = prefs.getString(KEY_PENDING_SAVES_ENC, null)?.let { decryptString(it) }
            val arr = if (!existingPlain.isNullOrBlank()) JSONArray(existingPlain) else JSONArray()
            val item = JSONObject().apply {
                put("title", title)
                put("url", url)
                put("account", account)
                put("password", password)
            }
            arr.put(item)
            prefs.edit().putString(KEY_PENDING_SAVES_ENC, encryptString(arr.toString())).apply()
        } catch (e: Throwable) {
            android.util.Log.w("AccountVaultAutofill", "Queue pending save failed", e)
        }
    }

    fun consumePendingSaves(context: Context): String {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val enc = prefs.getString(KEY_PENDING_SAVES_ENC, null) ?: return "[]"
        prefs.edit().remove(KEY_PENDING_SAVES_ENC).apply()
        return decryptString(enc) ?: "[]"
    }

    fun generateTotp(rawSecret: String): String? {
        if (rawSecret.isBlank()) return null
        return try {
            var secret = rawSecret.trim()
            if (secret.startsWith("otpauth://", ignoreCase = true)) {
                val idx = secret.indexOf("secret=", ignoreCase = true)
                if (idx >= 0) {
                    secret = secret.substring(idx + 7).substringBefore('&')
                }
            }
            val cleaned = secret.uppercase().replace(Regex("[^A-Z2-7]"), "")
            if (cleaned.isEmpty()) return null
            val keyBytes = decodeBase32(cleaned)
            val step = System.currentTimeMillis() / 1000L / 30L
            val msg = ByteBuffer.allocate(8).putLong(step).array()
            val mac = Mac.getInstance("HmacSHA1")
            mac.init(SecretKeySpec(keyBytes, "HmacSHA1"))
            val hash = mac.doFinal(msg)
            val offset = hash[hash.size - 1].toInt() and 0x0F
            val binary = ((hash[offset].toInt() and 0x7F) shl 24) or
                ((hash[offset + 1].toInt() and 0xFF) shl 16) or
                ((hash[offset + 2].toInt() and 0xFF) shl 8) or
                (hash[offset + 3].toInt() and 0xFF)
            val otp = binary % 1_000_000
            String.format("%06d", otp)
        } catch (_: Throwable) {
            null
        }
    }

    private fun decodeBase32(input: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val out = mutableListOf<Byte>()
        var buffer = 0
        var bitsLeft = 0
        for (ch in input) {
            val valIdx = alphabet.indexOf(ch)
            if (valIdx < 0) continue
            buffer = (buffer shl 5) or valIdx
            bitsLeft += 5
            if (bitsLeft >= 8) {
                out.add(((buffer shr (bitsLeft - 8)) and 0xFF).toByte())
                bitsLeft -= 8
            }
        }
        return out.toByteArray()
    }
}
