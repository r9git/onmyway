package tech.antools.shareloc

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import tech.antools.shareloc.databinding.ActivityMainBinding
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val qrExecutor = Executors.newSingleThreadExecutor()
    private var qrGeneratedFor: String? = null

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = renderState()
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val fineGranted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fineGranted) startSharingService()
        else Toast.makeText(this, R.string.location_permission_required, Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnShareLocation.setOnClickListener { requestPermissionsAndStart() }
        binding.btnStopSharing.setOnClickListener { stopSharingService() }
        binding.btnSms.setOnClickListener { shareBySms() }
        binding.btnShareApp.setOnClickListener { shareWithApp() }
        binding.btnCopy.setOnClickListener { copyLink() }
        binding.btnOpenLink.setOnClickListener { openTrackingLink() }

        binding.trackingLinkText.text = BuildConfig.PUBLIC_SHARE_URL
        renderState()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            statusReceiver,
            IntentFilter(TrackingStateStore.ACTION_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        renderState()
    }

    override fun onStop() {
        unregisterReceiver(statusReceiver)
        super.onStop()
    }

    override fun onDestroy() {
        qrExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun requestPermissionsAndStart() {
        if (!configurationLooksValid()) {
            Toast.makeText(this, R.string.configuration_missing, Toast.LENGTH_LONG).show()
            return
        }
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed += Manifest.permission.ACCESS_FINE_LOCATION
            needed += Manifest.permission.ACCESS_COARSE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (needed.isEmpty()) startSharingService() else permissionLauncher.launch(needed.toTypedArray())
    }

    private fun startSharingService() {
        TrackingStateStore.setTracking(this, true, getString(R.string.status_starting))
        ContextCompat.startForegroundService(
            this,
            Intent(this, VehicleTrackingService::class.java).setAction(VehicleTrackingService.ACTION_START),
        )
        showSharePanel()
        renderState()
    }

    private fun stopSharingService() {
        startService(Intent(this, VehicleTrackingService::class.java).setAction(VehicleTrackingService.ACTION_STOP))
        TrackingStateStore.setTracking(this, false, getString(R.string.status_off_detail))
        renderState()
    }

    private fun renderState() {
        val state = TrackingStateStore.read(this)
        binding.btnShareLocation.isEnabled = !state.tracking
        binding.btnStopSharing.isEnabled = state.tracking
        binding.sharePanel.visibility = if (state.tracking) View.VISIBLE else View.GONE

        when {
            state.error -> {
                binding.statusDot.background = drawable(R.drawable.bg_status_dot_error)
                binding.statusTitle.setText(R.string.status_error_title)
                binding.statusSubtitle.text = state.statusMessage ?: getString(R.string.status_off_detail)
            }
            state.tracking && state.lastUploadAt != null -> {
                binding.statusDot.background = drawable(R.drawable.bg_status_dot_live)
                binding.statusTitle.setText(R.string.status_live)
                binding.statusSubtitle.text = state.statusMessage ?: "Connected to server"
            }
            state.tracking -> {
                binding.statusDot.background = drawable(R.drawable.bg_status_dot_live)
                binding.statusTitle.setText(R.string.status_starting)
                binding.statusSubtitle.text = state.statusMessage ?: getString(R.string.status_waiting)
            }
            else -> {
                binding.statusDot.background = drawable(R.drawable.bg_status_dot_off)
                binding.statusTitle.setText(R.string.status_off)
                binding.statusSubtitle.setText(R.string.status_off_detail)
            }
        }

        binding.valueLatitude.text = state.latitude?.let { String.format(Locale.US, "%.7f", it) } ?: getString(R.string.not_available)
        binding.valueLongitude.text = state.longitude?.let { String.format(Locale.US, "%.7f", it) } ?: getString(R.string.not_available)
        binding.valueSpeed.text = state.speedKmh?.let { String.format(Locale.US, "%.1f km/h", it) } ?: getString(R.string.not_available)
        binding.valueAccuracy.text = state.accuracyMeters?.let { String.format(Locale.US, "± %.1f m", it) } ?: getString(R.string.not_available)
        binding.valueSource.text = state.source ?: getString(R.string.not_available)
        binding.valueLastUpload.text = state.lastUploadAt?.let {
            DateFormat.getTimeInstance(DateFormat.MEDIUM).format(Date(it))
        } ?: getString(R.string.not_available)

        if (state.tracking) showSharePanel()
    }

    private fun showSharePanel() {
        binding.sharePanel.visibility = View.VISIBLE
        val url = BuildConfig.PUBLIC_SHARE_URL
        binding.trackingLinkText.text = url
        if (qrGeneratedFor == url) return
        qrGeneratedFor = url
        qrExecutor.execute {
            runCatching { QrCodeGenerator.create(url) }
                .onSuccess { bitmap -> runOnUiThread { binding.qrImage.setImageBitmap(bitmap) } }
                .onFailure { error -> runOnUiThread { binding.statusSubtitle.text = error.message } }
        }
    }

    private fun shareBySms() {
        val message = shareMessage()
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("smsto:")
            putExtra("sms_body", message)
        }
        launchOrFallback(intent) { shareWithApp() }
    }

    private fun shareWithApp() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, getString(R.string.app_name))
            putExtra(Intent.EXTRA_TEXT, shareMessage())
        }
        try {
            startActivity(Intent.createChooser(intent, getString(R.string.share_location)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.no_app_available, Toast.LENGTH_SHORT).show()
        }
    }

    private fun copyLink() {
        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.tracking_link), BuildConfig.PUBLIC_SHARE_URL))
        Toast.makeText(this, R.string.link_copied, Toast.LENGTH_SHORT).show()
    }

    private fun openTrackingLink() {
        launchOrFallback(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.PUBLIC_SHARE_URL))) {
            Toast.makeText(this, R.string.no_app_available, Toast.LENGTH_SHORT).show()
        }
    }

    private fun launchOrFallback(intent: Intent, fallback: () -> Unit) {
        try {
            if (intent.resolveActivity(packageManager) != null) startActivity(intent) else fallback()
        } catch (_: ActivityNotFoundException) {
            fallback()
        }
    }

    private fun shareMessage(): String = getString(R.string.share_message, BuildConfig.PUBLIC_SHARE_URL)

    private fun configurationLooksValid(): Boolean =
        !BuildConfig.UPLOAD_TOKEN.startsWith("CHANGE_ME") &&
            !BuildConfig.PUBLIC_SHARE_URL.contains("CHANGE_ME") &&
            BuildConfig.API_BASE_URL.startsWith("http")

    private fun drawable(id: Int): Drawable? = ContextCompat.getDrawable(this, id)
}
