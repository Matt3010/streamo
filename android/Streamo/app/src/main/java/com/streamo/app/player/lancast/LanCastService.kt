package com.streamo.app.player.lancast

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.streamo.app.MainActivity
import com.streamo.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground service che mantiene attivo LanCastServer sulla TV.
 *
 * Registra il servizio NSD [_streamo._tcp] così i telefoni sulla stessa rete
 * scoprono la TV e possono comandarla via HTTP.
 *
 * Avviato solo su dispositivi TV (isTvDevice() == true).
 */
class LanCastService : Service() {

    private var nsdManager: NsdManager? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        observeCommands()
        Log.d(TAG, "service created")
    }

    /** Su ogni comando Play porta l'app TV in primo piano e apre il player. */
    private fun observeCommands() {
        serviceScope.launch {
            LanCastReceiver.commands.collect { cmd ->
                if (cmd is LanCommand.Play) launchPlayer()
            }
        }
    }

    private fun launchPlayer() {
        // TvRootView, appena visibile, legge LanCastReceiver.pendingPlay e apre il player.
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            )
        }
        try {
            startActivity(intent)
            Log.d(TAG, "launchPlayer: startActivity ok")
        } catch (e: Exception) {
            // Background activity launch bloccato dal sistema: ripiega su notifica full-screen.
            Log.w(TAG, "startActivity blocked, using full-screen intent", e)
            showFullScreenLaunch(intent)
        }
    }

    private fun showFullScreenLaunch(activityIntent: Intent) {
        val pi = PendingIntent.getActivity(
            this, 1, activityIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notif = NotificationCompat.Builder(this, LAUNCH_CHANNEL_ID)
            .setContentTitle("Project Obsidian")
            .setContentText("Trasmissione in arrivo dal telefono")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pi, true)
            .setAutoCancel(true)
            .build()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(LAUNCH_NOTIFICATION_ID, notif)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // specialUse: nessun FGS type standard descrive un server HTTP/NSD locale.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
        startServer()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        serviceScope.cancel()
        stopNsd()
        LanCastReceiver.stop()
        releaseLocks()
        Log.d(TAG, "service destroyed")
        super.onDestroy()
    }

    private fun startServer() {
        // Se già attivo, non riavviare.
        if (LanCastReceiver.isRunning) return

        if (!LanCastReceiver.start()) {
            Log.w(TAG, "server start failed, stopping service")
            stopSelf()
            return
        }

        registerNsd()
        acquireLocks()
        Log.i(TAG, "server running on port ${LanCastReceiver.listeningPort}")
    }

    // --- NSD ---

    private fun registerNsd() {
        nsdManager = (getSystemService(Context.NSD_SERVICE) as? NsdManager)?.also { nsd ->
            val serviceInfo = NsdServiceInfo().apply {
                serviceName = "Project Obsidian - ${Build.MODEL}"
                serviceType = SERVICE_TYPE
                port = LanCastReceiver.listeningPort
            }

            registrationListener = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(serviceInfo: NsdServiceInfo?) {
                    Log.d(TAG, "NSD registered: ${serviceInfo?.serviceName}")
                }
                override fun onRegistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                    Log.w(TAG, "NSD registration failed: $errorCode")
                }
                override fun onServiceUnregistered(serviceInfo: NsdServiceInfo?) {
                    Log.d(TAG, "NSD unregistered")
                }
                override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                    Log.w(TAG, "NSD unregistration failed: $errorCode")
                }
            }

            nsd.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener!!)
        }
    }

    private fun stopNsd() {
        runCatching {
            registrationListener?.let { nsdManager?.unregisterService(it) }
        }
        registrationListener = null
        nsdManager = null
    }

    // --- Locks ---

    private fun acquireLocks() {
        runCatching {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            multicastLock = wifi?.createMulticastLock("streamo:nsd")?.apply {
                setReferenceCounted(true)
                acquire()
            }
        }
    }

    private fun releaseLocks() {
        runCatching { if (multicastLock?.isHeld == true) multicastLock?.release() }
        multicastLock = null
    }

    // --- Notification ---

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Obsidian Cast",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene attiva la ricezione di trasmissioni da altri dispositivi"
                setShowBadge(false)
            }
            // Canale ad alta priorità per il full-screen intent che apre il player.
            val launchChannel = NotificationChannel(
                LAUNCH_CHANNEL_ID,
                "Obsidian Cast - Avvio",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Apre il player quando arriva una trasmissione dal telefono"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
            nm.createNotificationChannel(launchChannel)
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Project Obsidian")
            .setContentText("Pronto per ricevere trasmissioni")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val TAG = "LanCastService"
        private const val CHANNEL_ID = "streamo_cast"
        private const val LAUNCH_CHANNEL_ID = "streamo_cast_launch"
        private const val NOTIFICATION_ID = 3001
        private const val LAUNCH_NOTIFICATION_ID = 3002
        private const val SERVICE_TYPE = "_streamo._tcp"

        /** Avvia il servizio solo su dispositivi TV. */
        fun startIfTv(context: Context) {
            context.startForegroundService(Intent(context, LanCastService::class.java))
        }
    }
}
