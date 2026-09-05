package tech.antools.shareloc

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.time.Instant
import java.util.concurrent.atomic.AtomicReference

/**
 * Observes the Škoda/CARIAD navigation app through logcat and extracts route guidance
 * (destination, ETA, remaining distance, battery state of charge and charging stops).
 *
 * Reading logcat needs android.permission.READ_LOGS, which is a development permission
 * on this platform: grant it on the emulator with
 * `adb shell pm grant <package> android.permission.READ_LOGS`. Without the permission
 * the reader stays inactive and the app behaves exactly as before.
 */
class NaviGuidanceReader(private val context: Context, private val onChanged: (NavigationInfo?) -> Unit) {
    private val latest = AtomicReference<NavigationInfo?>(null)
    private var process: Process? = null
    private var thread: Thread? = null
    @Volatile private var running = false

    private var destinations: List<TourDestination> = emptyList()
    private var routeParams: RouteParams? = null
    private var lastVehicleSocWh: Double? = null

    val isActive: Boolean get() = running

    val current: NavigationInfo?
        get() = latest.get()?.takeIf { SystemClock.elapsedRealtime() - it.observedAtElapsedMs < GUIDANCE_TIMEOUT_MS }

    fun start() {
        if (running || !isPermitted(context)) return
        running = true
        thread = Thread({ readLoop() }, "navi-guidance-reader").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        process?.destroy()
        process = null
        thread?.interrupt()
        thread = null
    }

    private fun readLoop() {
        while (running) {
            try {
                val proc = ProcessBuilder("logcat", "-v", "raw", "-T", "1", "-b", "main", "*:I")
                    .redirectErrorStream(true)
                    .start()
                process = proc
                BufferedReader(InputStreamReader(proc.inputStream, Charsets.UTF_8), 1 shl 16).use { reader ->
                    while (running) {
                        val line = reader.readLine() ?: break
                        if (line.contains(NAVI_PACKAGE)) handleLine(line)
                    }
                }
            } catch (e: Exception) {
                if (running) Log.w(TAG, "logcat reader failed: ${e.message}")
            }
            if (running) SystemClock.sleep(3000)
        }
    }

    private fun handleLine(line: String) {
        if (line.contains("vehicleStateOfChargeInWh")) {
            SOC_WH_RE.find(line)?.groupValues?.get(1)?.toDoubleOrNull()?.let { lastVehicleSocWh = it }
        }
        when {
            line.contains("\"sendNavRouteParameters\"") -> parseRouteParams(line)?.let { params ->
                routeParams = params
                publish()
            }
            line.contains("#tourData(") -> {
                destinations = parseTourData(line)
                publish()
            }
        }
    }

    private fun publish() {
        val params = routeParams
        val finalDestination = destinations.lastOrNull()
        val active = params?.isActive != false && (params != null || finalDestination != null)
        val info = if (!active) {
            null
        } else {
            val nextStop = destinations.firstOrNull { !it.wasReached }
            val chargingStop = nextStop?.takeIf { it !== finalDestination && it.isChargingStop }?.let {
                ChargingStop(it.name, it.distanceMeters, it.chargingSeconds, it.latitude, it.longitude)
            }
            NavigationInfo(
                destination = finalDestination?.let { NavigationPlace(it.name, it.address, it.latitude, it.longitude) },
                etaEpochMs = params?.etaEpochMs ?: finalDestination?.etaEpochMs,
                remainingMeters = params?.remainingMeters ?: finalDestination?.distanceMeters,
                remainingSeconds = params?.remainingSeconds ?: finalDestination?.tripSeconds,
                socPercent = params?.socPercent,
                arrivalSocPercent = finalDestination?.arrivalSocPercent,
                chargingStop = chargingStop,
                observedAtElapsedMs = SystemClock.elapsedRealtime(),
            )
        }
        latest.set(info)
        onChanged(info)
    }

    // ---- parsers -------------------------------------------------------------------------

    private data class RouteParams(
        val isActive: Boolean,
        val etaEpochMs: Long?,
        val remainingMeters: Double?,
        val remainingSeconds: Double?,
        val socPercent: Double?,
    )

    private data class TourDestination(
        val name: String?,
        val address: String?,
        val latitude: Double?,
        val longitude: Double?,
        val distanceMeters: Double?,
        val tripSeconds: Double?,
        val etaEpochMs: Long?,
        val arrivalSocPercent: Double?,
        val chargingSeconds: Double?,
        val isChargingStop: Boolean,
        val wasReached: Boolean,
    )

