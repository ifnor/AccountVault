package com.ifnor.accountvault

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePasswordCredentialRequest
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import org.json.JSONObject

@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class AccountVaultCredentialProviderService : CredentialProviderService() {

    private var reqSeq = 5000

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        val responseBuilder = BeginGetCredentialResponse.Builder()
        val callingPkg = request.callingAppInfo?.packageName ?: ""

        for (option in request.beginGetCredentialOptions) {
            when (option) {
                is BeginGetPublicKeyCredentialOption -> {
                    val reqJson = try {
                        JSONObject(option.requestJson)
                    } catch (_: Throwable) {
                        JSONObject()
                    }
                    val rpId = reqJson.optString("rpId", "")
                    val allowIds = mutableListOf<String>()
                    val allowArr = reqJson.optJSONArray("allowCredentials")
                    if (allowArr != null) {
                        for (i in 0 until allowArr.length()) {
                            val id = allowArr.optJSONObject(i)?.optString("id", "") ?: ""
                            if (id.isNotBlank()) allowIds.add(id)
                        }
                    }

                    val matchedPasskeys = AutofillCredentialStore.matchPasskeys(this, rpId, allowIds)
                    for ((cred, pk) in matchedPasskeys) {
                        val intent = Intent(this, CredentialProviderActivity::class.java).apply {
                            putExtra("mode", "get_passkey")
                            putExtra("cred_id", pk.credentialId)
                            putExtra("rp_id", pk.rpId)
                        }
                        val pi = PendingIntent.getActivity(
                            this,
                            reqSeq++,
                            intent,
                            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                        )
                        val entry = PublicKeyCredentialEntry.Builder(
                            context = this,
                            username = pk.userName.ifBlank { cred.account.ifBlank { pk.rpId } },
                            pendingIntent = pi,
                            beginGetPublicKeyCredentialOption = option
                        )
                            .setDisplayName(cred.title.ifBlank { pk.rpName.ifBlank { pk.rpId } })
                            .build()
                        responseBuilder.addCredentialEntry(entry)
                    }
                }

                is BeginGetPasswordOption -> {
                    val matched = AutofillCredentialStore.matchCredentials(this, null, callingPkg)
                    val all = if (matched.isNotEmpty()) matched else AutofillCredentialStore.getAllCredentials(this).take(10)
                    for (cred in all.filter { it.password.isNotEmpty() }.take(8)) {
                        val intent = Intent(this, CredentialProviderActivity::class.java).apply {
                            putExtra("mode", "get_password")
                            putExtra("username", cred.account)
                            putExtra("password", cred.password)
                        }
                        val pi = PendingIntent.getActivity(
                            this,
                            reqSeq++,
                            intent,
                            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                        )
                        val entry = PasswordCredentialEntry.Builder(
                            context = this,
                            username = cred.account.ifBlank { cred.title },
                            pendingIntent = pi,
                            beginGetPasswordOption = option
                        )
                            .setDisplayName(cred.title.ifBlank { cred.loginUrl })
                            .build()
                        responseBuilder.addCredentialEntry(entry)
                    }
                }
            }
        }

        callback.onResult(responseBuilder.build())
    }

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        val responseBuilder = BeginCreateCredentialResponse.Builder()

        when (request) {
            is BeginCreatePublicKeyCredentialRequest -> {
                val intent = Intent(this, CredentialProviderActivity::class.java).apply {
                    putExtra("mode", "create_passkey")
                }
                val pi = PendingIntent.getActivity(
                    this,
                    reqSeq++,
                    intent,
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
                val entry = CreateEntry.Builder(
                    accountName = "AccountVault 通行密钥",
                    pendingIntent = pi
                )
                    .setDescription("加密保存至 AccountVault 保险库")
                    .build()
                responseBuilder.addCreateEntry(entry)
            }

            is BeginCreatePasswordCredentialRequest -> {
                val intent = Intent(this, CredentialProviderActivity::class.java).apply {
                    putExtra("mode", "create_password")
                }
                val pi = PendingIntent.getActivity(
                    this,
                    reqSeq++,
                    intent,
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
                val entry = CreateEntry.Builder(
                    accountName = "AccountVault 密码库",
                    pendingIntent = pi
                )
                    .setDescription("保存账号与密码至 AccountVault")
                    .build()
                responseBuilder.addCreateEntry(entry)
            }
        }

        callback.onResult(responseBuilder.build())
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>
    ) {
        callback.onResult(null)
    }
}
