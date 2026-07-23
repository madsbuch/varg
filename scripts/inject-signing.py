#!/usr/bin/env python3
"""Inject a release signingConfig into a Tauri-generated Android build.gradle.kts.

Usage: python3 scripts/inject-signing.py src-tauri/gen/android/app/build.gradle.kts

Idempotent: running twice is a no-op. Reads signing values at build time from
`keystore.properties` in the Gradle root (written by the CI workflow).
"""
import re
import sys

SIGNING_BLOCK = """
    signingConfigs {
        create("release") {
            val props = Properties()
            val propsFile = rootProject.file("keystore.properties")
            if (propsFile.exists()) {
                props.load(FileInputStream(propsFile))
                keyAlias = props["keyAlias"] as String?
                keyPassword = props["password"] as String?
                storeFile = (props["storeFile"] as String?)?.let { file(it) }
                storePassword = props["storePassword"] as String?
            }
        }
    }
"""

WIRE = '            signingConfig = signingConfigs.getByName("release")\n'


def main() -> int:
    path = sys.argv[1]
    with open(path) as fh:
        src = fh.read()

    if "signingConfigs" not in src:
        # The Tauri template already imports Properties/FileInputStream for
        # its tauri.properties handling — only add what's missing, since
        # duplicate imports are a hard error in Kotlin scripts.
        imports = ""
        if "import java.io.FileInputStream" not in src:
            imports += "import java.io.FileInputStream\n"
        if "import java.util.Properties" not in src:
            imports += "import java.util.Properties\n"
        src = imports + src
        src = re.sub(r"(android\s*\{\s*\n)", r"\1" + SIGNING_BLOCK, src, count=1)

    if 'signingConfig = signingConfigs.getByName("release")' not in src:
        src = re.sub(
            r'(getByName\("release"\)\s*\{\s*\n)',
            r"\1" + WIRE,
            src,
            count=1,
        )

    with open(path, "w") as fh:
        fh.write(src)
    print(f"Patched {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
