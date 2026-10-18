# Releases

The release workflow builds Chrome, Firefox, and source ZIP packages and publishes
 them to a GitHub release with SHA-256 checksums. It does not upload or publish to
 the Chrome Web Store and does not require Chrome Store credentials or a signing key.

## Manual Chrome Web Store submission

1. Update `package.json` to a version higher than the current store version.
2. Push to `main`, or run the release workflow manually.
3. For Verified CRX Uploads, run **Package signed Chrome CRX** in GitHub Actions
   with the existing release tag (for example `v0.1.5`). This signs the released
   Chrome ZIP using the existing `CHROME_CRX_PRIVATE_KEY` secret and attaches a
   `.crx` and its checksum to the GitHub release. No store API is called.
4. Download `chatgpt-backup-<version>-chrome.crx` from the GitHub release.
5. Open the existing extension in the Chrome Web Store Developer Dashboard,
   upload the signed CRX, review the changes, and submit it for review.

Items without Verified CRX Uploads can use the Chrome ZIP instead.

Alternatively, run `pnpm install --frozen-lockfile`, `pnpm compile`, and `pnpm zip`
locally and upload the Chrome ZIP from `.output/`.

The workflow skips versions that already have a GitHub release. Failed builds do
not create a GitHub release.

Keep `CHROME_CRX_PRIVATE_KEY` configured for the signing workflow. Other unused
Chrome Store API publishing secrets can be removed from GitHub repository settings.
Keep the existing private signing key backed up securely; do not commit it.
