# Releases

The release workflow builds Chrome, Firefox, and source ZIP packages and publishes
 them to a GitHub release with SHA-256 checksums. It does not upload or publish to
 the Chrome Web Store and does not require Chrome Store credentials or a signing key.

## Manual Chrome Web Store submission

1. Update `package.json` to a version higher than the current store version.
2. Push to `main`, or run the release workflow manually.
3. Download `chatgpt-backup-<version>-chrome.zip` from the GitHub release
   or the workflow artifacts.
4. Open the existing extension in the Chrome Web Store Developer Dashboard.
5. Upload the Chrome ZIP, review the changes, and submit it for review.

Alternatively, run `pnpm install --frozen-lockfile`, `pnpm compile`, and `pnpm zip`
locally and upload the Chrome ZIP from `.output/`.

The workflow skips versions that already have a GitHub release. Failed builds do
not create a GitHub release.

Unused `CHROME_*` publishing secrets can be removed from GitHub repository settings.
Keep any existing private signing key backed up securely; do not commit it.
