# Keep MainActivity and all its companion methods (required for JNI call from Rust)
-keep class com.ifnor.accountvault.MainActivity {
    public static *;
    public *;
}
-keepclassmembers class com.ifnor.accountvault.MainActivity {
    public static *;
    public *;
}
-keep class com.ifnor.accountvault.MainActivity$Companion {
    public *;
}
-keepclassmembers class com.ifnor.accountvault.MainActivity$Companion {
    public *;
}

# Keep IsolatedBrowserActivity & Helpers
-keep class com.ifnor.accountvault.IsolatedBrowserActivity {
    public *;
    public static *;
}
-keepclassmembers class com.ifnor.accountvault.IsolatedBrowserActivity {
    public *;
    public static *;
}
-keep class com.ifnor.accountvault.TotpHelper {
    public *;
    public static *;
}
-keep class com.ifnor.accountvault.CookieIsolationHelper {
    public *;
    public static *;
}

# Keep AndroidX WebKit and Chromium support lib boundary interfaces
-keep class androidx.webkit.** { *; }
-keep interface androidx.webkit.** { *; }
-dontwarn androidx.webkit.**
-keep class org.chromium.support_lib_boundary.** { *; }
-keep interface org.chromium.support_lib_boundary.** { *; }
-dontwarn org.chromium.support_lib_boundary.**
