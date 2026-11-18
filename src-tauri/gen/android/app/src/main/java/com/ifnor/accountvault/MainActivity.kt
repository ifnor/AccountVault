package com.ifnor.accountvault

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.content.FileProvider
import java.io.File

@Keep
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    instance = this
  }

  override fun onDestroy() {
    super.onDestroy()
    if (instance == this) {
      instance = null
    }
  }

  @Keep
  companion object {
    var instance: MainActivity? = null

    @Keep
    @JvmStatic
    fun installApk(context: Context, filePath: String): Boolean {
      return try {
        val file = File(filePath)
        if (!file.exists()) {
          android.util.Log.e("AccountVault", "APK file does not exist: $filePath")
          return false
        }

        file.setReadable(true, false)
        val targetContext = instance ?: context

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          if (!targetContext.packageManager.canRequestPackageInstalls()) {
            try {
              val manageIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:${targetContext.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              targetContext.startActivity(manageIntent)
            } catch (se: Exception) {
              android.util.Log.w("AccountVault", "Could not open unknown sources settings", se)
            }
          }
        }

        val apkUri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          FileProvider.getUriForFile(
            targetContext,
            "${targetContext.packageName}.fileprovider",
            file
          )
        } else {
          Uri.fromFile(file)
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(apkUri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        targetContext.startActivity(intent)
        true
      } catch (e: Exception) {
        android.util.Log.e("AccountVault", "Failed to launch package installer", e)
        false
      }
    }

    @Keep
    @JvmStatic
    fun openIsolatedBrowser(
      context: Context,
      account: String,
      url: String,
      password: String,
      totpSecret: String,
      recoveryEmail: String = "",
      platformTitle: String = "",
      sessionKey: String = ""
    ): Boolean {
      val targetContext = instance ?: context
      return try {
        val keySeed = if (sessionKey.isNotBlank()) sessionKey else account
        val rawHash = Math.abs(keySeed.trim().lowercase().hashCode()).toString(16)
        val intent = Intent(targetContext, IsolatedBrowserActivity::class.java).apply {
          putExtra("email", account)
          putExtra("url", url)
          putExtra("password", password)
          putExtra("totpSecret", totpSecret)
          putExtra("recoveryEmail", recoveryEmail)
          putExtra("platformTitle", platformTitle)
          putExtra("sessionKey", sessionKey)
          addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT)
          addFlags(Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
          addFlags(Intent.FLAG_ACTIVITY_RETAIN_IN_RECENTS)
          data = Uri.parse("avault://account/$rawHash")
        }
        targetContext.startActivity(intent)
        true
      } catch (e: Throwable) {
        android.util.Log.e("AccountVault", "Failed to launch IsolatedBrowserActivity", e)
        try {
          val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          targetContext.startActivity(fallbackIntent)
        } catch (_: Throwable) {}
        false
      }
    }

    @Keep
    @JvmStatic
    fun syncAutofillCredentials(context: Context, json: String): Boolean {
      return try {
        AutofillCredentialStore.syncCredentials(context, json)
        true
      } catch (e: Throwable) {
        android.util.Log.w("AccountVault", "syncAutofillCredentials failed", e)
        false
      }
    }

    @Keep
    @JvmStatic
    fun clearAutofillCredentials(context: Context): Boolean {
      return try {
        AutofillCredentialStore.clearCredentials(context)
        true
      } catch (_: Throwable) {
        false
      }
    }

    @Keep
    @JvmStatic
    fun isAutofillServiceEnabled(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      return try {
        val afm = context.getSystemService(AutofillManager::class.java)
        afm?.hasEnabledAutofillServices() == true
      } catch (_: Throwable) {
        false
      }
    }

    @Keep
    @JvmStatic
    fun openAutofillSettings(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      val targetContext = instance ?: context
      return try {
        val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
          data = Uri.parse("package:${targetContext.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        targetContext.startActivity(intent)
        true
      } catch (e: Throwable) {
        android.util.Log.w("AccountVault", "openAutofillSettings failed", e)
        false
      }
    }

    @Keep
    @JvmStatic
    fun consumePendingAutofillSaves(context: Context): String {
      return try {
        AutofillCredentialStore.consumePendingSaves(context)
      } catch (_: Throwable) {
        "[]"
      }
    }
  }
}
