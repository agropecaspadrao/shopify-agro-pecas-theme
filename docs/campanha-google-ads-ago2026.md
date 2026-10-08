# Google Ads — Setup Campanhas Agosto/2026
**Conta:** 348-313-0791 · **Verba:** Search R$15/dia + Shopping R$10/dia
**Meta da conta:** leads WhatsApp (`generate_lead`) e compras (`purchase`) importados do GA4 (propriedade 534365705)

---

## 0. Pré-requisitos (uma vez só)

1. **Ferramentas → Conversões → Nova conversão → Importar → GA4**: importar `generate_lead` e `purchase`.
   - `generate_lead` = conversão PRINCIPAL (otimização). `purchase` = secundária (observação).
   - Excluir/remover a conversão "Compra (carregamento da página)" criada em 23/07.
2. **Vincular Merchant Center** (Ferramentas → Contas vinculadas) — necessário para Shopping.
3. Confirmar que APENAS a conta 348-313-0791 fica vinculada ao GA4 (desvincular 597-554-4384 se não for usada).

## 1. Campanha SEARCH — "APP | Search | Sensores+GPS+Kits" (R$15/dia)

- Tipo: Pesquisa · Meta: Leads · Lances: **Maximizar conversões** (sem tCPA nas primeiras 3 semanas)
- Redes: SOMENTE Pesquisa Google (desmarcar Display e parceiros)
- Localização: Rio Grande do Sul, Santa Catarina, Paraná, Mato Grosso, Mato Grosso do Sul, São Paulo (estado) **com exclusão de São Paulo capital + região metropolitana**
- Opção de local: "Presença: pessoas em ou regularmente em" (não "interesse")
- Idioma: Português

### Grupo 1 — GPS e Monitores (foco valor agregado)
```
"gps agricola"
"gps agricola para trator"
"barra de luz gps agricola"
"gps agricola preço"
"monitor de plantio"
"monitor de fluxo de sementes"
[gps agricola gr200]
[monitor gr500]
"navegação agrícola trator"
```

### Grupo 2 — Sensores Precision Planting / plantio
```
"sensor de semente plantadeira"
"sensor de fluxo plantadeira"
"sensor pm400"
"precision planting pm400"
"sensor de levante plantadeira"
"sensor plantadeira john deere"
```

### Grupo 3 — Kits e peças de desgaste (colheita)
```
"dedo retratil john deere"
[dedo retratil h-169914]
[dedo retratil h-102724]
"dedo retratil colheitadeira"
"dedo recolhedor algodão"
[kk31823] [kk31824] [kk31825]
"kit dedo retratil"
"peças plataforma de corte john deere"
```

### Grupo 4 — Part numbers AGCO/plantadeira (exata, CPC baixo)
```
[acx363311b] [acx363311c] [acx3601860] [acx2414460] [acx3266690]
[acw0551840] [acx2865730] [acx5458940] [7038105m1] [7038106m1]
"peças plantadeira momentum"
"copo venturi plantadeira"
```

### Anúncio responsivo (todos os grupos — ajustar título 1 por grupo)
- Títulos: `Sensores e GPS Agrícola` · `Padrão Original OEM` · `Cotação Rápida no WhatsApp` · `Pronta Entrega p/ Todo o Sul` · `Kits com Preço de Atacado` · `Fornecedores Certificados ISO` · `Peça pelo Código da Peça` · `GPS GR200 com Barra de Luz`
- Descrições: `Peças no padrão original para plantadeiras e colheitadeiras. Fale no WhatsApp e receba cotação na hora.` · `Compatível com John Deere, Massey, Valtra e Stara. Envio imediato para RS, SC, PR, MT, MS e SP.`
- URL final: página do produto/coleção correspondente (NÃO a home)

### Negativas (nível campanha)
```
usado, usada, mercado livre, olx, manual, pdf, curso, como fazer,
gratis, download, vaga, emprego, salário, revenda, franquia
```

## 2. Campanha SHOPPING — "APP | Shopping | Catálogo" (R$10/dia)

- Tipo: **Shopping padrão** (não PMax por enquanto — controle de busca/negativas)
- Prioridade: média · Lances: CPC manual otimizado R$1,00 inicial → migrar p/ Maximizar cliques na semana 2
- Mesma geografia da Search
- Subdividir grupos de produtos por **tipo de produto**: Sensores/GPS > Kits > Bombas > demais
- Pré-requisito: produtos aprovados no Merchant Center (rodar o Diagnóstico antes; produtos sem foto ficarão reprovados — ok)

## 3. Rotina de otimização (20 min, 2x por semana)

1. Termos de pesquisa da Search → negativar lixo, promover termos bons a exata.
2. CPL por grupo: pausar grupo com CPL > R$80 após 30 cliques sem lead.
3. Shopping: excluir produtos com gasto > R$15 sem clique em lead.
4. Semana 3+: se ≥15 conversões/mês, ativar tCPA = CPL médio × 1,2.
