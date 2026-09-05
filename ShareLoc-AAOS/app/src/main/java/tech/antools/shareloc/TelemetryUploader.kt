package tech.antools.shareloc

import android.content.Context
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.min

class TelemetryUploader(context: Context) {
    private val appContext = context.applicationContext
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val latestPending = AtomicReference<TelemetryPayload?>(null)
    private val inFlight = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    private var retryDelaySeconds = 1L

    private val endpoint = BuildConfig.API_BASE_URL.trimEnd('/') + "/api/v1/position"
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    fun enqueue(payload: TelemetryPayload) {
        if (closed.get()) return
        latestPending.set(payload)
        pump()
    }

    fun shutdown() {
        closed.set(true)
        latestPending.set(null)
        client.dispatcher.cancelAll()
        scheduler.shutdownNow()
    }

    private fun pump() {
        if (closed.get() || !inFlight.compareAndSet(false, true)) return
        val payload = latestPending.getAndSet(null)
        if (payload == null) {
            inFlight.set(false)
            return
        }

        if (BuildConfig.UPLOAD_TOKEN.startsWith("CHANGE_ME")) {
            inFlight.set(false)
            TrackingStateStore.setError(appContext, appContext.getString(R.string.configuration_missing))
            return
        }

        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer ${BuildConfig.UPLOAD_TOKEN}")
            .post(payload.toJson().toRequestBody(mediaType))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                latestPending.compareAndSet(null, payload)
                TrackingStateStore.setError(appContext, "Server unavailable: ${e.message ?: "network error"}")
                scheduleRetry()
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        retryDelaySeconds = 1L
                        TrackingStateStore.setUploadSuccess(appContext)
                        inFlight.set(false)
                        pump()
                    } else {
                        latestPending.compareAndSet(null, payload)
                        TrackingStateStore.setError(appContext, "Server rejected update: HTTP ${it.code}")
                        retryDelaySeconds = if (it.code in 400..499) 15L else retryDelaySeconds
                        scheduleRetry()
                    }
                }
            }
        })
    }

    private fun scheduleRetry() {
        inFlight.set(false)
        if (closed.get()) return
        val delay = retryDelaySeconds
        retryDelaySeconds = min(retryDelaySeconds * 2, 15L)
        scheduler.schedule({ pump() }, delay, TimeUnit.SECONDS)
    }
}
