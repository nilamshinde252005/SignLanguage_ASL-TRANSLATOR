# Deploying the ASL Translator to AWS EC2

The site is a static Next.js build, served by **nginx** on an **Ubuntu EC2** server with a free
**Let's Encrypt HTTPS certificate** (browsers only allow camera access on HTTPS).
After the one-time setup below, every push to `main` that passes the tests is deployed
automatically by the `deploy-ec2` job in `.github/workflows/ci-cd.yml`.

```
git push → GitHub Actions: lint + unit tests → next build → rsync over SSH → nginx on EC2 (HTTPS)
```

## 1. Launch the server (AWS Console → EC2 → Launch instance)

| Setting | Value |
|---|---|
| Name | `asl-translator` |
| Image | Ubuntu Server 24.04 LTS |
| Instance type | `t3.micro` or `t2.micro` (free-tier eligible) |
| Key pair | Create new → `asl-translator-key` (.pem) → download it and keep it safe |
| Security group | Allow **SSH (22)**, **HTTP (80)** and **HTTPS (443)** from anywhere. SSH must be open so GitHub Actions can deploy; Ubuntu on EC2 only accepts key logins, not passwords |
| Storage | 8 GB default is enough |

Then **EC2 → Elastic IPs → Allocate → Associate** it with the instance, so the address never changes.

Your free domain is the Elastic IP with dashes plus `.sslip.io`,
e.g. IP `18.133.45.67` → `18-133-45-67.sslip.io` (no sign-up needed). You can use your own domain instead
by pointing an A record at the Elastic IP.

## 2. Set up the server (once)

On your Mac:

```bash
chmod 400 ~/Downloads/asl-translator-key.pem
scp -i ~/Downloads/asl-translator-key.pem deploy/setup-ec2.sh deploy/nginx.conf ubuntu@18-133-45-67.sslip.io:~
ssh -i ~/Downloads/asl-translator-key.pem ubuntu@18-133-45-67.sslip.io
```

On the server:

```bash
sudo bash setup-ec2.sh 18-133-45-67.sslip.io you@example.com
```

This installs nginx + certbot, creates `/var/www/asl-translator`, and turns on HTTPS with automatic renewal.

## 3. Connect GitHub Actions (once)

GitHub repo → **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|---|---|---|
| Secret | `EC2_SSH_KEY` | the whole contents of `asl-translator-key.pem` |
| Variable | `EC2_HOST` | `18-133-45-67.sslip.io` |
| Variable | `EC2_USER` | `ubuntu` (optional – this is the default) |

## 4. Deploy

Push to `main` (or Actions → CI/CD → **Run workflow**). The `deploy-ec2` job builds the site,
uploads it with `rsync`, and checks the live URL responds. Open `https://18-133-45-67.sslip.io`.

## Costs and AWS Academy

- On a personal AWS account, a micro instance is covered by the free tier/credits for new accounts
  (check the current free tier terms). An Elastic IP attached to a running instance is cheap, but
  **stop or terminate the instance when you no longer need it** to avoid charges.
- In an **AWS Academy Learner Lab**, instances stop when the lab session ends and need restarting;
  keep the Elastic IP so the address (and the HTTPS certificate) stays valid.

## Troubleshooting

| Problem | Fix |
|---|---|
| `deploy-ec2` job skipped | The `EC2_HOST` variable is not set |
| `Permission denied (publickey)` | `EC2_SSH_KEY` must be the full .pem, including the BEGIN/END lines |
| SSH times out from GitHub | The security group must allow port 22 from anywhere (GitHub's servers change IP) |
| Camera blocked | The site must be opened with `https://` |
| certbot fails | Ports 80/443 must be open and the domain must point to the Elastic IP |
