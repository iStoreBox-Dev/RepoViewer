# RepoViewer — single-container repository browser

## Deploy in Dockhand
1. Create a Git repository containing the files in this folder (compose.yaml, Dockerfile, server.js, public/index.html).
2. In Dockhand, create a new stack from the Git repository with `compose.yaml` as the Compose path, then deploy/build it.
3. Open `http://YOUR-SERVER-IP:8088`.
4. (Optional) Point your reverse proxy to `http://YOUR-SERVER-IP:8088` and enable HTTPS.

Or on a Docker host: `docker compose up -d --build`.

One Node.js container, no database and no volumes. `8088` is the host port; change it in compose.yaml if needed.

Paste any public AltStore-compatible JSON URL to display the source's apps, description, screenshots (when provided), version history and download links.

The browser requests JSON through a small built-in server endpoint to avoid CORS. For safety, the endpoint denies private/internal addresses and restricts response size and redirects. Do not expose this as a general-purpose proxy.

Direct link: `https://your-domain.example/?repo=https%3A%2F%2Fexample.com%2Fapps.json`

Important: "Download IPA" is a download link; iOS may require a signing/sideloading tool. This app does not sign or install IPAs.

## Community features (v1.0.4)
- Shareable repository URLs with copy-link action.
- One-tap SideStore source links (requires SideStore on device).
- Category filters and name/release-date sorting.
- Both AltStore standard and iPhone/iPad screenshot metadata.
- Publisher-declared app entitlements and privacy explanations, with clear notice when metadata is missing.

No database or user accounts are required. The versioned Compose image tag ensures Dockhand deploys a new build when the source changes.

## iOS Toolkit (v1.6.0)

Open `/tools` for four utilities: a locally generated unsigned Web Clip `.mobileconfig`, an unsigned XML configuration-profile inspector, an AltStore repository JSON checker, and curated SSL/certificate resources. Tools operate in the browser. Signed CMS and binary plist inspection, certificate signing, and profile encryption are not implemented; do not describe them as supported.

The toolkit does not request private keys, collect uploaded profile files, or replace Apple's profile signing/trust verification. Use Dockhand to redeploy the `repoviewer:1.6.0` image from the latest `main` branch.

## React IPA Inspector (v1.7.0)

Open `/ipa` from the iOS Toolkit. React and Vite are built in the Docker multi-stage build, and the existing Node server hosts the generated page and assets in the **same single container**. No database, upload server, or persistent volume is added.

The inspector reads a user-selected IPA locally using JSZip, lists bundle files, identifies the embedded provisioning-file presence, and reads **XML** `Payload/*.app/Info.plist` metadata. Binary plist detection is displayed transparently; binary plist decoding, signing verification, entitlement validation and IPA editing are **not supported yet**. Large files may consume browser memory: there is a 1 GB input cap, 30,000-entry cap and 2 MB metadata-entry cap. Do not trust repository metadata as proof of a safe or valid signature.

## Developer Utilities (v1.8.0)

Open `/utilities` for React-based XML plist inspection, SHA-256 file hashing, OTA manifest creation, and a privacy manifest starter template. Files are processed locally in the browser. OTA manifests require separately signed IPA assets; generated metadata is not signing or an install guarantee. These tools do not verify signatures or malware.

## Unified React frontend (v2.0.0)

Routes `/` and `/tools` now use React from `app.html`; `/ipa` and `/utilities` keep their React entry files but share `src/Nav.jsx` and `src/shell.css`. Vite builds all three entries into `dist` in the Docker builder stage, and the Node server serves the compiled assets and retains the guarded `/api/repo` proxy. This deliberately keeps one Dockhand container and avoids exposing repository fetches directly to the browser.

The previous standalone HTML catalog/profile source files remain in `public/` temporarily for migration reference but are no longer used by their live routes. A local production build could not be executed from this environment because outbound GitHub/DNS access was unavailable; verify the Dockhand image build before deploying to production.

## App Store IPA Lab — Phase 1 (v2.1.0)

Visit `/appstore`. Paste an Apple App Store URL (example: `https://apps.apple.com/app/id6809781858`) or its numeric ID, select a storefront (Bahrain by default), then retrieve public app metadata. The React interface displays listing artwork, name, developer, bundle ID, version, minimum iOS, package size, App Store pricing/rating, description, release notes, screenshots and a link back to the official listing. Metadata fields may be absent or country-dependent.

The Node API route `/api/appstore/lookup?id=6809781858&country=bh` validates the numeric app ID and two-letter storefront, calls only Apple's `itunes.apple.com/lookup`, applies a 10-second timeout and 2 MB response limit, and returns an allowlisted metadata subset. No Apple ID credentials, IPA download or FairPlay decryption is involved. React assets are compiled by the existing multi-stage Docker build; the service remains one container on `proxy_net` for Dockhand.

Deployment acceptance checks: Docker build succeeds; `/health` shows `2.1.0`; `/appstore` loads; the example ID returns a real listing or a clear storefront-specific not-found message; invalid IDs return HTTP 400; navigation to and from the Lab works.

## App Store IPA Lab — download options (v2.2.0)

The `/appstore` page now offers the **official App Store listing**, a link to the local IPA Inspector, and **optional lookup in a user-supplied AltStore-compatible JSON repository**. Repository matching uses the App Store listing's `bundleId` and published `bundleIdentifier` fields; matching public `downloadURL` links are shown for user-initiated download. The repository is fetched through the existing SSRF-protected `/api/repo` endpoint. This is **not** a direct Apple App Store IPA download, FairPlay decryption, installation, or authenticity verification. A listing match does not establish that a third-party IPA is legitimate; users must independently verify its provenance and signing. No Apple ID credentials are requested. Docker remains one Dockhand-managed container.

## Local Apple IPA downloader companion (v2.3.0)

The `/appstore` Lab now generates app-specific ipatool commands for users who want to download Apple-hosted IPAs using their own authorized Apple accounts on their own computers. The linked third-party tool supports Linux, macOS and Windows. Apple login must happen outside RepoViewer using ipatool's interactive authentication; RepoViewer does not request, process or store Apple account credentials. The downloaded IPA can remain FairPlay-encrypted and account/device restricted: no decryption, re-signing or universal installation is implemented. RepoViewer's single Dockhand container does not run ipatool or receive its downloaded IPA automatically.

## Experimental operator-only App Store download jobs (v2.4.0)

A bounded backend integration exists at `POST /api/appstore/download` with JSON `{"id":"6809781858"}`, plus `GET /api/appstore/job?id=<job-uuid>`. Both endpoints require `X-Operator-Token` matching `APPSTORE_DOWNLOAD_TOKEN` (minimum 32 characters); timing-safe token comparison is used. `GET /api/appstore/worker` reports readiness without secrets. The worker is **disabled by default**, requiring `APPSTORE_DOWNLOAD_ENABLED=true`, a working `ipatool` binary on the container PATH, an already-authorized operator-specific ipatool home (`IPATOOL_HOME`), and a writable `IPA_DOWNLOAD_DIR`. This release does **not** install ipatool, configure Apple authentication, expose downloaded files, implement progress percentages, or decrypt FairPlay content. The in-memory job list and one-job-at-a-time restriction reset on container restart. Do not turn on the operator endpoint on a public site until credentials, persistent storage, authentication, runtime compatibility, and access controls are independently reviewed.

The existing single-container Dockhand configuration and proxy_net remain unchanged. No Apple ID credentials should be entered in the public React UI.
