#!/usr/bin/env bash
# Deploy da Carol no Railway usando um PROJECT TOKEN.
# Uso: RAILWAY_TOKEN=xxxx ./scripts/deploy_railway.sh
# Rodar de dentro de util/carol/.
#
# SEGREDOS NUNCA SÃO SOBRESCRITOS. O script só cria variáveis que AINDA NÃO
# existem no serviço (primeiro deploy). Antes ele copiava META_SYSTEM_USER_TOKEN
# do .env local para WA_ACCESS_TOKEN em todo deploy; o token local expirou em
# 04/09 e a Carol ficou muda. Agora:
#   - WA_ACCESS_TOKEN não é mais tocado pelo script: configure à mão no painel
#     do Railway com o token PERMANENTE do Usuário do Sistema (Meta Business).
#   - Para trocar um segredo que já existe, use o painel do Railway ou
#     `npx @railway/cli variables --service shopify-agro-pecas-theme --set CHAVE=valor`.
# Os valores nunca são exibidos.

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

# O serviço no Railway chama "shopify-agro-pecas-theme" e tem root directory
# util/carol: o `railway up` DEVE subir a partir da raiz do repositório, senão
# o builder não encontra util/carol dentro do pacote e o build falha na hora.
SERVICO="shopify-agro-pecas-theme"

echo "== Conferindo variáveis já existentes no Railway (só os nomes)"
if ! EXISTENTES=$(npx -y @railway/cli variables --service "$SERVICO" --json | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{console.log(Object.keys(JSON.parse(s)).join("\n"))}catch{process.exit(1)}})'); then
  echo "Não consegui listar as variáveis do serviço; por segurança nenhuma variável será alterada." >&2
  EXISTENTES="__falhou__"
fi

ARGS=()
definir_se_ausente() { # definir_se_ausente NOME VALOR
  local nome="$1" valor="$2"
  if [ "$EXISTENTES" = "__falhou__" ]; then return; fi
  if printf '%s\n' "$EXISTENTES" | grep -qx "$nome"; then
    echo "   $nome: já existe, mantido"
  elif [ -n "$valor" ]; then
    echo "   $nome: ausente, será criado"
    ARGS+=(--set "$nome=$valor")
  else
    echo "   $nome: ausente e sem valor no .env local (configure no painel do Railway)" >&2
  fi
}

definir_se_ausente ANTHROPIC_API_KEY "$(pegar "$RAIZ_ENV" ANTHROPIC_API_KEY)"
definir_se_ausente META_APP_SECRET "$(pegar "$RAIZ_ENV" META_APP_SECRET)"
definir_se_ausente WA_PHONE_NUMBER_ID "$(pegar "$LOCAL_ENV" WA_PHONE_NUMBER_ID)"
definir_se_ausente WA_VERIFY_TOKEN "$(pegar "$LOCAL_ENV" WA_VERIFY_TOKEN)"
definir_se_ausente WA_BUSINESS_NUMBER "$(pegar "$LOCAL_ENV" WA_BUSINESS_NUMBER)"
definir_se_ausente GRAPH_VERSION "v21.0"
if [ "$EXISTENTES" != "__falhou__" ] && ! printf '%s\n' "$EXISTENTES" | grep -qx WA_ACCESS_TOKEN; then
  echo "   ATENÇÃO: WA_ACCESS_TOKEN não existe no serviço. Configure à mão com o token permanente do Usuário do Sistema." >&2
fi

if [ ${#ARGS[@]} -gt 0 ]; then
  echo "== Criando variáveis ausentes (valores não exibidos)"
  npx -y @railway/cli variables --service "$SERVICO" "${ARGS[@]}" --skip-deploys
fi

echo "== Subindo o código (railway up, a partir da raiz do repositório)"
(cd ../.. && npx -y @railway/cli up --detach --service "$SERVICO")

echo "== Gerando/obtendo domínio público"
npx -y @railway/cli domain --service "$SERVICO" || true

echo "== Pronto. Teste: curl https://shopify-agro-pecas-theme-production.up.railway.app/health"
