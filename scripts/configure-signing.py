#!/usr/bin/env python3
"""Configure Android release signing only with the established Varg key.

Secrets stay in environment variables and private temporary files. Verify the
public certificate before writing Gradle properties; never generate a new key.
"""
import base64
import hashlib
import os
from pathlib import Path
import subprocess
import sys


def property_value(value: str) -> str:
    """Escape values for java.util.Properties, including whitespace/passwords."""
    return (value.replace("\\", "\\\\").replace("\n", "\\n")
            .replace("\r", "\\r").replace("\t", "\\t")
            .replace(" ", "\\ ").replace("=", "\\=").replace(":", "\\:"))


def main() -> None:
    required = ("ANDROID_KEY_BASE64", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD",
                "ANDROID_SIGNING_SHA256", "RUNNER_TEMP")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise ValueError("Missing required signing configuration: " + ", ".join(missing))

    keystore = Path(os.environ["RUNNER_TEMP"]) / "varg.keystore"
    os.umask(0o077)
    keystore.write_bytes(base64.b64decode(os.environ["ANDROID_KEY_BASE64"], validate=True))
    store_password = os.environ.get("ANDROID_KEYSTORE_PASSWORD") or os.environ["ANDROID_KEY_PASSWORD"]
    env = {**os.environ, "VARG_STORE_PASSWORD": store_password}
    certificate = subprocess.run(
        ["keytool", "-exportcert", "-keystore", str(keystore),
         "-alias", os.environ["ANDROID_KEY_ALIAS"], "-storepass:env", "VARG_STORE_PASSWORD"],
        env=env, capture_output=True, check=False,
    )
    if certificate.returncode:
        raise ValueError("Cannot read release certificate; check keystore, alias and password secrets.")
    fingerprint = hashlib.sha256(certificate.stdout).hexdigest()
    if fingerprint != os.environ["ANDROID_SIGNING_SHA256"]:
        raise ValueError("Signing certificate differs from the established Varg release key; refusing to build.")

    gradle = Path("src-tauri/gen/android")
    values = {
        "keyAlias": os.environ["ANDROID_KEY_ALIAS"],
        "password": os.environ["ANDROID_KEY_PASSWORD"],
        "storePassword": store_password,
        "storeFile": str(keystore),
    }
    (gradle / "keystore.properties").write_text(
        "".join(f"{name}={property_value(value)}\n" for name, value in values.items()), encoding="utf-8",
    )
    subprocess.run([sys.executable, "scripts/inject-signing.py", str(gradle / "app/build.gradle.kts")], check=True)
    print("Verified the existing Varg release signing certificate.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
