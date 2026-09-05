package tech.antools.shareloc

import android.location.Location
import android.os.Build
import org.json.JSONObject

data class TelemetryPayload(
    val vehicleId: String,
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Double?,
    val bearing: Double?,
    val accuracyMeters: Double?,
    val source: String,
    val timestamp: Long,
    /** Route guidance from the vehicle navi; null when no route is active. */
    val navigation: NavigationInfo? = null,
    /** True when a guidance reader is running, so a null [navigation] means "no active route". */
    val navigationKnown: Boolean = false,
) {
    fun toJson(): String = JSONObject().apply {
        put("vehicleId", vehicleId)
        put("latitude", latitude)
        put("longitude", longitude)
        put("speedKmh", speedKmh ?: JSONObject.NULL)
        put("bearing", bearing ?: JSONObject.NULL)
        put("accuracyMeters", accuracyMeters ?: JSONObject.NULL)
        put("source", source)
        put("timestamp", timestamp)
        if (navigationKnown) put("navigation", navigation?.toJson() ?: JSONObject.NULL)
    }.toString()

    companion object {
        fun fromLocation(location: Location): TelemetryPayload {
            val isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                location.isMock
            } else {
                @Suppress("DEPRECATION")
                location.isFromMockProvider
            }
            val provider = location.provider ?: "unknown"
            return TelemetryPayload(
                vehicleId = BuildConfig.VEHICLE_ID,
                latitude = location.latitude,
                longitude = location.longitude,
                speedKmh = if (location.hasSpeed()) location.speed.toDouble() * 3.6 else null,
                bearing = if (location.hasBearing()) location.bearing.toDouble() else null,
                accuracyMeters = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                source = if (isMock) "android-location:$provider:mock" else "android-location:$provider",
                timestamp = if (location.time > 0L) location.time else System.currentTimeMillis(),
            )
        }
    }
}
