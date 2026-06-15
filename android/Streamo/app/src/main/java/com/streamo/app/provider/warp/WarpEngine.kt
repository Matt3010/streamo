package com.streamo.app.provider.warp

import com.streamo.app.provider.ProviderDebugLogger
import java.lang.reflect.Method

/**
 * Reflection wrapper around the gomobile-generated WARP engine
 * (`com.streamo.warp.wireproxykit.Wireproxykit`, built from `ios/wireproxykit`
 * into `app/libs/warpkit.aar`).
 *
 * Reflection — not a direct call — so the app compiles and runs even when the
 * `.aar` isn't present (e.g. a build machine without the Go/NDK toolchain). When
 * the class is missing, [isAvailable] is false and WARP mode stays off, mirroring
 * iOS's `UnavailableWarpProxyEngine` stub.
 *
 * gomobile maps the Go funcs to static Java methods:
 *  - `func Register() (string, error)` -> `String register() throws Exception`
 *  - `func Start(config string) error`  -> `void start(String) throws Exception`
 *  - `func Stop()`                      -> `void stop()`
 */
object WarpEngine {
    private const val CLASS_NAME = "com.streamo.warp.wireproxykit.Wireproxykit"

    private val engineClass: Class<*>? by lazy {
        // Loading the gomobile class boots the Go runtime (System.loadLibrary).
        // If the native lib for the current ABI isn't packaged (e.g. x86 emulator
        // without x86 libs) this throws UnsatisfiedLinkError — caught below,
        // same graceful degradation as a missing .aar.
        try {
            Class.forName(CLASS_NAME)
        } catch (_: Throwable) {
            ProviderDebugLogger.log("WarpEngine: gomobile class not found ($CLASS_NAME) — WARP unavailable")
            null
        }
    }

    private val registerMethod: Method? by lazy { engineClass?.getMethod("register") }
    private val startMethod: Method? by lazy { engineClass?.getMethod("start", String::class.java) }
    private val stopMethod: Method? by lazy { engineClass?.getMethod("stop") }
    private val setTmpDirMethod: Method? by lazy { engineClass?.getMethod("setTmpDir", String::class.java) }

    /** True when the gomobile engine is linked into this build. */
    val isAvailable: Boolean get() = engineClass != null

    /**
     * Register a fresh WARP account; returns the `[Interface]`/`[Peer]` config.
     * @throws IllegalStateException if the engine isn't available.
     */
    fun register(): String {
        val m = registerMethod ?: error("Motore WARP non disponibile in questa build.")
        return invoke { m.invoke(null) } as String
    }

    /** Point the engine's temp-file dir at a writable path (Android cache dir). */
    fun setTmpDir(dir: String) {
        val m = setTmpDirMethod ?: return
        try {
            m.invoke(null, dir)
        } catch (e: Throwable) {
            ProviderDebugLogger.logError("WarpEngine.setTmpDir failed", unwrap(e))
        }
    }

    /** Start the tunnel + local proxy described by [config] (must include `[http]`). */
    fun start(config: String) {
        val m = startMethod ?: error("Motore WARP non disponibile in questa build.")
        invoke { m.invoke(null, config) }
    }

    /** Stop the tunnel. Safe to call when not running / unavailable. */
    fun stop() {
        val m = stopMethod ?: return
        try {
            m.invoke(null)
        } catch (e: Throwable) {
            ProviderDebugLogger.logError("WarpEngine.stop failed", unwrap(e))
        }
    }

    /** Run a reflective call, unwrapping the Go-bridged exception. */
    private inline fun invoke(block: () -> Any?): Any? {
        return try {
            block()
        } catch (e: Throwable) {
            throw unwrap(e)
        }
    }

    /** Reflection wraps the real error in InvocationTargetException — unwrap it. */
    private fun unwrap(e: Throwable): Throwable =
        (e as? java.lang.reflect.InvocationTargetException)?.targetException ?: e
}
