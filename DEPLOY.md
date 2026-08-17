# Deploying SynapseJudge

Target: a single Ubuntu 22.04/24.04 EC2 instance behind Nginx with a Let's Encrypt
certificate, running the API and judge worker under PM2.

**Minimum instance:** `t3.small` (2 vCPU / 2 GB). A `t2.micro` will technically boot,
but MongoDB, Redis, Node and a C++ compile container do not fit in 1 GB — the judge
gets OOM-killed mid-contest. If you are stuck on 1 GB, add 2 GB of swap first
(step 1b).

---

## 0. Security group

Inbound rules on the EC2 instance:

| Port | Source | Why |
| --- | --- | --- |
| 22 | **your IP only** | SSH |
| 80 | 0.0.0.0/0 | HTTP, and Let's Encrypt's challenge |
| 443 | 0.0.0.0/0 | HTTPS |

Nothing else. In particular **27017 and 6379 must not be open** — `docker-compose.yml`
binds them to `127.0.0.1` for exactly this reason.

---

## 1. Host setup

```bash
sudo apt update && sudo apt upgrade -y

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # or log out and back in

# PM2
sudo npm install -g pm2
```

### 1b. Swap (only if the instance has 1 GB of RAM)

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 2. Get the code and configure

```bash
cd ~
git clone <your-repo-url> synapseJudge
cd synapseJudge

cp .env.production.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Edit `.env` and set, at minimum:

- `JWT_SECRET` — the string you just generated. **The server refuses to start in
  production without it, and `deploy.sh` refuses to deploy while it is the placeholder.**
- `CLIENT_ORIGIN` — your exact public origin, e.g. `https://synapsejudge.duckdns.org`.
  Scheme included. A mismatch here is the usual cause of "CORS blocked" after go-live.
- `SANDBOX_HOST_DIR` — absolute path, e.g. `/home/ubuntu/synapseJudge/.tmp-submissions`.
  It must be absolute: Docker cannot bind-mount a relative path.

---

## 3. Deploy

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh --seed      # --seed only on the first deploy
```

The script pulls, installs, starts Mongo and Redis, builds the three language runner
images, builds the client, restarts PM2 and health-checks the API. It is safe to
re-run; every step is idempotent.

First run takes ~5 minutes, most of it pulling the `gcc` and `python` base images.

Verify:

```bash
pm2 status                              # both processes online
curl -s localhost:4000/api/health       # {"ok":true,...}
docker ps                               # mongo + redis up
```

---

## 4. Nginx

```bash
sudo cp deploy/nginx/synapsejudge.conf /etc/nginx/sites-available/synapsejudge
sudo ln -sf /etc/nginx/sites-available/synapsejudge /etc/nginx/sites-enabled/synapsejudge
sudo rm -f /etc/nginx/sites-enabled/default
```

Edit the copied file and set `server_name` to your domain and `root` to the absolute
path of `client/dist` (default assumes `/home/ubuntu/synapseJudge`). Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The site should now answer on `http://<your-domain>`.

---

## 5. TLS

Point your DNS (or DuckDNS) record at the instance's public IP **first** — certbot
validates over HTTP and fails if the name does not already resolve here.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d synapsejudge.duckdns.org
```

Choose the redirect option when prompted. Certbot rewrites the Nginx config to add
the 443 listener and the HTTP→HTTPS redirect, and installs a renewal timer. Confirm
renewal works:

```bash
sudo certbot renew --dry-run
```

---

## 6. Survive a reboot

```bash
pm2 save
pm2 startup            # run the command it prints
```

Docker's `restart: unless-stopped` brings Mongo and Redis back on its own.

---

## 7. First-run admin

The seed creates `admin` / `admin12345`. **Change it immediately** — sign in, then
either register a new account and promote it from Admin → Users, or change the
password directly:

```bash
node -e "
const b=require('bcryptjs');
console.log(b.hashSync(process.argv[1],12));
" 'your-new-password'
# then update the passwordHash field for the admin user in mongosh
```

---

## Redeploying

```bash
cd ~/synapseJudge && ./deploy/deploy.sh
```

Omit `--seed` — re-seeding is idempotent but resets the seeded arenas' start times.

---

## Operating

```bash
pm2 logs synapsejudge-api          # HTTP log
pm2 logs synapsejudge-worker       # judging log, one line per verdict
pm2 monit                          # live CPU/memory
docker stats                       # what the judge containers are doing
sudo tail -f /var/log/nginx/synapsejudge.error.log
```

**Queue backed up?** `JUDGE_CONCURRENCY` is how many containers run at once.
Raise it only if `docker stats` shows headroom; the failure mode of setting it too
high is the API and Mongo starving, which looks like the whole site hanging.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` in worker logs | user not in `docker` group | `sudo usermod -aG docker $USER && newgrp docker`, then `pm2 restart all` |
| Every verdict is `internal_error` | runner images not built | `npm run runners:build` |
| Submissions stay `pending` forever | worker is down or Redis is unreachable | `pm2 status`, `docker ps`, `pm2 logs synapsejudge-worker` |
| CORS errors in the browser console | `CLIENT_ORIGIN` ≠ the origin actually loaded | fix `.env`, `pm2 restart all --update-env` |
| 502 from Nginx | API not listening on 4000 | `pm2 logs synapsejudge-api` |
| Blank page, 404 on `/assets/*.js` | Nginx `root` is not the real `client/dist` | correct the path, `sudo systemctl reload nginx` |
| Site works, refresh on `/problems/x` 404s | SPA fallback missing | keep the `try_files $uri $uri/ /index.html;` block |
| Judge OOM-killed | 1 GB instance | add swap (1b) or resize |

---

## Trust boundary

The judge worker talks to `/var/run/docker.sock`, which is root-equivalent on the
host. Everything the sandbox does — `--network none`, `--read-only`, `--cap-drop ALL`,
non-root uid, memory/PID/CPU ceilings — constrains the *submitted code*, not the
worker itself.

On this single-host layout the API and the worker share a machine, which is fine for
a demo and for a portfolio deployment. For anything with real users, run the worker
on a separate instance with no inbound access, so a container escape lands on a host
that holds no secrets and serves no traffic.
