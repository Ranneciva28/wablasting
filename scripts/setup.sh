#!/usr/bin/env bash
# Ubuntu host installer. Does not alter websites, DNS, TLS, or remove Docker volumes.
set -euo pipefail
trap 'echo "Setup berhenti pada langkah yang error. Konfigurasi dan database tidak dihapus." >&2' ERR
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$(id -u)" -eq 0 ]; then
  elevated() { "$@"; }
else
  sudo -v
  elevated() { sudo "$@"; }
fi

. /etc/os-release
if [ "$ID" != ubuntu ]; then
  echo "Installer ini untuk Ubuntu. OS terdeteksi: $ID" >&2
  exit 1
fi

elevated apt-get update
elevated apt-get install -y ca-certificates curl python3

if ! command -v docker >/dev/null 2>&1; then
  # Install from Docker's official apt repository. Never auto-remove existing runtimes.
  if dpkg-query -W -f='${Status}' containerd 2>/dev/null | grep -q 'install ok installed'; then
    echo "containerd sudah ada. Installer tidak menggantinya otomatis agar layanan lain tetap aman." >&2
    exit 1
  fi
  elevated install -m 0755 -d /etc/apt/keyrings
  elevated curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  elevated chmod a+r /etc/apt/keyrings/docker.asc
  printf '%s\n' \
    'Types: deb' \
    'URIs: https://download.docker.com/linux/ubuntu' \
    "Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}" \
    'Components: stable' \
    "Architectures: $(dpkg --print-architecture)" \
    'Signed-By: /etc/apt/keyrings/docker.asc' \
    | elevated tee /etc/apt/sources.list.d/docker.sources >/dev/null
  elevated apt-get update
  elevated apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

if ! elevated docker compose version >/dev/null 2>&1; then
  if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    elevated apt-get install -y docker-compose-plugin
  elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    elevated apt-get install -y docker-compose-v2
  else
    echo "Docker sudah ada tetapi Compose v2 belum tersedia. Kirim pesan ini untuk penyesuaian instalasi." >&2
    exit 1
  fi
fi
if ! elevated docker info >/dev/null 2>&1; then
  elevated systemctl start docker
fi

# Preserve the project identity/volume name used by earlier default deployments.
project_name="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"
project_name="$(printf '%s' "$project_name" | tr '[:upper:]' '[:lower:]')"
if elevated docker volume inspect "${project_name}_app-data" >/dev/null 2>&1; then
  export WABLASTING_EXISTING_VOLUME=1
fi
python3 scripts/setup-env.py

elevated docker compose config --quiet
elevated docker compose up -d --build

ready=0
for attempt in $(seq 1 45); do
  if elevated docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  elevated docker compose ps
  elevated docker compose logs --tail=40 app
  echo "Aplikasi belum siap. Kirim output error di atas, bukan isi .env." >&2
  exit 1
fi

elevated docker compose exec -T app node scripts/preflight.js
printf '\nAplikasi siap. Pengaturan layanan dilanjutkan lewat browser.\n'
elevated docker compose exec -T app node scripts/setup-link.js
published_address="$(elevated docker compose port app 3000)"
printf 'Reverse proxy HTTPS subdomain diarahkan ke http://%s.\n' "$published_address"
printf 'DNS, SSL dan konfigurasi web server tidak diubah oleh installer.\n'
