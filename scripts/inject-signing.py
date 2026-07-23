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

IMPORTS = "import java.io.FileInputStream\nimport java.util.Properties\n"
WIRE = '            signingConfig = signingConfigs.getByName("release")\n'


def main() -> int:
    path = sys.argv[1]
    with open(path) as fh:
        src = fh.read()

    if "signingConfigs" not in src:
        src = IMPORTS + src
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
