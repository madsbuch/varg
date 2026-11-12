plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.varg.bike"
    // Matches the platform the release workflow installs.
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation(project(":tauri-android"))
    // MusicMixer is plain Kotlin: its rendering is tested on the JVM.
    testImplementation("junit:junit:4.13.2")
    // The real org.json, so the fixture test parses scores as the app does.
    testImplementation("org.json:json:20231013")
}

android {
    testOptions {
        // Android stubs return defaults instead of throwing; the tests use
        // only MusicMixer and MusicEngine.parse, with the real org.json.
        unitTests.isReturnDefaultValues = true
    }
}
