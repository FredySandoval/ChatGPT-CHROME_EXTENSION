"""Upload a signed CRX and submit it using Chrome Web Store API v2.

Docs: https://developer.chrome.com/docs/webstore/using-api
CRX headers: https://developer.chrome.com/docs/webstore/update
"""
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API = "https://chromewebstore.googleapis.com"


def request_json(method, url, *, headers=None, data=None):
    request = Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=120) as response:
            return json.load(response)
    except HTTPError as error:
        # Keep API diagnostics, but never log request headers or OAuth credentials.
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {body}") from None


def publish(env=os.environ, request=request_json, sleep=time.sleep):
    required = (
        "CHROME_CLIENT_ID", "CHROME_CLIENT_SECRET", "CHROME_REFRESH_TOKEN",
        "CHROME_PUBLISHER_ID", "CHROME_EXTENSION_ID", "VERSION",
    )
    for name in required:
        if not env.get(name):
            raise ValueError(f"Missing required configuration: {name}")
    publisher = env["CHROME_PUBLISHER_ID"]
    item = env["CHROME_EXTENSION_ID"]
    version = env["VERSION"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", publisher):
        raise ValueError("Invalid CHROME_PUBLISHER_ID")
    if not re.fullmatch(r"[a-p]{32}", item):
        raise ValueError("Invalid CHROME_EXTENSION_ID")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", version):
        raise ValueError("VERSION must be a numeric Chrome extension version")

    package = Path(f"release-assets/chatgpt-backup-{version}-chrome.crx")
    content = package.read_bytes()
    if content[:4] != b"Cr24":
        raise ValueError("Package does not have a CRX header")

    credentials = urlencode({
        "client_id": env["CHROME_CLIENT_ID"],
        "client_secret": env["CHROME_CLIENT_SECRET"],
        "refresh_token": env["CHROME_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode()
    token = request("POST", "https://oauth2.googleapis.com/token",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data=credentials).get("access_token")
    if not isinstance(token, str) or not token or "\n" in token or "\r" in token:
        raise RuntimeError("OAuth response did not contain a valid access token")
    if env.get("GITHUB_ACTIONS") == "true":
        print(f"::add-mask::{token}", flush=True)
    headers = {"Authorization": f"Bearer {token}"}
    resource = f"publishers/{publisher}/items/{item}"
    url = f"{API}/v2/{resource}"

    # Never replace an active review or accidentally publish a staged submission.
    status = request("GET", f"{url}:fetchStatus", headers=headers)
    submitted = status.get("submittedItemRevisionStatus", {})
    if submitted.get("state") in ("PENDING_REVIEW", "STAGED"):
        raise RuntimeError("An existing submission is pending review or staged; check the dashboard")
    published = status.get("publishedItemRevisionStatus", {})
    if any(channel.get("crxVersion") == version
           for channel in published.get("distributionChannels", [])):
        raise RuntimeError(f"Version {version} is already published; no upload attempted")

    response = request("POST", f"{API}/upload/v2/{resource}:upload", headers={
        **headers,
        "Content-Type": "application/x-chrome-extension",
        "X-Goog-Upload-Protocol": "raw",
        "X-Goog-Upload-File-Name": package.name,
    }, data=content)
    print(json.dumps(response, indent=2))
    if response.get("crxVersion") not in (None, version):
        raise RuntimeError("Uploaded manifest version does not match VERSION")
    state = response.get("uploadState")
    # v2's discovery schema uses IN_PROGRESS, SUCCEEDED, FAILED (not v1 SUCCESS).
    for _ in range(60):
        if state != "IN_PROGRESS":
            break
        sleep(10)
        response = request("GET", f"{url}:fetchStatus", headers=headers)
        print(json.dumps(response, indent=2))
        state = response.get("lastAsyncUploadState")
    if state != "SUCCEEDED":
        raise RuntimeError(f"Upload did not succeed (state: {state}); publication not attempted")

    response = request("POST", f"{url}:publish", headers={
        **headers, "Content-Type": "application/json",
    }, data=json.dumps({"publishType": "DEFAULT_PUBLISH", "skipReview": False}).encode())
    print(json.dumps(response, indent=2))
    if response.get("state") not in ("PENDING_REVIEW", "PUBLISHED", "PUBLISHED_TO_TESTERS"):
        raise RuntimeError(f"Unexpected publication state: {response.get('state')}")
    print("Chrome Web Store submission accepted. Approval/publication may still be pending.")


if __name__ == "__main__":
    try:
        publish()
    except Exception as error:
        print(f"Chrome Web Store submission failed: {error}", file=sys.stderr)
        sys.exit(1)
