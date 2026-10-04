package com.rajofearth.synomilo

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class InstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Installer"

    @ReactMethod
    fun canInstall(promise: Promise) {
        try {
            val allowed = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                true
            } else {
                reactApplicationContext.packageManager.canRequestPackageInstalls()
            }
            promise.resolve(allowed)
        } catch (error: Exception) {
            promise.reject("E_INSTALL_CHECK", error.message, error)
        }
    }

    @ReactMethod
    fun openInstallSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            intent.data = Uri.parse("package:${reactApplicationContext.packageName}")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("E_INSTALL_SETTINGS", error.message, error)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val powerManager = reactApplicationContext.getSystemService(
                Context.POWER_SERVICE,
            ) as PowerManager
            promise.resolve(
                powerManager.isIgnoringBatteryOptimizations(
                    reactApplicationContext.packageName,
                ),
            )
        } catch (error: Exception) {
            promise.reject("E_BATTERY_OPTIMIZATION", error.message, error)
        }
    }

    @ReactMethod
    fun openBatterySettings() {
        try {
            val powerManager = reactApplicationContext.getSystemService(
                Context.POWER_SERVICE,
            ) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(
                    reactApplicationContext.packageName,
                )
            ) {
                val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                request.data = Uri.parse("package:${reactApplicationContext.packageName}")
                request.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    reactApplicationContext.startActivity(request)
                    return
                } catch (error: Exception) {
                }
            }
            val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(fallback)
        } catch (error: Exception) {
        }
    }

    @ReactMethod
    fun download(url: String, fileName: String, promise: Promise) {
        Thread {
            var connection: HttpURLConnection? = null
            val updatesDir = File(reactApplicationContext.filesDir, "updates")
            val target = File(updatesDir, fileName)
            try {
                if (!updatesDir.exists()) {
                    updatesDir.mkdirs()
                }
                connection = URL(url).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = true
                connection.connectTimeout = 15000
                connection.readTimeout = 30000
                connection.connect()
                val responseCode = connection.responseCode
                if (responseCode !in 200..299) {
                    promise.reject("E_DOWNLOAD", "Server returned status $responseCode")
                    return@Thread
                }
                val total = connection.contentLengthLong
                connection.inputStream.use { input ->
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var bytes = 0L
                        var lastProgress = -1
                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) {
                                break
                            }
                            output.write(buffer, 0, read)
                            bytes += read
                            if (total > 0) {
                                val progress = ((bytes * 100) / total).toInt().coerceIn(0, 100)
                                if (progress - lastProgress >= 2) {
                                    lastProgress = progress
                                    emitProgress(progress, bytes, total)
                                }
                            }
                        }
                        output.flush()
                    }
                }
                emitProgress(100, target.length(), if (total > 0) total else target.length())
                promise.resolve(target.absolutePath)
            } catch (error: Exception) {
                target.delete()
                promise.reject("E_DOWNLOAD", error.message, error)
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    @ReactMethod
    fun install(path: String, promise: Promise) {
        try {
            val file = File(path)
            val uri = FileProvider.getUriForFile(
                reactApplicationContext,
                "${reactApplicationContext.packageName}.fileprovider",
                file,
            )
            val intent = Intent(Intent.ACTION_VIEW)
            intent.setDataAndType(uri, "application/vnd.android.package-archive")
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("E_INSTALL", error.message, error)
        }
    }

    @ReactMethod
    fun cancelNotifications(tag: String) {
        val manager = reactApplicationContext.getSystemService(
            Context.NOTIFICATION_SERVICE,
        ) as NotificationManager
        manager.cancel(tag, 0)
    }

    private fun emitProgress(progress: Int, bytes: Long, total: Long) {
        val payload = Arguments.createMap()
        payload.putInt("progress", progress)
        payload.putDouble("bytes", bytes.toDouble())
        payload.putDouble("total", total.toDouble())
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("synomilo_update_progress", payload)
    }
}
