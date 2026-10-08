"""Cliente mínimo da Shopify Admin GraphQL API.

Autenticação: usa SHOPIFY_ADMIN_TOKEN (shpat_...) se existir; caso contrário
obtém um token via grant client_credentials usando SHOPIFY_CLIENT_ID/SECRET
do app customizado (mesmo esquema dos utils antigos).
"""
from __future__ import annotations

import time
import requests

import config

_TOKEN_CACHE: str | None = None


class ShopifyError(RuntimeError):
    pass


def _endpoint() -> str:
    return f"https://{config.SHOPIFY_STORE}/admin/api/{config.SHOPIFY_API_VERSION}/graphql.json"


def _get_token() -> str:
    global _TOKEN_CACHE
    if config.SHOPIFY_ADMIN_TOKEN:
        return config.SHOPIFY_ADMIN_TOKEN
    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    config.require("SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET")
    resp = requests.post(
        f"https://{config.SHOPIFY_STORE}/admin/oauth/access_token",
        json={
            "client_id": config.SHOPIFY_CLIENT_ID,
            "client_secret": config.SHOPIFY_CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise ShopifyError(
            f"Falha no client_credentials ({resp.status_code}): {resp.text[:300]}\n"
            "Verifique SHOPIFY_CLIENT_ID/SECRET e se o app tem os scopes necessários."
        )
    _TOKEN_CACHE = resp.json()["access_token"]
    return _TOKEN_CACHE


def gql(query: str, variables: dict | None = None) -> dict:
    """Executa uma operação GraphQL e devolve data, tratando throttling."""
    headers = {
        "X-Shopify-Access-Token": _get_token(),
        "Content-Type": "application/json",
    }
    for attempt in range(6):
        resp = requests.post(_endpoint(), json={"query": query, "variables": variables or {}}, headers=headers, timeout=60)
        if resp.status_code == 429:
            time.sleep(2 * (attempt + 1))
            continue
        resp.raise_for_status()
        body = resp.json()
        if body.get("errors"):
            # THROTTLED vem em errors[].extensions.code
            if any(e.get("extensions", {}).get("code") == "THROTTLED" for e in body["errors"]):
                time.sleep(2 * (attempt + 1))
                continue
            raise ShopifyError(str(body["errors"]))
        return body["data"]
    raise ShopifyError("Throttled: excedidas as tentativas")
