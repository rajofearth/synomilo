# ProGuard / R8 keep rules for com.rajofearth.synomilo.
#
# `enableProguardInReleaseBuilds` in android/app/build.gradle is currently FALSE, so
# none of this is in effect today. It exists so that flipping that flag is a
# performance change and not a release-only "app crashes on launch" incident. Every
# rule below corresponds to a library that is reflection- or JNI-driven and would
# fail at RUNTIME (never at compile time) if renamed or stripped.
#
# Verify with:
#   cd android && ./gradlew :app:assembleRelease
# and then exercise push, ringing, WebRTC and the in-app updater on the release APK.

-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses,EnclosingMethod
-keepattributes SourceFile,LineNumberTable
-keepattributes Exceptions
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations
-keepattributes RuntimeVisibleParameterAnnotations,RuntimeInvisibleParameterAnnotations
-keepattributes AnnotationDefault

# ---------------------------------------------------------------------------
# React Native core + New Architecture (TurboModules / Fabric / codegen)
# ---------------------------------------------------------------------------
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keepclassmembers @com.facebook.proguard.annotations.KeepGettersAndSetters class * {
    void set*(***);
    *** get*();
}
-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }
-keep class * extends com.facebook.react.uimanager.SimpleViewManager { *; }
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }
-dontwarn com.facebook.react.**
-keep,includedescriptorclasses class com.facebook.proguard.annotations.DoNotStrip { *; }

# React Native autolinked modules that resolve by reflection from JS by name.
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.runtime.** { *; }

# ---------------------------------------------------------------------------
# @react-native-firebase  (messaging, app)
# ---------------------------------------------------------------------------
-keep class io.invertase.firebase.** { *; }
-keep class io.invertase.firebase.messaging.** { *; }
-dontwarn io.invertase.firebase.**
# FirebaseMessagingService is referenced from the merged manifest by name; the
# manifest keep already covers it, this guards the subclasses registered by RNFB.
-keep class * extends com.google.firebase.messaging.FirebaseMessagingService { *; }

# ---------------------------------------------------------------------------
# Google Play Services / Firebase
# ---------------------------------------------------------------------------
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keep class com.google.gson.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
-dontwarn com.google.android.gms.common.internal.service.**

# ---------------------------------------------------------------------------
# @notifee/react-native
# ---------------------------------------------------------------------------
-keep class app.notifee.core.** { *; }
-keep class io.invertase.notifee.** { *; }
-dontwarn app.notifee.core.**
# Notifee resolves a notification's `launchActivity` / `mainComponent` by name and
# reflects over the model classes when parsing an incoming notification payload.
-keep class app.notifee.core.model.** { *; }
-keep class io.invertase.notifee.HeadlessTask { *; }

# ---------------------------------------------------------------------------
# CometChat SDKs (chat UIKit, push notifications, calls SDK)
# ---------------------------------------------------------------------------
-keep class com.cometchat.** { *; }
-keep class com.cometchat.chat.** { *; }
-keep class com.cometchat.calls.** { *; }
-keep class com.cometchat.pushnotifications.** { *; }
-keep class com.CometChatCalls.** { *; }
-keep class com.CometChatCommon.** { *; }
-dontwarn com.cometchat.**
-dontwarn com.CometChatCalls.**
-dontwarn com.CometChatCommon.**

# ---------------------------------------------------------------------------
# WebRTC (react-native-webrtc)
# ---------------------------------------------------------------------------
-keep class org.webrtc.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-dontwarn org.webrtc.**

# ---------------------------------------------------------------------------
# This application
# ---------------------------------------------------------------------------
# Reached from AndroidManifest.xml by name: stripping these breaks the launcher,
# the ring screen and the single FirebaseMessagingService.
-keep class com.rajofearth.synomilo.MainActivity { *; }
-keep class com.rajofearth.synomilo.IncomingCallActivity { *; }
-keep class com.rajofearth.synomilo.MainApplication { *; }
-keep class com.rajofearth.synomilo.** { *; }

# ---------------------------------------------------------------------------
# Media / misc native modules
# ---------------------------------------------------------------------------
-keep class com.github.kyrylokryl.** { *; }        # react-native-video
-keep class com.mrousavy.camera.** { *; }           # react-native-vision-camera
-keep class com.swmansion.reanimated.** { *; }
-keep class com.oblador.keyboard.** { *; }
-keep class com.facebook.react.views.image.** { *; }
-keep class com.transistorsoft.** { *; }            # react-native-background-timer
-keep class org.greenrobot.eventbus.** { *; }       # pulled in by notifee

# ---------------------------------------------------------------------------
# Convex
# ---------------------------------------------------------------------------
# Convex's React Native client is pure JS, but it talks to a Convex deployment whose
# codegen emits classes that are only ever referenced from generated JS, so the
# codegen namespace is kept whole.
-keep class com.convex.** { *; }
-keep interface convex.** { *; }
-dontwarn convex.**

# ---------------------------------------------------------------------------
# Misc third-party that ships reflection-heavy Java
# ---------------------------------------------------------------------------
-dontwarn java.beans.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**