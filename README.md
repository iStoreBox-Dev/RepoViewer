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
