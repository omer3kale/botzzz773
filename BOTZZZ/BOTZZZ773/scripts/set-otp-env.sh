#!/usr/bin/env bash
set -euo pipefail

if ! command -v netlify >/dev/null 2>&1; then
  echo "Error: Netlify CLI is not installed. Install it with 'npm install -g netlify-cli'." >&2
  exit 1
fi

SMTP_USER_DEFAULT="botzzz773@gmail.com"
ADMIN_EMAIL_DEFAULT="botzzz773@gmail.com"

read -rp "SMTP user email [${SMTP_USER_DEFAULT}]: " SMTP_USER_INPUT
test -n "${SMTP_USER_INPUT}" || SMTP_USER_INPUT="${SMTP_USER_DEFAULT}"

read -rp "Admin email for OTP [${ADMIN_EMAIL_DEFAULT}]: " ADMIN_EMAIL_INPUT
test -n "${ADMIN_EMAIL_INPUT}" || ADMIN_EMAIL_INPUT="${ADMIN_EMAIL_DEFAULT}"

if [ -z "${SMTP_PASS_INPUT:-}" ]; then
  read -rsp "Enter the 16-character Gmail App Password (no spaces): " SMTP_PASS_INPUT
  echo ""
fi

if [ -z "${SMTP_PASS_INPUT}" ]; then
  echo "Error: SMTP password cannot be empty." >&2
  exit 1
fi

cat <<EOF
Setting Netlify environment variables...
EOF

netlify env:set SMTP_USER "${SMTP_USER_INPUT}"
netlify env:set SMTP_PASS "${SMTP_PASS_INPUT}"
netlify env:set ADMIN_EMAIL "${ADMIN_EMAIL_INPUT}"
netlify env:set ADMIN_OTP_EMAIL "${ADMIN_EMAIL_INPUT}"
netlify env:set SMTP_HOST "smtp.gmail.com"
netlify env:set SMTP_PORT "587"

cat <<'DONE'
All variables have been queued on Netlify.
Redeploy your site to apply the new environment configuration.
DONE
