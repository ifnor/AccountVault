package com.ifnor.accountvault

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.Presentations
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import android.widget.inline.InlinePresentationSpec
import androidx.annotation.RequiresApi
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi

@RequiresApi(Build.VERSION_CODES.O)
class AccountVaultAutofillService : AutofillService() {

    data class ParsedFields(
        var webDomain: String? = null,
        var packageName: String? = null,
        val usernameIds: MutableList<AutofillId> = mutableListOf(),
        val passwordIds: MutableList<AutofillId> = mutableListOf(),
        val otpIds: MutableList<AutofillId> = mutableListOf(),
        val focusedFallbackIds: MutableList<AutofillId> = mutableListOf(),
        var lastUsernameValue: String = "",
        var lastPasswordValue: String = ""
    )

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        val contexts = request.fillContexts
        if (contexts.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val structure = contexts.last().structure
        val parsed = parseStructure(structure)

        if (parsed.packageName == packageName) {
            callback.onSuccess(null)
            return
        }

        // Focused field fallback for custom/non-standard App inputs
        if (parsed.usernameIds.isEmpty() && parsed.passwordIds.isEmpty() && parsed.otpIds.isEmpty()) {
            if (parsed.focusedFallbackIds.isNotEmpty()) {
                parsed.usernameIds.addAll(parsed.focusedFallbackIds)
            } else {
                callback.onSuccess(null)
                return
            }
        }

        val inlineRequest: InlineSuggestionsRequest? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) request.inlineSuggestionsRequest else null
        val inlineSpecs =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) inlineRequest?.inlinePresentationSpecs ?: emptyList()
            else emptyList()
        val maxInlineCount =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) inlineRequest?.maxSuggestionCount ?: 0
            else 0
        var inlineIndex = 0
        var reqCodeSeq = 2000

        val responseBuilder = FillResponse.Builder()
        val matched = AutofillCredentialStore.matchCredentials(this, parsed.webDomain, parsed.packageName)
        val allCreds = AutofillCredentialStore.getAllCredentials(this)

        var datasetCount = 0
        for (cred in matched.take(5)) {
            val inlineSpec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlineIndex < maxInlineCount && inlineSpecs.isNotEmpty()) {
                inlineSpecs[inlineIndex.coerceAtMost(inlineSpecs.size - 1)]
            } else {
                null
            }
            val inlinePres = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlineSpec != null) {
                buildInlinePresentation(
                    cred.title.ifBlank { cred.loginUrl.ifBlank { "AccountVault" } },
                    cred.account.ifBlank { "填充密码" },
                    inlineSpec,
                    reqCodeSeq++
                )
            } else {
                null
            }
            buildDataset(cred, parsed, inlinePres)?.let {
                responseBuilder.addDataset(it)
                datasetCount++
                if (inlinePres != null) inlineIndex++
            }
        }

        val pickerTitle = if (allCreds.isEmpty()) "解锁 AccountVault" else "选择 AccountVault 账号"
        val pickerSubtitle = parsed.webDomain?.takeIf { it.isNotBlank() }
            ?: parsed.packageName?.substringAfterLast('.')
            ?: "搜索全部账号"

        val pickerIntent = Intent(this, AutofillPickerActivity::class.java).apply {
            putParcelableArrayListExtra("usernameIds", ArrayList(parsed.usernameIds))
            putParcelableArrayListExtra("passwordIds", ArrayList(parsed.passwordIds))
            putParcelableArrayListExtra("otpIds", ArrayList(parsed.otpIds))
            putExtra("webDomain", parsed.webDomain ?: "")
            putExtra("packageName", parsed.packageName ?: "")
        }

        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val sender = PendingIntent.getActivity(this, 1001, pickerIntent, piFlags)

        val pickerView = makePresentation(pickerTitle, pickerSubtitle)
        val pickerInlineSpec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlineIndex < maxInlineCount && inlineSpecs.isNotEmpty()) {
            inlineSpecs[inlineIndex.coerceAtMost(inlineSpecs.size - 1)]
        } else {
            null
        }
        val pickerInlinePres = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && pickerInlineSpec != null) {
            buildInlinePresentation(pickerTitle, pickerSubtitle, pickerInlineSpec, reqCodeSeq++)
        } else {
            null
        }

        val pickerDatasetBuilder = createDatasetBuilder(pickerView, pickerInlinePres)
            .setAuthentication(sender.intentSender)

        val anchorId = parsed.usernameIds.firstOrNull()
            ?: parsed.passwordIds.firstOrNull()
            ?: parsed.otpIds.firstOrNull()
        if (anchorId != null) {
            @Suppress("DEPRECATION")
            pickerDatasetBuilder.setValue(anchorId, null)
            responseBuilder.addDataset(pickerDatasetBuilder.build())
            datasetCount++
        }

        if (datasetCount == 0) {
            callback.onSuccess(null)
            return
        }

        val saveIds = mutableListOf<AutofillId>()
        parsed.usernameIds.firstOrNull()?.let { saveIds.add(it) }
        parsed.passwordIds.firstOrNull()?.let { saveIds.add(it) }
        if (parsed.passwordIds.isNotEmpty() && saveIds.isNotEmpty()) {
            val saveType = if (parsed.usernameIds.isNotEmpty()) {
                SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD
            } else {
                SaveInfo.SAVE_DATA_TYPE_PASSWORD
            }
            responseBuilder.setSaveInfo(SaveInfo.Builder(saveType, saveIds.toTypedArray()).build())
        }

        callback.onSuccess(responseBuilder.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val contexts = request.fillContexts
        if (contexts.isEmpty()) {
            callback.onSuccess()
            return
        }
        val structure = contexts.last().structure
        val parsed = parseStructure(structure)

        val account = parsed.lastUsernameValue.trim()
        val password = parsed.lastPasswordValue
        if (account.isNotEmpty() && password.isNotEmpty()) {
            val domain = parsed.webDomain?.takeIf { it.isNotBlank() } ?: ""
            val url = if (domain.isNotEmpty()) "https://$domain" else ""
            val title = domain.ifEmpty { parsed.packageName?.substringAfterLast('.') ?: "App 账号" }
            AutofillCredentialStore.queuePendingSave(this, title, url, account, password)
        }
        callback.onSuccess()
    }

    @SuppressLint("RestrictedApi")
    @RequiresApi(Build.VERSION_CODES.R)
    private fun buildInlinePresentation(
        title: String,
        subtitle: String,
        spec: InlinePresentationSpec,
        requestCode: Int
    ): InlinePresentation? {
        return try {
            val styles = spec.style
            if (!UiVersions.getVersions(styles).contains(UiVersions.INLINE_UI_VERSION_1)) {
                return null
            }
            val attributionIntent = PendingIntent.getActivity(
                this,
                requestCode,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val content = InlineSuggestionUi.newContentBuilder(attributionIntent)
                .setTitle(title)
                .setSubtitle(subtitle)
                .setStartIcon(Icon.createWithResource(this, R.mipmap.ic_launcher_round))
                .build()
            InlinePresentation(content.slice, spec, false)
        } catch (e: Throwable) {
            android.util.Log.w("AccountVaultAutofill", "buildInlinePresentation failed", e)
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun createDatasetBuilder(menuView: RemoteViews, inlinePres: InlinePresentation?): Dataset.Builder {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val presBuilder = Presentations.Builder().setMenuPresentation(menuView)
            if (inlinePres != null) {
                presBuilder.setInlinePresentation(inlinePres)
            }
            Dataset.Builder(presBuilder.build())
        } else {
            val builder = Dataset.Builder(menuView)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlinePres != null) {
                builder.setInlinePresentation(inlinePres)
            }
            builder
        }
    }

    @Suppress("DEPRECATION")
    private fun buildDataset(
        cred: AutofillCred,
        parsed: ParsedFields,
        inlinePres: InlinePresentation?
    ): Dataset? {
        val title = cred.title.ifBlank { cred.loginUrl.ifBlank { "AccountVault" } }
        val subtitle = cred.account.ifBlank { "点击填充密码" }
        val presentation = makePresentation(title, subtitle)
        val builder = createDatasetBuilder(presentation, inlinePres)
        var hasValue = false

        if (cred.account.isNotBlank()) {
            for (id in parsed.usernameIds) {
                builder.setValue(id, AutofillValue.forText(cred.account))
                hasValue = true
            }
        }
        if (cred.password.isNotEmpty()) {
            for (id in parsed.passwordIds) {
                builder.setValue(id, AutofillValue.forText(cred.password))
                hasValue = true
            }
        }
        if (parsed.otpIds.isNotEmpty() && cred.totpSecret.isNotBlank()) {
            val code = AutofillCredentialStore.generateTotp(cred.totpSecret)
            if (!code.isNullOrBlank()) {
                for (id in parsed.otpIds) {
                    builder.setValue(id, AutofillValue.forText(code))
                    hasValue = true
                }
            }
        }
        return if (hasValue) builder.build() else null
    }

    private fun makePresentation(title: String, subtitle: String): RemoteViews {
        return RemoteViews(packageName, R.layout.autofill_item).apply {
            setTextViewText(R.id.autofill_title, title)
            setTextViewText(R.id.autofill_subtitle, subtitle)
        }
    }

    private fun parseStructure(structure: AssistStructure): ParsedFields {
        val parsed = ParsedFields(
            packageName = structure.activityComponent?.packageName
        )
        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            traverseNode(windowNode.rootViewNode, parsed)
        }
        return parsed
    }

    private fun traverseNode(node: AssistStructure.ViewNode?, parsed: ParsedFields) {
        if (node == null) return

        val domain = node.webDomain
        if (!domain.isNullOrBlank() && parsed.webDomain.isNullOrBlank()) {
            parsed.webDomain = domain
        }

        val autofillId = node.autofillId
        if (autofillId != null && node.visibility == View.VISIBLE) {
            val hints = node.autofillHints?.map { it.lowercase() } ?: emptyList()
            val idEntry = node.idEntry?.lowercase() ?: ""
            val hintText = node.hint?.lowercase() ?: ""
            val inputType = node.inputType
            val variation = inputType and InputType.TYPE_MASK_VARIATION
            val inputClass = inputType and InputType.TYPE_MASK_CLASS
            val textVal = node.autofillValue?.let {
                if (it.isText) it.textValue?.toString() ?: "" else ""
            } ?: ""

            val isPassword = hints.any { it.contains("password") } ||
                (inputClass == InputType.TYPE_CLASS_TEXT && (
                    variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                        variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                        variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    )) ||
                (inputClass == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) ||
                ((idEntry.contains("pass") || idEntry.contains("pwd") || hintText.contains("密码") || hintText.contains("password")) &&
                    !hintText.contains("验证码"))

            val isOtp = !isPassword && (
                hints.any { it.contains("otp") || it.contains("onetime") || it.contains("2fa") } ||
                    idEntry.contains("otp") || idEntry.contains("totp") || idEntry.contains("2fa") ||
                    hintText.contains("验证码") || hintText.contains("动态码") || hintText.contains("two-factor")
                )

            val isUsername = !isPassword && !isOtp && (
                hints.any {
                    it.contains("username") || it.contains("email") || it.contains("phone") || it.contains("account")
                } ||
                    (inputClass == InputType.TYPE_CLASS_TEXT && variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS) ||
                    (inputClass == InputType.TYPE_CLASS_TEXT && variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) ||
                    idEntry.contains("user") || idEntry.contains("email") || idEntry.contains("account") ||
                    idEntry.contains("login") || idEntry.contains("phone") ||
                    hintText.contains("账号") || hintText.contains("邮箱") || hintText.contains("手机") ||
                    hintText.contains("用户名") || hintText.contains("email") || hintText.contains("username")
                )

            when {
                isPassword -> {
                    parsed.passwordIds.add(autofillId)
                    if (textVal.isNotEmpty()) parsed.lastPasswordValue = textVal
                }
                isOtp -> {
                    parsed.otpIds.add(autofillId)
                }
                isUsername -> {
                    parsed.usernameIds.add(autofillId)
                    if (textVal.isNotEmpty()) parsed.lastUsernameValue = textVal
                }
                node.isFocused && node.autofillType == View.AUTOFILL_TYPE_TEXT -> {
                    parsed.focusedFallbackIds.add(autofillId)
                }
            }
        }

        for (i in 0 until node.childCount) {
            traverseNode(node.getChildAt(i), parsed)
        }
    }
}
