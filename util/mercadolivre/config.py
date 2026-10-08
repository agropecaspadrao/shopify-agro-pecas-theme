"""Carregamento de configuração compartilhado pelo pipeline Mercado Livre.

Lê o .env da RAIZ do projeto (dois níveis acima desta pasta) e tolera as
chaves do ML tanto na forma com hífen (ML-APP-ID) quanto underscore (ML_APP_ID),
porque o .env atual da loja usa hífen.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]          # raiz do repositório
HERE = Path(__file__).resolve().parent              # util/mercadolivre/
DATA_DIR = HERE / "data"
DATA_DIR.mkdir(exist_ok=True)

# Carrega .env da raiz e, se existir, um .env local (sobrescreve).
load_dotenv(ROOT / ".env")
load_dotenv(HERE / ".env", override=True)


def _get(*keys: str, default: str | None = None) -> str | None:
    """Primeira variável de ambiente não-vazia entre as alternativas."""
    for k in keys:
        v = os.getenv(k)
        if v not in (None, ""):
            return v
    return default


# --- Shopify ---
SHOPIFY_STORE = _get("SHOPIFY_STORE", "SHOPIFY_FLAG_STORE", default="agro-pecas-padrao-2.myshopify.com")
SHOPIFY_ADMIN_TOKEN = _get("SHOPIFY_ADMIN_TOKEN")
SHOPIFY_CLIENT_ID = _get("SHOPIFY_CLIENT_ID")
SHOPIFY_CLIENT_SECRET = _get("SHOPIFY_CLIENT_SECRET")
SHOPIFY_API_VERSION = _get("SHOPIFY_API_VERSION", default="2025-01")

# --- Mercado Livre ---
ML_APP_ID = _get("ML_APP_ID", "ML-APP-ID")
ML_KEY_SECRET = _get("ML_KEY_SECRET", "ML-KEY-SECRET")
ML_REDIRECT_URI = _get("ML_REDIRECT_URI", default="https://localhost:8765/callback")
ML_SITE = _get("ML_SITE", default="MLB")

# --- EAN ---
GS1_PREFIX = _get("GS1_PREFIX", default="")                    # global (GS1 Brasil) — se preenchido, vira GTIN no ML
INTERNAL_BARCODE_PREFIX = _get("INTERNAL_BARCODE_PREFIX", default="2906316")  # faixa restrita "2": uso interno
HAS_REAL_GTIN = bool(GS1_PREFIX)                                # só envia GTIN ao ML se houver prefixo global real
ACTIVE_BARCODE_PREFIX = GS1_PREFIX or INTERNAL_BARCODE_PREFIX

# Arquivos de trabalho
PRODUCTS_JSON = DATA_DIR / "produtos_shopify.json"
ML_CSV = DATA_DIR / "ml_produtos.csv"
EAN_MAP = DATA_DIR / "ean_map.csv"
ML_TOKENS = DATA_DIR / "ml_tokens.json"
PUBLISH_REPORT = DATA_DIR / "ml_publish_report.csv"


def require(*names: str) -> None:
    """Aborta com mensagem clara se alguma config obrigatória faltar."""
    missing = [n for n in names if not globals().get(n)]
    if missing:
        raise SystemExit(
            "Configuração ausente: " + ", ".join(missing) +
            f"\nPreencha no .env (modelo em {HERE/'.env.example'})."
        )
