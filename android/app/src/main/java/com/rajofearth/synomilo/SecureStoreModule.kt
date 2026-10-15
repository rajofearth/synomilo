package com.rajofearth.synomilo

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec

/**
 * Encrypted storage for the session token and the app-lock PIN verifier.
 *
 * ## What this stores, and what it deliberately does not
 *
 * Two kinds of secret end up here:
 *
 *  1. The Convex session token. A bearer credential: whoever holds it is the user,
 *     with no second factor. It used to live in plaintext AsyncStorage, which on
 *     Android is an unencrypted SQLite file inside the app sandbox - readable by
 *     root, by an `adb backup`, and by anyone who gets the file off a rooted device.
 *     It is now encrypted at rest under a key that lives in the Android Keystore and
 *     is not extractable.
 *
 *  2. The app-lock PIN *verifier*: a PBKDF2-HMAC-SHA256 hash plus a per-install
 *     random salt. Never the PIN itself. There is no code path in this file that
 *     writes the PIN to disk, and no code path that would let it be read back.
 *
 * There is no biometric data here, and there cannot be. Fingerprint and face
 * templates live in a protected HAL / TEE region that no app - including this one -
 * can read. The OS hands an app a yes/no "verified" and nothing else. So there is
 * nothing to hash, nothing to salt, and nothing to encrypt here; attempting to
 * capture a biometric sample would be both impossible and unlawful. The PIN
 * verifier below is the app's own secret, and the biometric prompt in
 * [BiometricGateModule] is only a gate in front of it.
 *
 * ## Why two backends
 *
 * [EncryptedSharedPreferences] is the primary path: it wraps every value in
 * AES256-GCM under a [MasterKey] held in the Keystore, and the Tink keyset it keeps
 * alongside it makes the file useless without that key.
 *
 * It is not infallible. The classic failure is a device-to-device restore or a
 * partial `/data` restore where the app's files come across but the Keystore does
 * not (Keystore keys never leave the device that generated them). The file is then
 * still present and completely unreadable, and every read throws. Rather than
 * leaving the app wedged behind a store it can never read again, this module falls
 * back to [KeystoreAesGcmBackend] - an ordinary SharedPreferences file whose values
 * are AES-256-GCM ciphertext under a non-exportable AndroidKeyStore key. Same
 * security property (no key material on disk), one fewer moving part, no Tink.
 *
 * A broken backend is never reported to JS as "no PIN is set". That would be a
 * lockout bypass: clearing the verifier would otherwise let anyone in. Failures
 * reject the promise instead, and the UI turns a rejection into the reset path.
 */
class SecureStoreModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SecureStore"

    /**
     * PBKDF2 iteration count for a *new* PIN verifier.
     *
     * 600k is OWASP's current recommendation for PBKDF2-HMAC-SHA256. A 4-6 digit PIN
     * has very little entropy, so the iteration count is doing real work here: it is
     * what makes each offline guess expensive. Derivation runs on [worker] and takes
     * roughly 200-600ms on a mid-range phone, which is why the UI shows a busy state.
     *
     * The count is stored next to each verifier, so raising it later re-protects
     * existing PINs on their next successful unlock instead of leaving them stuck
     * on an old, weaker derivation.
     */
    private val newPinIterations = 600_000

    /** Derivation output length. 256 bits - the full width of the SHA-256 block it comes from. */
    private val pinKeyBits = 256

    /**
     * Consecutive wrong PINs allowed before a delay kicks in.
     *
     * Fumbling a PIN twice is not an attack, and locking someone out over a fat
     * finger on a security feature is how people end up uninstalling the app.
     */
    private val freeAttempts = 2

    /** First enforced delay, then doubled per further failure. */
    private val baseDelayMs = 30_000L

    /**
     * Ceiling on the exponential delay.
     *
     * There is deliberately no *permanent* lockout. A PIN brute-forcer with the
     * device in hand can always be made to wait; what matters is the cost, not an
     * unreachable state. The escape hatch is the explicit reset path (clear the lock
     * and sign out), which is always available and never rate-limited.
     */
    private val maxDelayMs = 900_000L

    private val worker: ExecutorService = Executors.newSingleThreadExecutor()

    private val random = SecureRandom()

    @Volatile
    private var backendInstance: Backend? = null

    /**
     * Backend selection, done once and reused.
     *
     * Opening a backend touches disk and may generate a Keystore key, so it is never
     * done on the calling thread - every public method goes through [worker] first.
     */
    private val backend: Backend
        get() = backendInstance ?: synchronized(this) {
            backendInstance ?: openBackend().also { backendInstance = it }
        }

    // ---------------------------------------------------------------- generic store

    @ReactMethod
    fun getItem(key: String, promise: Promise) = onWorker(promise) { store ->
        promise.resolve(store.get(dataKey(key)))
    }

    @ReactMethod
    fun setItem(key: String, value: String, promise: Promise) = onWorker(promise) { store ->
        store.put(dataKey(key), value)
        promise.resolve(null)
    }

    @ReactMethod
    fun removeItem(key: String, promise: Promise) = onWorker(promise) { store ->
        store.remove(dataKey(key))
        promise.resolve(null)
    }

    @ReactMethod
    fun getAllKeys(promise: Promise) = onWorker(promise) { store ->
        val keys: WritableArray = Arguments.createArray()
        store.keys()
            .filter { it.startsWith(DATA_PREFIX) }
            .forEach { keys.pushString(it.removePrefix(DATA_PREFIX)) }
        promise.resolve(keys)
    }

    /**
     * Which protection is actually active.
     *
     * Surfaced rather than hidden: "encrypted at rest" is a claim, and this is the
     * value that makes it checkable instead of assumed.
     */
    @ReactMethod
    fun getBackendInfo(promise: Promise) = onWorker(promise) { store ->
        val map = Arguments.createMap()
        map.putString("backend", store.name())
        map.putBoolean("available", true)
        promise.resolve(map)
    }

    // ---------------------------------------------------------------- app-lock PIN

    @ReactMethod
    fun hasPin(promise: Promise) = onWorker(promise) { store ->
        promise.resolve(store.hasPin())
    }

    /**
     * Stores a PIN verifier. Overwrites any previous one and clears the attempt
     * counter - setting a PIN is a deliberate act by someone who is already inside.
     */
    @ReactMethod
    fun setPin(pin: String, promise: Promise) = onWorker(promise) { store ->
        if (!isValidPinFormat(pin)) {
            promise.reject(E_INVALID_PIN, "PIN must be 4 to 6 digits")
            return@onWorker
        }
        store.setPin(pin, newPinIterations)
        promise.resolve(null)
    }

    @ReactMethod
    fun verifyPin(pin: String, promise: Promise) = onWorker(promise) { store ->
        if (!isValidPinFormat(pin)) {
            promise.reject(E_INVALID_PIN, "PIN must be 4 to 6 digits")
            return@onWorker
        }
        promise.resolve(store.verifyPin(pin))
    }

    @ReactMethod
    fun clearPin(promise: Promise) = onWorker(promise) { store ->
        store.clearPin()
        promise.resolve(null)
    }

    @ReactMethod
    fun recordPinFailure(promise: Promise) = onWorker(promise) { store ->
        promise.resolve(store.recordPinFailure())
    }

    @ReactMethod
    fun getPinLockout(promise: Promise) = onWorker(promise) { store ->
        promise.resolve(store.lockoutState())
    }

    @ReactMethod
    fun resetPinFailures(promise: Promise) = onWorker(promise) { store ->
        store.clearPinFailures()
        promise.resolve(null)
    }

    /**
     * The "I have forgotten the PIN" escape hatch.
     *
     * Wipes the verifier, the lockout counter and every user key in one go. Callers
     * are expected to sign out immediately afterwards; the point is that recovery is
     * always reachable, so no sequence of wrong guesses can strand anyone.
     */
    @ReactMethod
    fun clearAll(promise: Promise) = onWorker(promise) { store ->
        store.clearAll()
        promise.resolve(null)
    }

    // ---------------------------------------------------------------- internals

    private fun onWorker(promise: Promise, block: (Backend) -> Unit) {
        worker.execute {
            try {
                block(backend)
            } catch (error: BackendUnavailableException) {
                promise.reject(E_BACKEND, error.message, error)
            } catch (error: GeneralSecurityException) {
                promise.reject(E_BACKEND, "Secure store is unreadable: ${error.message}", error)
            } catch (error: Exception) {
                promise.reject(E_UNEXPECTED, error.message, error)
            }
        }
    }

    private fun openBackend(): Backend {
        val context = reactContext.applicationContext
        return try {
            EncryptedPrefsBackend(context)
        } catch (error: Exception) {
            android.util.Log.w(TAG, "EncryptedSharedPreferences unavailable; using Keystore AES-GCM", error)
            try {
                KeystoreAesGcmBackend(context)
            } catch (fallbackError: Exception) {
                throw BackendUnavailableException(
                    "No usable secure store: ${fallbackError.message}",
                    fallbackError,
                )
            }
        }
    }

    /** 4-6 digits, enforced here as well as in the UI so the rule has one owner. */
    private fun isValidPinFormat(pin: String): Boolean =
        pin.length in 4..6 && pin.all { it in '0'..'9' }

    private fun delayFor(attempts: Int): Long {
        if (attempts <= freeAttempts) {
            return 0L
        }
        val shift = minOf(attempts - freeAttempts - 1, 20)
        return minOf(baseDelayMs shl shift, maxDelayMs)
    }

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private fun dataKey(key: String) = DATA_PREFIX + key

    /** Which PBKDF2 construction to use. SHA-256 only exists from API 26. */
    private fun defaultAlgorithm(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PBKDF2_SHA256
        } else {
            PBKDF2_SHA1
        }

    // ---------------------------------------------------------------- backend contract

    /**
     * `cause` is optional because most of these are conditions, not wrappers: "the
     * verifier is incomplete" and "the fallback record is malformed" have no
     * underlying exception to attach, and forcing a dummy one purely to satisfy a
     * two-argument constructor is noise. Every other throw site here does pass a
     * real cause.
     */
    private class BackendUnavailableException(message: String, cause: Throwable? = null) :
        Exception(message, cause)

    /**
     * The storage primitives this module needs, plus the PIN logic, which is
     * deliberately kept here rather than duplicated per backend.
     */
    private abstract inner class Backend {

        abstract fun name(): String

        abstract fun get(key: String): String?

        abstract fun put(key: String, value: String)

        abstract fun remove(key: String)

        abstract fun keys(): List<String>

        abstract fun wipe()

        open fun hasPin(): Boolean = get(KEY_PIN_HASH) != null

        fun clearAll() {
            keys().forEach { remove(it) }
            wipe()
        }

        fun clearPin() {
            remove(KEY_PIN_HASH)
            remove(KEY_PIN_SALT)
            remove(KEY_PIN_ITERATIONS)
            remove(KEY_PIN_ALGO)
            remove(KEY_PIN_LENGTH)
            clearPinFailures()
        }

        fun clearPinFailures() {
            remove(KEY_LOCK_ATTEMPTS)
            remove(KEY_LOCK_UNTIL)
        }

        /**
         * Writes a fresh verifier with a new per-install random salt.
         *
         * A fresh salt per PIN means two users who both pick 1234 do not share a
         * hash, and a second `setPin` does not produce a value comparable against
         * the first.
         */
        fun setPin(pin: String, iterations: Int) {
            val salt = ByteArray(SALT_BYTES).also { random.nextBytes(it) }
            val algorithm = defaultAlgorithm()
            val digest = derive(pin, salt, iterations, algorithm)
            put(KEY_PIN_SALT, encode(salt))
            put(KEY_PIN_ITERATIONS, iterations.toString())
            put(KEY_PIN_ALGO, algorithm)
            put(KEY_PIN_HASH, encode(digest))
            put(KEY_PIN_LENGTH, pin.length.toString())
            clearPinFailures()
        }

        /**
         * Checks a candidate PIN and, on failure, advances the lockout.
         *
         * Returns a map rather than a boolean so the UI can tell "wrong" apart from
         * "come back in 4 minutes" and show a countdown instead of silently
         * swallowing the attempt.
         */
        fun verifyPin(pin: String): WritableMap {
            val result = Arguments.createMap()

            val storedHash = get(KEY_PIN_HASH)
            val storedSalt = get(KEY_PIN_SALT)
            val storedIterations = get(KEY_PIN_ITERATIONS)?.toIntOrNull()
            val storedAlgorithm = get(KEY_PIN_ALGO)
            if (storedHash == null || storedSalt == null || storedIterations == null ||
                storedAlgorithm == null
            ) {
                // Explicit, and not silently "no match": a half-written or
                // truncated verifier means the store is damaged, not that any PIN
                // is acceptable.
                throw BackendUnavailableException("PIN verifier is incomplete")
            }

            val until = get(KEY_LOCK_UNTIL)?.toLongOrNull() ?: 0L
            val now = System.currentTimeMillis()
            if (until > now) {
                result.putBoolean("ok", false)
                result.putBoolean("locked", true)
                result.putLong("lockedUntil", until)
                result.putInt("attempts", (get(KEY_LOCK_ATTEMPTS)?.toIntOrNull() ?: 0))
                return result
            }

            val candidate = derive(pin, decode(storedSalt), storedIterations, storedAlgorithm)
            // Constant-time compare. A byte-by-byte early-exit compare leaks how
            // many leading bytes were right, which is enough to shave a brute force
            // down measurably.
            val matches = MessageDigest.isEqual(decode(storedHash), candidate)
            candidate.fill(0)

            if (matches) {
                clearPinFailures()
                result.putBoolean("ok", true)
                result.putBoolean("locked", false)
                result.putInt("attempts", 0)
                return result
            }

            val failure = recordPinFailure()
            result.putBoolean("ok", false)
            result.putBoolean("locked", failure.getBoolean("locked"))
            result.putLong("lockedUntil", failure.getLong("lockedUntil"))
            result.putInt("attempts", failure.getInt("attempts"))
            return result
        }

        fun recordPinFailure(): WritableMap {
            val attempts = (get(KEY_LOCK_ATTEMPTS)?.toIntOrNull() ?: 0) + 1
            val delay = delayFor(attempts)
            val until = System.currentTimeMillis() + delay
            put(KEY_LOCK_ATTEMPTS, attempts.toString())
            put(KEY_LOCK_UNTIL, until.toString())

            val map = Arguments.createMap()
            map.putInt("attempts", attempts)
            map.putLong("lockedUntil", until)
            map.putBoolean("locked", delay > 0L)
            return map
        }

        fun lockoutState(): WritableMap {
            val until = get(KEY_LOCK_UNTIL)?.toLongOrNull() ?: 0L
            val map = Arguments.createMap()
            map.putInt("attempts", get(KEY_LOCK_ATTEMPTS)?.toIntOrNull() ?: 0)
            map.putLong("lockedUntil", until)
            map.putBoolean("locked", until > System.currentTimeMillis())
            return map
        }

        fun derive(pin: String, salt: ByteArray, iterations: Int, algorithm: String): ByteArray {
            val spec = PBEKeySpec(pin.toCharArray(), salt, iterations, pinKeyBits)
            try {
                return SecretKeyFactory.getInstance(algorithm).generateSecret(spec).encoded
            } finally {
                // Drops the key material held by the spec. The String that came in
                // over the bridge is immutable and cannot be wiped in the same way -
                // the honest limit of a JS bridge that only carries strings.
                spec.clearPassword()
            }
        }
    }

    // ---------------------------------------------------------------- backends

    /** Primary path: AES256-GCM per value under a Keystore-backed [MasterKey]. */
    private inner class EncryptedPrefsBackend(context: Context) : Backend() {

        private val appContext: Context = context.applicationContext

        private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
            context,
            PREFS_FILE,
            MasterKey.Builder(context, MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

        override fun name(): String = BACKEND_ENCRYPTED_PREFS

        /**
         * Reads, converting Tink/Keystore failure into a clean rejection.
         *
         * The distinction matters: an unreadable store must never look like an empty
         * one, or every "is a PIN set" check in the app silently flips to false.
         */
        override fun get(key: String): String? = try {
            prefs.getString(key, null)
        } catch (error: SecurityException) {
            throw BackendUnavailableException("Secure store keyset is unusable", error)
        } catch (error: GeneralSecurityException) {
            throw BackendUnavailableException("Secure store keyset is unusable", error)
        }

        override fun put(key: String, value: String) {
            try {
                prefs.edit().putString(key, value).apply()
            } catch (error: SecurityException) {
                throw BackendUnavailableException("Secure store keyset is unusable", error)
            }
        }

        override fun remove(key: String) {
            prefs.edit().remove(key).apply()
        }

        override fun keys(): List<String> = try {
            prefs.all.keys.toList()
        } catch (error: SecurityException) {
            throw BackendUnavailableException("Secure store keyset is unusable", error)
        }

        override fun wipe() {
            prefs.edit().clear().apply()
            appContext.deleteSharedPreferences(PREFS_FILE)
        }
    }

    /**
     * Fallback: an ordinary SharedPreferences file of AES-256-GCM ciphertext.
     *
     * Used when `EncryptedSharedPreferences` cannot be initialised at all - typically
     * a restored-from-backup install whose Keystore entries did not come with it.
     * Values are `base64(iv):base64(ciphertext)`; the key itself never leaves
     * `AndroidKeyStore` and is created non-exportable, so reading the file off a
     * rooted device yields ciphertext and nothing else.
     */
    private inner class KeystoreAesGcmBackend(context: Context) : Backend() {

        private val appContext = context.applicationContext
        private val prefs: SharedPreferences =
            appContext.getSharedPreferences(FALLBACK_FILE, Context.MODE_PRIVATE)

        private val secretKey: SecretKey by lazy { loadOrCreateKey() }

        override fun name(): String = BACKEND_KEYSTORE_AES

        override fun get(key: String): String? {
            val stored = prefs.getString(key, null) ?: return null
            val separator = stored.indexOf(SEPARATOR)
            if (separator <= 0) {
                throw BackendUnavailableException("Fallback record is malformed")
            }
            return try {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    secretKey,
                    GCMParameterSpec(GCM_TAG_BITS, decode(stored.substring(0, separator))),
                )
                encode(cipher.doFinal(decode(stored.substring(separator + 1))))
            } catch (error: GeneralSecurityException) {
                throw BackendUnavailableException("Fallback record could not be decrypted", error)
            }
        }

        override fun put(key: String, value: String) {
            try {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.ENCRYPT_MODE, secretKey)
                // Fresh IV per write, as GCM requires. A fixed IV under one key
                // would leak the XOR of plaintexts, which for a store holding
                // short repeated values is close to reading them.
                val iv = encode(cipher.iv)
                val body = encode(cipher.doFinal(value.toByteArray()))
                prefs.edit().putString(key, "$iv$SEPARATOR$body").apply()
            } catch (error: GeneralSecurityException) {
                throw BackendUnavailableException("Fallback record could not be encrypted", error)
            }
        }

        override fun remove(key: String) {
            prefs.edit().remove(key).apply()
        }

        override fun keys(): List<String> = prefs.all.keys.toList()

        override fun wipe() {
            prefs.edit().clear().apply()
        }

        private fun loadOrCreateKey(): SecretKey {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            (keyStore.getEntry(FALLBACK_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)
                ?.secretKey
                ?.let { return it }

            val generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE,
            )
            generator.init(
                KeyGenParameterSpec.Builder(
                    FALLBACK_KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(FALLBACK_KEY_BITS)
                    // No user-authentication requirement here on purpose. The lock
                    // is a gate in front of this data, not the thing protecting the
                    // key: binding the key to biometric auth would mean the app PIN
                    // could no longer decrypt the session token, so a forgotten PIN
                    // would brick sign-in rather than sign the user out.
                    .setUserAuthenticationRequired(false)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            return generator.generateKey()
        }
    }

    companion object {
        private const val TAG = "SecureStore"
        private const val E_INVALID_PIN = "E_INVALID_PIN"
        private const val E_BACKEND = "E_SECURE_STORE_UNAVAILABLE"
        private const val E_UNEXPECTED = "E_SECURE_STORE"

        private const val BACKEND_ENCRYPTED_PREFS = "encryptedSharedPreferences"
        private const val BACKEND_KEYSTORE_AES = "keystoreAesGcm"

        private const val PREFS_FILE = "synomilo_secure_store"
        private const val MASTER_KEY_ALIAS = "synomilo_secure_store_master"
        private const val FALLBACK_FILE = "synomilo_secure_store_fallback"
        private const val FALLBACK_KEY_ALIAS = "synomilo_secure_store_fallback_v1"

        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val FALLBACK_KEY_BITS = 256
        private const val SEPARATOR = ':'

        private const val PBKDF2_SHA256 = "PBKDF2WithHmacSHA256"
        private const val PBKDF2_SHA1 = "PBKDF2WithHmacSHA1"
        private const val SALT_BYTES = 32

        /** Namespace for caller-supplied keys. Everything else is module-internal. */
        private const val DATA_PREFIX = "d:"

        private const val KEY_PIN_HASH = "pin_hash"
        private const val KEY_PIN_SALT = "pin_salt"
        private const val KEY_PIN_ITERATIONS = "pin_iterations"
        private const val KEY_PIN_ALGO = "pin_algo"
        private const val KEY_PIN_LENGTH = "pin_length"
        private const val KEY_LOCK_ATTEMPTS = "lock_attempts"
        private const val KEY_LOCK_UNTIL = "lock_until"
    }
}