#!/bin/bash
# Atualiza os dados do dashboard (compute + push para a planilha nativa).
# Usado pelo cron (madrugada) e sob demanda:  ./atualizar.sh
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "==== $TS — atualizando dashboard ===="
/opt/homebrew/bin/python3 pipeline.py all
echo "==== $TS — fim ===="
