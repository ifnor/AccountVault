package com.ifnor.accountvault

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.ViewGroup
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RemoteViews
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.O)
class AutofillPickerActivity : Activity() {

    private var usernameIds: ArrayList<AutofillId> = arrayListOf()
    private var passwordIds: ArrayList<AutofillId> = arrayListOf()
    private var otpIds: ArrayList<AutofillId> = arrayListOf()
    private lateinit var listContainer: LinearLayout
    private var allCreds: List<AutofillCred> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        @Suppress("DEPRECATION")
        usernameIds = intent.getParcelableArrayListExtra("usernameIds") ?: arrayListOf()
        @Suppress("DEPRECATION")
        passwordIds = intent.getParcelableArrayListExtra("passwordIds") ?: arrayListOf()
        @Suppress("DEPRECATION")
        otpIds = intent.getParcelableArrayListExtra("otpIds") ?: arrayListOf()

        allCreds = AutofillCredentialStore.getAllCredentials(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            setPadding(40, 48, 40, 36)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 24)
        }

        val titleView = TextView(this).apply {
            text = "选择 AccountVault 账号"
            textSize = 18f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val cancelBtn = Button(this).apply {
            text = "取消"
            setOnClickListener {
                setResult(RESULT_CANCELED)
                finish()
            }
        }

        header.addView(titleView)
        header.addView(cancelBtn)
        root.addView(header)

        if (allCreds.isEmpty()) {
            val emptyMsg = TextView(this).apply {
                text = "当前尚未解锁或暂无缓存账号，请先打开 AccountVault 解锁一次保险库。"
                textSize = 14f
                setTextColor(Color.parseColor("#475569"))
                setPadding(0, 20, 0, 28)
            }
            val openAppBtn = Button(this).apply {
                text = "打开 AccountVault 解锁"
                setOnClickListener {
                    val launch = Intent(this@AutofillPickerActivity, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(launch)
                    setResult(RESULT_CANCELED)
                    finish()
                }
            }
            root.addView(emptyMsg)
            root.addView(openAppBtn)
            setContentView(root)
            return
        }

        val searchInput = EditText(this).apply {
            hint = "搜索平台、账号、网址..."
            setPadding(28, 22, 28, 22)
            setBackgroundColor(Color.WHITE)
            textSize = 14f
        }
        root.addView(searchInput, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = 20 })

        val scroll = ScrollView(this)
        listContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(listContainer)
        root.addView(scroll, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))

        renderList("")

        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                renderList(s?.toString() ?: "")
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        setContentView(root)
    }

    private fun renderList(query: String) {
        listContainer.removeAllViews()
        val q = query.trim().lowercase()
        val filtered = if (q.isEmpty()) {
            allCreds
        } else {
            allCreds.filter {
                it.title.lowercase().contains(q) ||
                    it.account.lowercase().contains(q) ||
                    it.loginUrl.lowercase().contains(q)
            }
        }

        for (cred in filtered.take(80)) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(Color.WHITE)
                setPadding(28, 22, 28, 22)
                isClickable = true
                isFocusable = true
                setOnClickListener { selectCredential(cred) }
            }
            val t = TextView(this).apply {
                text = cred.title.ifBlank { cred.loginUrl.ifBlank { "未命名" } }
                textSize = 15f
                setTypeface(null, Typeface.BOLD)
                setTextColor(Color.parseColor("#0F172A"))
            }
            val sub = TextView(this).apply {
                text = cred.account
                textSize = 13f
                setTextColor(Color.parseColor("#64748B"))
            }
            card.addView(t)
            card.addView(sub)
            listContainer.addView(card, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 14 })
        }
    }

    private fun selectCredential(cred: AutofillCred) {
        val presentation = RemoteViews(packageName, R.layout.autofill_item).apply {
            setTextViewText(R.id.autofill_title, cred.title.ifBlank { "AccountVault" })
            setTextViewText(R.id.autofill_subtitle, cred.account)
        }
        val builder = Dataset.Builder(presentation)
        if (cred.account.isNotBlank()) {
            for (id in usernameIds) {
                builder.setValue(id, AutofillValue.forText(cred.account))
            }
        }
        if (cred.password.isNotEmpty()) {
            for (id in passwordIds) {
                builder.setValue(id, AutofillValue.forText(cred.password))
            }
        }
        if (otpIds.isNotEmpty() && cred.totpSecret.isNotBlank()) {
            AutofillCredentialStore.generateTotp(cred.totpSecret)?.let { code ->
                for (id in otpIds) {
                    builder.setValue(id, AutofillValue.forText(code))
                }
            }
        }

        val reply = Intent().apply {
            putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, builder.build())
        }
        setResult(RESULT_OK, reply)
        finish()
    }
}
