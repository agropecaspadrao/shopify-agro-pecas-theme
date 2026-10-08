"""OAuth 2.0 do Mercado Livre (com PKCE) + refresh automático de token.

Passo único (uma vez):
    python3 ml_auth.py
    -> abre/mostra a URL de autorização; você loga no ML, autoriza,
       e cola de volta a URL para a qual foi redirecionado (contém ?code=...).

Depois disso, os outros scripts chamam get_access_token() e o refresh é
automático (o access_token expira a cada 6h; o refresh_token rotaciona).

Pré-requisitos no painel do app (developers.mercadolivre.com.br):
  - Redirect URI cadastrada == ML_REDIRECT_URI do .env
  - Scopes: read, write, offline_access
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from urllib.parse import urlencode, urlparse, parse_qs

import requests

import config

AUTH_BASE = "https://auth.mercadolivre.com.br/authorization"
TOKEN_URL = "https://api.mercadolibre.com/oauth/token"


def _pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(os.urandom(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _save(tokens: dict) -> None:
    tokens["obtained_at"] = int(time.time())
    config.ML_TOKENS.write_text(json.dumps(tokens, indent=2), encoding="utf-8")


def load_tokens() -> dict | None:
    if config.ML_TOKENS.exists():
        return json.loads(config.ML_TOKENS.read_text(encoding="utf-8"))
    return None


def authorize() -> None:
    config.require("ML_APP_ID", "ML_KEY_SECRET", "ML_REDIRECT_URI")
    verifier, challenge = _pkce()
    params = {
        "response_type": "code",
        "client_id": config.ML_APP_ID,
        "redirect_uri": config.ML_REDIRECT_URI,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    url = f"{AUTH_BASE}?{urlencode(params)}"
    print("\n1) Abra esta URL no navegador e autorize:\n")
    print(url)
    print("\n2) Você será redirecionado para a Redirect URI com ?code=... na barra.")
    redirected = input("\nCole aqui a URL completa de redirecionamento (ou só o code): ").strip()

    code = redirected
    if "code=" in redirected:
        code = parse_qs(urlparse(redirected).query).get("code", [""])[0]

    resp = requests.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "client_id": config.ML_APP_ID,
        "client_secret": config.ML_KEY_SECRET,
        "code": code,
        "redirect_uri": config.ML_REDIRECT_URI,
        "code_verifier": verifier,
    }, timeout=30)
    if resp.status_code != 200:
        raise SystemExit(f"Falha ao trocar code por token: {resp.status_code} {resp.text}")
    _save(resp.json())
    print(f"\nOK! Tokens salvos em {config.ML_TOKENS}. user_id={resp.json().get('user_id')}")


def _refresh(tokens: dict) -> dict:
    resp = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "client_id": config.ML_APP_ID,
        "client_secret": config.ML_KEY_SECRET,
        "refresh_token": tokens["refresh_token"],
    }, timeout=30)
    if resp.status_code != 200:
        raise SystemExit(f"Falha no refresh: {resp.status_code} {resp.text}\nRode 'python3 ml_auth.py' de novo.")
    new = resp.json()
    _save(new)
    return new


def get_access_token() -> str:
    """Devolve um access_token válido, renovando se faltar < 5 min."""
    tokens = load_tokens()
    if not tokens:
        raise SystemExit("Sem tokens. Rode primeiro: python3 ml_auth.py")
    age = int(time.time()) - tokens.get("obtained_at", 0)
    if age >= tokens.get("expires_in", 21600) - 300:
        tokens = _refresh(tokens)
    return tokens["access_token"]


if __name__ == "__main__":
    authorize()
