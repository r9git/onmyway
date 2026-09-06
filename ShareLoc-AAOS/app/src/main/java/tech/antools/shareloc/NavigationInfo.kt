package tech.antools.shareloc

import org.json.JSONObject

data class NavigationPlace(
    val name: String?,
    val address: String?,
    val latitude: Double?,
    val longitude: Double?,
)

data class ChargingStop(
    val name: String?,
    val distanceMeters: Double?,
    val chargingSeconds: Double?,
    val latitude: Double?,
    val longitude: Double?,
)

/** Active route guidance as observed from the vehicle's navigation system. */
data class NavigationInfo(
    val destination: NavigationPlace?,
    val etaEpochMs: Long?,
    val remainingMeters: Double?,
    val remainingSeconds: Double?,
    val socPercent: Double?,
    val arrivalSocPercent: Double?,
    val chargingStop: ChargingStop?,
    val observedAtElapsedMs: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put(
            "destination",
            destination?.let {
                JSONObject().apply {
                    put("name", it.name ?: JSONObject.NULL)
                    put("address", it.address ?: JSONObject.NULL)
                    put("lat", it.latitude ?: JSONObject.NULL)
                    put("lon", it.longitude ?: JSONObject.NULL)
                }
            } ?: JSONObject.NULL,
        )
        put("etaEpochMs", etaEpochMs ?: JSONObject.NULL)
        put("remainingMeters", remainingMeters ?: JSONObject.NULL)
        put("remainingSeconds", remainingSeconds ?: JSONObject.NULL)
        put("socPercent", socPercent ?: JSONObject.NULL)
        put("arrivalSocPercent", arrivalSocPercent ?: JSONObject.NULL)
        put(
            "chargingStop",
            chargingStop?.let {
                JSONObject().apply {
                    put("name", it.name ?: JSONObject.NULL)
                    put("distanceMeters", it.distanceMeters ?: JSONObject.NULL)
                    put("chargingSeconds", it.chargingSeconds ?: JSONObject.NULL)
                    put("lat", it.latitude ?: JSONObject.NULL)
                    put("lon", it.longitude ?: JSONObject.NULL)
                }
            } ?: JSONObject.NULL,
        )
    }
}
