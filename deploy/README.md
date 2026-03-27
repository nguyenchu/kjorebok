# Deployment Notes

## Nginx

Use [deploy/nginx/kjorebok.nguyenchu.com.conf](/home/nguyen/dev/kjorebok/deploy/nginx/kjorebok.nguyenchu.com.conf) as the site config for:

- `https://kjorebok.nguyenchu.com` -> web app on `127.0.0.1:3002`
- `https://kjorebok.nguyenchu.com/api` -> API on `127.0.0.1:3001/api`
- `https://kjorebok.nguyenchu.com/api/health` -> API health endpoint

Expected app processes:

- web: `PORT=3002 pnpm --filter @kjorebok/web start`
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
