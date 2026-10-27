#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu EC2 server.
# Usage (on the server):  sudo bash setup-ec2.sh <domain> <email>
#   <domain>  e.g. 18-133-45-67.sslip.io  (your Elastic IP with dashes + .sslip.io), or your own domain
#   <email>   used by Let's Encrypt for certificate expiry notices
set -euo pipefail

DOMAIN="${1:?Give the domain, e.g. 18-133-45-67.sslip.io}"
EMAIL="${2:?Give an email address for certificate notices}"
SITE_DIR=/var/www/asl-translator
DEPLOY_USER="${SUDO_USER:-ubuntu}"

echo "==> Installing nginx, rsync and certbot"
apt-get update -y
apt-get install -y nginx rsync certbot python3-certbot-nginx

echo "==> Creating the website folder ($SITE_DIR), owned by $DEPLOY_USER so GitHub Actions can upload to it"
mkdir -p "$SITE_DIR"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$SITE_DIR"
if [ ! -f "$SITE_DIR/index.html" ]; then
  echo "<h1>ASL Translator – waiting for first deploy</h1>" > "$SITE_DIR/index.html"
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$SITE_DIR/index.html"
fi

echo "==> Configuring nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$(dirname "$0")/nginx.conf" > /etc/nginx/sites-available/asl-translator
ln -sf /etc/nginx/sites-available/asl-translator /etc/nginx/sites-enabled/asl-translator
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Getting a free HTTPS certificate (the camera only works on HTTPS)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "==> Done. Visit https://$DOMAIN"
