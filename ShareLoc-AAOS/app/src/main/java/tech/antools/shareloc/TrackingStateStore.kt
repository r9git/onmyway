package tech.antools.shareloc

import android.content.Context
import android.content.Intent

data class TrackingSnapshot(
    val tracking: Boolean,
    val latitude: Double?,
    val longitude: Double?,
    val speedKmh: Double?,
    val bearing: Double?,
    val accuracyMeters: Double?,
    val source: String?,
    val lastUploadAt: Long?,
    val statusMessage: String?,
    val error: Boolean,
)

object TrackingStateStore {
    const val ACTION_STATUS = "tech.antools.shareloc.ACTION_STATUS"
    private const val PREFS = "shareloc_tracking"

    fun setTracking(context: Context, tracking: Boolean, message: String? = null) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("tracking", tracking)
            .putString("statusMessage", message)
            .putBoolean("error", false)
            .apply()
        notify(context)
    }

    fun setLocation(context: Context, payload: TelemetryPayload) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("latBits", payload.latitude.toBits())
            .putLong("lonBits", payload.longitude.toBits())
            .apply {
                payload.speedKmh?.let { putLong("speedBits", it.toBits()) } ?: remove("speedBits")
                payload.bearing?.let { putLong("bearingBits", it.toBits()) } ?: remove("bearingBits")
                payload.accuracyMeters?.let { putLong("accuracyBits", it.toBits()) } ?: remove("accuracyBits")
            }
            .putString("source", payload.source)
            .apply()
        notify(context)
    }

    fun setUploadSuccess(context: Context, receivedAt: Long = System.currentTimeMillis()) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("lastUploadAt", receivedAt)
            .putString("statusMessage", "Connected to server")
            .putBoolean("error", false)
            .apply()
        notify(context)
    }

    fun setError(context: Context, message: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("statusMessage", message)
            .putBoolean("error", true)
            .apply()
        notify(context)
    }

    fun read(context: Context): TrackingSnapshot {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return TrackingSnapshot(
            tracking = p.getBoolean("tracking", false),
            latitude = p.getBitsOrNull("latBits"),
            longitude = p.getBitsOrNull("lonBits"),
            speedKmh = p.getBitsOrNull("speedBits"),
            bearing = p.getBitsOrNull("bearingBits"),
            accuracyMeters = p.getBitsOrNull("accuracyBits"),
            source = p.getString("source", null),
            lastUploadAt = if (p.contains("lastUploadAt")) p.getLong("lastUploadAt", 0L) else null,
            statusMessage = p.getString("statusMessage", null),
            error = p.getBoolean("error", false),
        )
    }

    private fun android.content.SharedPreferences.getBitsOrNull(key: String): Double? =
        if (contains(key)) Double.fromBits(getLong(key, 0L)) else null

    private fun notify(context: Context) {
        context.sendBroadcast(Intent(ACTION_STATUS).setPackage(context.packageName))
    }
}
