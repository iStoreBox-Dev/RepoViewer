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
