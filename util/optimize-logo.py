#!/usr/bin/env python3
"""
Gera variantes do logo APP Agro Peças Padrão otimizadas para cada pixel ratio
e faz push para todos os temas Shopify via CLI.

Uso:
    python3 util/optimize-logo.py

Requer: Pillow  →  pip3 install Pillow
"""

import subprocess
import sys
import shutil
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("❌  Pillow não instalado. Rode: pip3 install Pillow")
    sys.exit(1)

# ── Configuração ─────────────────────────────────────────────────────────────

THEME_DIR   = Path(__file__).parent.parent
ASSETS_DIR  = THEME_DIR / "assets"
SOURCE_FILE = ASSETS_DIR / "APP - LOGO - SEM FUNDO V3.png"

# Largura exibida no CSS por breakpoint
CSS_WIDTH_DESKTOP = 160   # px
CSS_WIDTH_TABLET  = 140   # px
CSS_WIDTH_MOBILE  = 110   # px

# Pixel ratios a cobrir (iPhone Pro = 3×, iPad = 2×, desktop = 1×)
MAX_RATIO = 3

# Largura final recomendada: mobile × max_ratio com folga
TARGET_WIDTH = 640   # px  (110 × 3 = 330 mínimo; 640 cobre com folga + desktop 2×)

OUTPUT_FILE = ASSETS_DIR / "APP - LOGO - SEM FUNDO V3.png"  # substitui no lugar

# Arquivos de logo alternativos que devem receber a mesma versão otimizada
LOGO_ALIASES = [
    ASSETS_DIR / "APP - LOGO - SEM FUNDO V3.png",
]

# ── Processamento ─────────────────────────────────────────────────────────────

def optimize(src: Path, target_width: int) -> Image.Image:
    img = Image.open(src).convert("RGBA")
    orig_w, orig_h = img.size

    # Proporção original
    ratio = orig_h / orig_w
    target_height = round(target_width * ratio)

    print(f"  Original : {orig_w} × {orig_h} px")
    print(f"  Destino  : {target_width} × {target_height} px  ({target_width / CSS_WIDTH_MOBILE:.1f}× mobile / {target_width / CSS_WIDTH_DESKTOP:.1f}× desktop)")

    # Lanczos = melhor qualidade para downscale
    resized = img.resize((target_width, target_height), Image.LANCZOS)
    return resized


def save_png(img: Image.Image, dest: Path):
    # optimize=True + compress_level=9 → menor arquivo sem perda
    img.save(dest, format="PNG", optimize=True, compress_level=9)
    size_kb = dest.stat().st_size / 1024
    print(f"  Salvo    : {dest.name}  ({size_kb:.0f} KB)")


def shopify_push(*files: Path):
    """Push apenas os arquivos de logo para o tema dev e live."""
    only_flags = []
    for f in files:
        only_flags += ["--only", f"assets/{f.name}"]

    themes = {
        "dev  (preview)": "183049257233",
        "live (produção)": "183046832401",
    }

    for label, theme_id in themes.items():
        print(f"\n  🚀  Enviando para {label} ...")
        cmd = ["shopify", "theme", "push", "--theme", theme_id] + only_flags
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=THEME_DIR)
        if result.returncode == 0:
            print(f"  ✅  {label} atualizado")
        else:
            # live theme pede confirmação interativa — instrui o usuário
            if "Failed to prompt" in result.stderr:
                cmd_str = " ".join(cmd)
                print(f"  ⚠️   Tema live requer confirmação interativa.")
                print(f"       Rode no terminal e confirme com 'y':")
                print(f"       {cmd_str}")
            else:
                print(f"  ❌  Erro:\n{result.stderr.strip()}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("\n🌿  APP Agro Peças Padrão — Otimizador de Logo\n")

    if not SOURCE_FILE.exists():
        print(f"❌  Arquivo não encontrado: {SOURCE_FILE}")
        sys.exit(1)

    # Backup do original
    backup = SOURCE_FILE.with_suffix(".orig.png")
    if not backup.exists():
        shutil.copy2(SOURCE_FILE, backup)
        print(f"  📦  Backup salvo em: {backup.name}\n")

    print(f"📐  Gerando versão otimizada ({TARGET_WIDTH}px) ...\n")
    img = optimize(SOURCE_FILE, TARGET_WIDTH)

    # Salva substituindo o arquivo original (é o que o header.liquid referencia)
    save_png(img, OUTPUT_FILE)

    # Resumo de cobertura
    print(f"\n📊  Cobertura de pixel ratio:")
    for device, ratio, css_w in [
        ("iPhone SE / 8",        2, CSS_WIDTH_MOBILE),
        ("iPhone 12-14",         3, CSS_WIDTH_MOBILE),
        ("iPhone 14 Pro Max",    3, CSS_WIDTH_MOBILE),
        ("iPad",                 2, CSS_WIDTH_TABLET),
        ("Desktop 1×",           1, CSS_WIDTH_DESKTOP),
        ("Desktop 2× (Retina)",  2, CSS_WIDTH_DESKTOP),
    ]:
        needed = css_w * ratio
        ok = "✅" if TARGET_WIDTH >= needed else "❌"
        print(f"  {ok}  {device:<22} {css_w}px CSS × {ratio}× = {needed}px  (temos {TARGET_WIDTH}px)")

    # Push para Shopify
    print(f"\n☁️   Enviando para Shopify ...")
    shopify_push(OUTPUT_FILE)

    print("\n✅  Concluído!\n")
    print("   Para aplicar no tema live, rode no terminal:")
    print(f"   shopify theme push --theme 183046832401 --only 'assets/APP - LOGO - SEM FUNDO V3.png'")
    print()


if __name__ == "__main__":
    main()
