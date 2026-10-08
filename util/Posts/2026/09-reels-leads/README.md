# Reels de anúncio (set/2026) — gerador

`build_reel.py` monta vídeos 1080x1920 a partir das fotos de produto do Shopify (capa v2 + foto 3D + desenho técnico),
com títulos em Barlow Condensed, zoom lento, transição e a trilha `app_uteis/comercial_app_veo3/music/track_default.mp3`.

Uso: baixe as imagens para `src/`, baixe as fontes Barlow (Google Fonts) para `fonts/` e rode
`python3 build_reel.py specs/*.json`. Os specs desta pasta geraram os 6 Reels publicados em 15/09/2026.

Os MP4 finais estão no Shopify Files (Admin → Conteúdo → Arquivos, alt "Reel … — anúncio Meta set/2026") e na biblioteca
de vídeos da conta de anúncios Meta 1582242153905208.

Regra de marca: os vídeos antigos de `comercial_app_veo3/` NÃO podem ser usados em anúncio — trazem "original", "Livenza ISO" e "Greco Agro Tech".
