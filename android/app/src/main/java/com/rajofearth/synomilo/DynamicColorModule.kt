package com.rajofearth.synomilo

import android.content.res.Resources
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

class DynamicColorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DynamicColor"

    @ReactMethod
    fun getSystemColors(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            promise.resolve(null)
            return
        }

        try {
            val resources = Resources.getSystem()
            val palettes = listOf(
                "system_accent1",
                "system_accent2",
                "system_accent3",
                "system_neutral1",
                "system_neutral2",
            )
            val tones = listOf(0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99)
            val result: WritableMap = Arguments.createMap()
            var found = 0

            for (palette in palettes) {
                for (tone in tones) {
                    val name = "${palette}_$tone"
                    val id = resources.getIdentifier(name, "color", "android")
                    if (id != 0) {
                        result.putInt(name, resources.getColor(id, null))
                        found++
                    }
                }
            }

            if (found == 0) {
                promise.resolve(null)
            } else {
                promise.resolve(result)
            }
        } catch (error: Exception) {
            promise.reject("E_DYNAMIC_COLOR", error.message, error)
        }
    }
}
