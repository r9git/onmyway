package tech.antools.shareloc

import org.junit.Assert.assertEquals
import org.junit.Test

class TelemetryPayloadTest {
    @Test
    fun jsonMatchesServerContract() {
        val payload = TelemetryPayload(
            vehicleId = "IVI_001",
            latitude = 50.4130567,
            longitude = 14.900155,
            speedKmh = 42.5,
            bearing = 182.9,
            accuracyMeters = 3.8,
            source = "android-location:gps",
            timestamp = 1785911234567,
        )
        val json = org.json.JSONObject(payload.toJson())
        assertEquals("IVI_001", json.getString("vehicleId"))
        assertEquals(50.4130567, json.getDouble("latitude"), 0.0)
        assertEquals(14.900155, json.getDouble("longitude"), 0.0)
        assertEquals(42.5, json.getDouble("speedKmh"), 0.0)
    }
}
