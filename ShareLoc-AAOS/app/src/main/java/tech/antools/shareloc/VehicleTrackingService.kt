package tech.antools.shareloc

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class VehicleTrackingService : Service(), LocationListener {
    private lateinit var locationManager: LocationManager
    private lateinit var uploader: TelemetryUploader
    private lateinit var guidanceReader: NaviGuidanceReader
    private var receivingUpdates = false
    private var lastUploadElapsedMs = 0L

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startAsForeground()
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        uploader = TelemetryUploader(this)
        guidanceReader = NaviGuidanceReader(this) { info -> TrackingStateStore.setNavigation(this, info) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            stopSelf()
            return START_NOT_STICKY
        }
        startTracking()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startTracking() {
        if (receivingUpdates) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            TrackingStateStore.setError(this, getString(R.string.location_permission_required))
            stopSelf()
            return
        }

        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { provider -> runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false) }

        if (providers.isEmpty()) {
            TrackingStateStore.setError(this, "No enabled Android location provider was found.")
            return
        }

        try {
            providers.forEach { provider ->
                locationManager.requestLocationUpdates(provider, 500L, 0f, this)
                locationManager.getLastKnownLocation(provider)?.let(::acceptLocation)
            }
            receivingUpdates = true
            guidanceReader.start()
            TrackingStateStore.setTracking(this, true, getString(R.string.status_waiting))
        } catch (e: SecurityException) {
            TrackingStateStore.setError(this, e.message ?: getString(R.string.location_permission_required))
            stopSelf()
        }
    }

    private fun stopTracking() {
        if (::locationManager.isInitialized) runCatching { locationManager.removeUpdates(this) }
        if (::guidanceReader.isInitialized) guidanceReader.stop()
        receivingUpdates = false
        TrackingStateStore.setTracking(this, false, getString(R.string.status_off_detail))
    }

    override fun onLocationChanged(location: Location) = acceptLocation(location)

    @Deprecated("Deprecated in the platform API but still called on older releases")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) {
        TrackingStateStore.setError(this, "Location provider disabled: $provider")
    }

    private fun acceptLocation(location: Location) {
        if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return
        val nowElapsed = android.os.SystemClock.elapsedRealtime()
        if (nowElapsed - lastUploadElapsedMs < 950L) return
        lastUploadElapsedMs = nowElapsed

        val payload = TelemetryPayload.fromLocation(location).copy(
            navigation = guidanceReader.current,
            navigationKnown = guidanceReader.isActive,
        )
        TrackingStateStore.setLocation(this, payload)
        uploader.enqueue(payload)
    }

    override fun onDestroy() {
        stopTracking()
        if (::uploader.isInitialized) uploader.shutdown()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel),
                NotificationManager.IMPORTANCE_LOW,
            )
        )
    }

    private fun startAsForeground() {
        val openIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, VehicleTrackingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, getString(R.string.notification_stop), stopIntent)
            .build()

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
        )
    }

    companion object {
        const val ACTION_START = "tech.antools.shareloc.START"
        const val ACTION_STOP = "tech.antools.shareloc.STOP"
        private const val CHANNEL_ID = "shareloc_location"
        private const val NOTIFICATION_ID = 7001
    }
}