    private fun parseRouteParams(line: String): RouteParams? {
        val start = line.indexOf("{\"method\"")
        if (start < 0) return null
        return runCatching {
            val root = JSONObject(line.substring(start))
            val params = root.getJSONObject("msg").getJSONObject("navRouteParameters")
            val remainingCm = params.optString("remainingLengthInCm").toDoubleOrNull()
            val chargeAtArrivalWh = params.optString("chargeAtArrivalInWh").toDoubleOrNull()
            val socPercent = computeSocPercent(chargeAtArrivalWh)
            RouteParams(
                isActive = params.optString("isActive", "true") != "false",
                etaEpochMs = params.optString("estimatedTimeOfArrival").toLongOrNull(),
                remainingMeters = remainingCm?.div(100.0),
                remainingSeconds = params.optString("remainingTimeInSeconds").toDoubleOrNull(),
                socPercent = socPercent,
            )
        }.getOrElse {
            Log.w(TAG, "navRouteParameters parse failed: ${it.message}")
            null
        }
    }

    /**
     * The navi logs the pack energy in Wh but percentages only for arrival. Battery capacity is
     * derived from the arrival pair (Wh and %), which gives the current percentage.
     */
    private fun computeSocPercent(chargeAtArrivalWh: Double?): Double? {
        val arrivalPercent = destinations.firstOrNull { !it.wasReached }?.arrivalSocPercent
        val currentWh = lastVehicleSocWh
        if (chargeAtArrivalWh == null || arrivalPercent == null || arrivalPercent <= 0 || currentWh == null) return null
        val capacityWh = chargeAtArrivalWh / (arrivalPercent / 100.0)
        return (currentWh / capacityWh * 100.0).coerceIn(0.0, 100.0)
    }

    private fun parseTourData(line: String): List<TourDestination> {
        val chunks = line.split("TourDestination(").drop(1)
        return chunks.map { chunk ->
            val latitude = LAT_RE.find(chunk)?.groupValues?.get(1)?.toDoubleOrNull()
            val longitude = LON_RE.find(chunk)?.groupValues?.get(1)?.toDoubleOrNull()
            val locationStrings = LOCATION_STRINGS_RE.find(chunk)?.groupValues?.get(1)
            val name = POI_NAME_RE.find(chunk)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
                ?: locationStrings?.substringBefore(",")?.trim()
            val address = locationStrings?.substringAfter(",", "")?.trim()?.takeIf { it.isNotEmpty() }
            val dynamic = chunk.substringAfter("DynamicDestinationInfo(", "")
            TourDestination(
                name = name,
                address = address,
                latitude = latitude,
                longitude = longitude,
                distanceMeters = field(dynamic, "distanceInM")?.toDoubleOrNull(),
                tripSeconds = field(dynamic, "tripTimeInSeconds")?.toDoubleOrNull(),
                etaEpochMs = field(dynamic, "estimatedTimeOfArrival")?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() },
                arrivalSocPercent = field(dynamic, "arrivalSoc")?.toDoubleOrNull(),
                chargingSeconds = field(dynamic, "chargingTimeInSeconds")?.toDoubleOrNull(),
                isChargingStop = chunk.contains("type=ChargingPoi") || chunk.contains("isChargingStation=true"),
                wasReached = field(chunk, "wasReached") == "true",
            )
        }
    }

    private fun field(text: String, key: String): String? =
        Regex("\\b$key=([^,)]*)").find(text)?.groupValues?.get(1)?.takeIf { it != "null" && it.isNotEmpty() }

    companion object {
        private const val TAG = "NaviGuidanceReader"
        private const val NAVI_PACKAGE = "technology.cariad.navi.oi.skoda"
        // The navi logs route parameters about once per second while guidance is active.
        private const val GUIDANCE_TIMEOUT_MS = 30_000L
        private val LAT_RE = Regex("latitude=(-?\\d+(?:\\.\\d+)?)")
        private val LON_RE = Regex("longitude=(-?\\d+(?:\\.\\d+)?)")
        private val POI_NAME_RE = Regex("poiName=([^,)]*)")
        private val LOCATION_STRINGS_RE = Regex("locationStrings=\\((.*?)\\), requestedChargingTimeSeconds")
        private val SOC_WH_RE = Regex("\"vehicleStateOfChargeInWh\":\\s*(\\d+)")

        fun isPermitted(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_LOGS) == PackageManager.PERMISSION_GRANTED
    }
}
