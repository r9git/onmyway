import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val shareLockProperties = Properties().apply {
    val file = rootProject.file("shareloc.properties")
    if (file.exists()) file.inputStream().use(::load)
}

fun configValue(name: String, defaultValue: String): String =
    (shareLockProperties.getProperty(name) ?: defaultValue)
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")

android {
    namespace = "tech.antools.shareloc"
    compileSdk = 35

    defaultConfig {
        applicationId = "tech.antools.shareloc"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0-demo"

        buildConfigField("String", "API_BASE_URL", "\"${configValue("apiBaseUrl", "http://10.0.2.2:8080")}\"")
        buildConfigField("String", "UPLOAD_TOKEN", "\"${configValue("uploadToken", "CHANGE_ME_UPLOAD_TOKEN")}\"")
        buildConfigField("String", "VEHICLE_ID", "\"${configValue("vehicleId", "IVI_001")}\"")
        buildConfigField("String", "PUBLIC_SHARE_URL", "\"${configValue("publicShareUrl", "http://10.0.2.2:8080/track/CHANGE_ME_SHARE_ID")}\"")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.zxing:core:3.5.3")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
