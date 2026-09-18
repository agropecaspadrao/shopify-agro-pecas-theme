#!/usr/bin/env bash
# Ajusta o fim do horário comercial da Carol no Railway (CAROL_HORA_FIM).
# Enquanto o relógio de Brasília estiver antes dessa hora (seg-sex), a Carol
# fica em silêncio no WhatsApp e deixa o atendimento para a Dai.
# Uso: ./scripts/horario_railway.sh 20   (pausa até as 20h)
#      ./scripts/horario_railway.sh 18   (volta ao padrão)
# Lê RAILWAY_TOKEN do .env da raiz do repositório, como o deploy_railway.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
HORA="${1:?informe a hora de fim (ex.: 20)}"
if [ -z "${RAILWAY_TOKEN:-}" ]; then
  RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' ../../.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  export RAILWAY_TOKEN
fi
[ -n "$RAILWAY_TOKEN" ] || { echo "RAILWAY_TOKEN não encontrado" >&2; exit 1; }
SERVICO="shopify-agro-pecas-theme"
echo "== CAROL_HORA_FIM=$HORA no serviço $SERVICO (dispara redeploy)"
npx -y @railway/cli variables --service "$SERVICO" --set "CAROL_HORA_FIM=$HORA"
echo "== Feito. Confira em ~2 min: curl https://shopify-agro-pecas-theme-production.up.railway.app/health"
