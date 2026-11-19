package com.ifnor.accountvault

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.annotation.RequiresApi
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreatePasswordResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PasswordCredential
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.PendingIntentHandler
import org.json.JSONObject

@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class CredentialProviderActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mode = intent.getStringExtra("mode") ?: ""
        when (mode) {
            "get_passkey" -> handleGetPasskey()
            "get_password" -> handleGetPassword()
            "create_passkey" -> handleCreatePasskey()
            "create_password" -> handleCreatePassword()
            else -> {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }

    private fun handleGetPasskey() {
        val req = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
        val pkOption = req?.credentialOptions?.filterIsInstance<GetPublicKeyCredentialOption>()?.firstOrNull()
        val credId = intent.getStringExtra("cred_id") ?: ""
        val rpId = intent.getStringExtra("rp_id") ?: ""

        val matched = AutofillCredentialStore.matchPasskeys(this, rpId, listOf(credId)).firstOrNull()?.second
        if (pkOption == null || matched == null) {
            val reply = Intent()
            PendingIntentHandler.setGetCredentialException(reply, GetCredentialUnknownException("未找到匹配的 PassKey"))
            setResult(RESULT_OK, reply)
            finish()
            return
        }

        try {
            val callingOrigin = req.callingAppInfo.getOrigin(
                "android:apk-key-hash:${matched.rpId}"
            ) ?: "https://${matched.rpId}"
            val responseJson = AutofillCredentialStore.signPasskeyAndBuildResponseJson(
                pk = matched,
                requestJsonStr = pkOption.requestJson,
                origin = callingOrigin,
                providedClientDataHash = pkOption.clientDataHash
            )
            val reply = Intent()
            PendingIntentHandler.setGetCredentialResponse(
                reply,
                GetCredentialResponse(PublicKeyCredential(responseJson))
            )
            setResult(RESULT_OK, reply)
        } catch (e: Throwable) {
            val reply = Intent()
            PendingIntentHandler.setGetCredentialException(reply, GetCredentialUnknownException(e.message))
            setResult(RESULT_OK, reply)
        }
        finish()
    }

    private fun handleGetPassword() {
        val username = intent.getStringExtra("username") ?: ""
        val password = intent.getStringExtra("password") ?: ""
        val reply = Intent()
        PendingIntentHandler.setGetCredentialResponse(
            reply,
            GetCredentialResponse(PasswordCredential(username, password))
        )
        setResult(RESULT_OK, reply)
        finish()
    }

    private fun handleCreatePasskey() {
        val req = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        val pkReq = req?.callingRequest as? CreatePublicKeyCredentialRequest
        if (pkReq == null) {
            val reply = Intent()
            PendingIntentHandler.setCreateCredentialException(reply, CreateCredentialUnknownException("无效的 PassKey 创建请求"))
            setResult(RESULT_OK, reply)
            finish()
            return
        }

        try {
            val reqJson = JSONObject(pkReq.requestJson)
            val rpId = reqJson.optJSONObject("rp")?.optString("id", "") ?: ""
            val origin = pkReq.origin ?: "https://$rpId"
            val registrationJson = AutofillCredentialStore.createPasskeyAndBuildResponseJson(
                context = this,
                requestJsonStr = pkReq.requestJson,
                origin = origin,
                clientDataHash = pkReq.clientDataHash
            )
            val reply = Intent()
            PendingIntentHandler.setCreateCredentialResponse(
                reply,
                CreatePublicKeyCredentialResponse(registrationJson)
            )
            setResult(RESULT_OK, reply)
        } catch (e: Throwable) {
            val reply = Intent()
            PendingIntentHandler.setCreateCredentialException(reply, CreateCredentialUnknownException(e.message))
            setResult(RESULT_OK, reply)
        }
        finish()
    }

    private fun handleCreatePassword() {
        val req = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        val pwdReq = req?.callingRequest as? CreatePasswordRequest
        if (pwdReq != null) {
            val pkg = req.callingAppInfo.packageName
            AutofillCredentialStore.queuePendingSave(
                this,
                pkg.substringAfterLast('.'),
                "",
                pwdReq.id,
                pwdReq.password
            )
        }
        val reply = Intent()
        PendingIntentHandler.setCreateCredentialResponse(reply, CreatePasswordResponse())
        setResult(RESULT_OK, reply)
        finish()
    }
}
