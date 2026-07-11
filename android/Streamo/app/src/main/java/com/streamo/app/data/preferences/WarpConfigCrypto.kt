package com.streamo.app.data.preferences

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifra/decifra il config WireGuard WARP usando una chiave AES-256 custodita
 * dall'Android Keystore. Il config contiene la chiave privata WG: non deve
 * mai stare in chiaro su disco (DataStore SharedPreferences sono in chiaro).
 *
 * La chiave e non estraibile: le operazioni di cifratura/decifratura avvengono
 * dentro il Keystore hardware-backed (quando disponibile). Il ciphertext e
 * memorizzato come stringa Base64 nel DataStore.
 *
 * Compatibile con API 24+ (minSdk del progetto).
 */
object WarpConfigCrypto {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "streamo_warp_config_key"
    private const val GCM_IV_LENGTH = 12 // byte, standard GCM
    private const val GCM_TAG_LENGTH = 128 // bit

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        keyStore.getKey(KEY_ALIAS, null)?.let { return it as SecretKey }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE
        )
        keyGenerator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return keyGenerator.generateKey()
    }

    /**
     * Returns Base64(IV + ciphertext) — safe to store in DataStore.
     */
    fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        // Prepend IV: Base64(iv + ciphertext)
        val combined = ByteArray(iv.size + encrypted.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encrypted, 0, combined, iv.size, encrypted.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    /**
     * Decrypts a Base64(IV + ciphertext) string. Returns null on any failure
     * (wrong key, corrupted data, migration from plaintext).
     */
    fun decrypt(encoded: String): String? {
        return try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            if (combined.size < GCM_IV_LENGTH) return null
            val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
            val ciphertext = combined.copyOfRange(GCM_IV_LENGTH, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_LENGTH, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Heuristic: returns true if the stored value looks like a Base64 ciphertext
     * produced by [encrypt], false if it's still a plaintext WARP config (legacy).
     * Used to detect a migration-needed entry: plaintext WARP configs start with
     * "[Interface]" or "[Peer]".
     */
    fun isEncrypted(value: String): Boolean {
        // WARP config is always multi-line and starts with [Interface].
        // Our ciphertext is a single-line Base64 blob.
        return !value.contains("[Interface]") && !value.contains("[Peer]")
    }
}