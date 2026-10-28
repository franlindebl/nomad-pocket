# libkiwix/libzim JNI looks up Java fields and methods by name (e.g. Archive.nativeHandle).
-keep class org.kiwix.** { *; }
-keepclassmembers class org.kiwix.** { *; }

# pdfbox-android: its optional JPEG 2000 decoder and Bouncy Castle (excluded in build.gradle) aren't shipped.
-dontwarn com.gemalto.jp2.**
-dontwarn org.bouncycastle.**
