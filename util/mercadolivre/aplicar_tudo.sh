#!/bin/zsh
# Aplica no Mercado Livre, na ordem certa:
#   1) melhorias (categoria + ME2, atributos, descrição, fotos do site, título onde a API deixa)
#   2) preços pelo líquido = "Preço final site" (comissão já da categoria nova)
# Uso:  ./aplicar_tudo.sh            (tudo)
#       ./aplicar_tudo.sh CQ65827,A56254   (só esses SKUs)
set -e
cd "$(dirname "$0")"
ONLY=${1:+--only $1}
echo "== 1/2 melhorias =="; python3 ml_melhorar.py --apply $ONLY
echo; echo "== 2/2 preços (líquido = Preço final site) =="; python3 ml_precos.py --base final --apply $ONLY
echo; echo "Relatórios em relatorios/ (ml_melhorias_*_APLICADO.md e ml_precos_*_final.csv)"
