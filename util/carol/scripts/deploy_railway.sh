#!/usr/bin/env bash
# Deploy da Carol no Railway usando um PROJECT TOKEN.
# Uso: RAILWAY_TOKEN=xxxx ./scripts/deploy_railway.sh
# Rodar de dentro de util/carol/. Lê segredos do .env local e do .env da raiz
# do repositório sem exibi-los.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${RAILWAY_TOKEN:-}" ]; then
  echo "Defina RAILWAY_TOKEN (project token do Railway)." >&2
  exit 1
fi

pegar() { # pegar ARQUIVO CHAVE
  grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

RAIZ_ENV="../../.env"
LOCAL_ENV=".env"

ANTHROPIC_API_KEY=$(pegar "$RAIZ_ENV" ANTHROPIC_API_KEY)
META_SYSTEM_USER_TOKEN=$(pegar "$RAIZ_ENV" META_SYSTEM_USER_TOKEN)
META_APP_SECRET=$(pegar "$RAIZ_ENV" META_APP_SECRET)
WA_PHONE_NUMBER_ID=$(pegar "$LOCAL_ENV" WA_PHONE_NUMBER_ID)
WA_VERIFY_TOKEN=$(pegar "$LOCAL_ENV" WA_VERIFY_TOKEN)
WA_BUSINESS_NUMBER=$(pegar "$LOCAL_ENV" WA_BUSINESS_NUMBER)

for v in ANTHROPIC_API_KEY META_SYSTEM_USER_TOKEN META_APP_SECRET WA_PHONE_NUMBER_ID WA_VERIFY_TOKEN; do
  if [ -z "${!v}" ]; then echo "Variável $v não encontrada nos .env" >&2; exit 1; fi
done

echo "== Configurando variáveis no Railway (valores não exibidos)"
npx -y @railway/cli variables \
  --set "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
  --set "WA_PHONE_NUMBER_ID=$WA_PHONE_NUMBER_ID" \
  --set "WA_ACCESS_TOKEN=$META_SYSTEM_USER_TOKEN" \
  --set "WA_VERIFY_TOKEN=$WA_VERIFY_TOKEN" \
  --set "META_APP_SECRET=$META_APP_SECRET" \
  --set "WA_BUSINESS_NUMBER=${WA_BUSINESS_NUMBER:-5541984151085}" \
  --set "GRAPH_VERSION=v21.0" \
  --skip-deploys

echo "== Subindo o código (railway up)"
npx -y @railway/cli up --detach

echo "== Gerando/obtendo domínio público"
npx -y @railway/cli domain || true

echo "== Pronto. Teste: curl https://SEU-DOMINIO/health"
