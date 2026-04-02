# Deployment Notes

## Nginx

Use [deploy/nginx/kjorebok.nguyenchu.com.conf](/home/nguyen/dev/kjorebok/deploy/nginx/kjorebok.nguyenchu.com.conf) as the site config for:

- `https://kjorebok.nguyenchu.com` -> web app on `127.0.0.1:3021`
- `https://kjorebok.nguyenchu.com/api` -> API on `127.0.0.1:3020/api`
- `https://kjorebok.nguyenchu.com/api/health` -> API health endpoint
- `https://kjorebok.nguyenchu.com/download/android.apk` -> static Android APK from `/var/www/kjorebok-downloads/android.apk`

Expected app processes:

- web: `PORT=3021 pnpm --filter @kjorebok/web start`
- api: `API_PREFIX=/api pnpm --filter @kjorebok/api start`

Typical Ubuntu steps:

```bash
sudo cp deploy/nginx/kjorebok.nguyenchu.com.conf /etc/nginx/sites-available/kjorebok.nguyenchu.com
sudo ln -s /etc/nginx/sites-available/kjorebok.nguyenchu.com /etc/nginx/sites-enabled/kjorebok.nguyenchu.com
sudo nginx -t
sudo systemctl reload nginx
```

## Systemd

This repo also includes example unit files for keeping the app up after reboot:

- `deploy/systemd/kjorebok-api.service`
- `deploy/systemd/kjorebok-web.service`

Suggested install steps:

```bash
sudo mkdir -p /etc/kjorebok
sudo cp deploy/systemd/kjorebok-api.service /etc/systemd/system/
sudo cp deploy/systemd/kjorebok-web.service /etc/systemd/system/

# Put secrets and runtime config here
sudoedit /etc/kjorebok/api.env
sudoedit /etc/kjorebok/web.env

sudo systemctl daemon-reload
sudo systemctl enable --now kjorebok-api
sudo systemctl enable --now kjorebok-web
```

Example `/etc/kjorebok/api.env`:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=replace-me
```

Example `/etc/kjorebok/web.env`:

```bash
NEXT_PUBLIC_API_URL=https://kjorebok.nguyenchu.com/api
NEXT_PUBLIC_ANDROID_DOWNLOAD_URL=https://kjorebok.nguyenchu.com/download/android.apk
```

To publish an APK for download:

```bash
sudo mkdir -p /var/www/kjorebok-downloads
sudo cp /path/to/your.apk /var/www/kjorebok-downloads/android.apk
sudo chmod 644 /var/www/kjorebok-downloads/android.apk
```

## Deploy Script

For repeat deploys, you can run:

```bash
bash deploy/deploy.sh
```

The script will:

- pull the latest code
- install dependencies
- regenerate Prisma client
- build API and web
- copy nginx and systemd files into place
- reload nginx and restart the app services
- run quick local and public health checks

It will stop early if either of these files is missing:

- `/etc/kjorebok/api.env`
- `/etc/kjorebok/web.env`

It also stops if `git status --short` is not clean, so deploy does not accidentally run on top of local uncommitted changes.

## GitHub Actions

This repo includes a production deploy workflow at
[`/.github/workflows/deploy.yml`](/Users/nguyen/dev/kjorebok/.github/workflows/deploy.yml).

It runs on pushes to `main` and on manual dispatch. The workflow:

- installs dependencies
- generates Prisma client
- builds API and web
- SSHes into the server
- runs `bash deploy/deploy.sh`

Required GitHub Actions secrets:

- `DEPLOY_HOST`: server hostname
- `DEPLOY_USER`: SSH username
- `DEPLOY_PATH`: absolute repo path on the server, for example `/home/nguyen/dev/kjorebok`
- `DEPLOY_SSH_KEY`: private SSH key with access to the deploy target

The deploy target must already have:

- the repo cloned at `DEPLOY_PATH`
- Node.js available, or a local runtime in `.tools/`
- `/etc/kjorebok/api.env`
- `/etc/kjorebok/web.env`
- sudo rights for nginx/systemd actions used by `deploy/deploy.sh`
