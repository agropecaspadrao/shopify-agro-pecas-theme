import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Argumento --file e --out opcionais:
// node capturar_posts.mjs --file app_posts_campanha_v1.html --out posts_campanha_v1
const args = process.argv.slice(2);
const fileArg = args[indexOf('--file', args) + 1];
const outArg  = args[indexOf('--out',  args) + 1];
function indexOf(flag, arr) { const i = arr.indexOf(flag); return i === -1 ? arr.length - 1 : i; }

const HTML_FILE = path.join(__dirname, fileArg || 'app_posts_v3 (2).html');
const OUT_DIR   = path.join(__dirname, outArg  || 'posts_prontos');

// Mapa: grupo → frames em ordem  (52 posts total)
const POSTS = [
  // ── Carrossel (540×540 → 1080×1080 @2x)
  { group: 'g-carousel', frameIndex:  0, label: '01_carousel_capa',              size: 'sq' },
  { group: 'g-carousel', frameIndex:  1, label: '02_carousel_bomba_valtra',      size: 'sq' },
  { group: 'g-carousel', frameIndex:  2, label: '03_carousel_peca_agco',         size: 'sq' },
  { group: 'g-carousel', frameIndex:  3, label: '04_carousel_greco_gps',         size: 'sq' },
  { group: 'g-carousel', frameIndex:  4, label: '05_carousel_cta',               size: 'sq' },
  // ── Bombas Valtra (540×675 → 1080×1350 @2x)
  { group: 'g-bombas',   frameIndex:  0, label: '06_bomba_valtra_885_985',       size: 'pt' },
  { group: 'g-bombas',   frameIndex:  1, label: '07_bomba_valtra_880_980',       size: 'pt' },
  { group: 'g-bombas',   frameIndex:  2, label: '08_bomba_valtra_118_128',       size: 'pt' },
  { group: 'g-bombas',   frameIndex:  3, label: '09_bomba_valtra_62_68',         size: 'pt' },
  // ── Bombas New Holland
  { group: 'g-bombas',   frameIndex:  4, label: '10_bomba_nh_tb_ts',             size: 'pt' },
  { group: 'g-bombas',   frameIndex:  5, label: '11_bomba_nh_ts6000',            size: 'pt' },
  { group: 'g-bombas',   frameIndex:  6, label: '12_bomba_nh_5610_7810',         size: 'pt' },
  { group: 'g-bombas',   frameIndex:  7, label: '13_bomba_nh_t6',                size: 'pt' },
  { group: 'g-bombas',   frameIndex:  8, label: '14_bomba_nh_5600_7700',         size: 'pt' },
  { group: 'g-bombas',   frameIndex:  9, label: '15_bomba_nh_340_4630',          size: 'pt' },
  // ── Bombas Massey Ferguson
  { group: 'g-bombas',   frameIndex: 10, label: '16_bomba_mf_4215_4255',         size: 'pt' },
  { group: 'g-bombas',   frameIndex: 11, label: '17_bomba_mf_4299',              size: 'pt' },
  { group: 'g-bombas',   frameIndex: 12, label: '18_bomba_mf_3050_6190',         size: 'pt' },
  { group: 'g-bombas',   frameIndex: 13, label: '19_bomba_mf_direcao_362',       size: 'pt' },
  { group: 'g-bombas',   frameIndex: 14, label: '20_bomba_mf_296_299',           size: 'pt' },
  { group: 'g-bombas',   frameIndex: 15, label: '21_bomba_mf_bh160_dupla',       size: 'pt' },
  // ── Bombas John Deere
  { group: 'g-bombas',   frameIndex: 16, label: '22_bomba_jd_6000_6620',         size: 'pt' },
  { group: 'g-bombas',   frameIndex: 17, label: '23_bomba_jd_5210_6000',         size: 'pt' },
  { group: 'g-bombas',   frameIndex: 18, label: '24_bomba_jd_colhedeira',        size: 'pt' },
  // ── Peças com Padrão Original - OEM
  { group: 'g-pecas',    frameIndex:  0, label: '25_peca_reservatorio',          size: 'pt' },
  { group: 'g-pecas',    frameIndex:  1, label: '26_peca_suporte_dosador',       size: 'pt' },
  { group: 'g-pecas',    frameIndex:  2, label: '27_peca_condutor_reto',         size: 'pt' },
  { group: 'g-pecas',    frameIndex:  3, label: '28_peca_condutor_sensor',       size: 'pt' },
  { group: 'g-pecas',    frameIndex:  4, label: '29_peca_acoplamento_condutor',  size: 'pt' },
  { group: 'g-pecas',    frameIndex:  5, label: '30_peca_acoplamento_curva',     size: 'pt' },
  { group: 'g-pecas',    frameIndex:  6, label: '31_peca_bocal_vacuo',           size: 'pt' },
  { group: 'g-pecas',    frameIndex:  7, label: '32_peca_adaptador_vacuo',       size: 'pt' },
  { group: 'g-pecas',    frameIndex:  8, label: '33_peca_venturi_b',             size: 'pt' },
  { group: 'g-pecas',    frameIndex:  9, label: '34_peca_venturi_c',             size: 'pt' },
  { group: 'g-pecas',    frameIndex: 10, label: '35_peca_srm',                   size: 'pt' },
  { group: 'g-pecas',    frameIndex: 11, label: '36_peca_defletor',              size: 'pt' },
  // ── Greco Agro Tech
  { group: 'g-greco',    frameIndex:  0, label: '37_greco_gps_gr200',            size: 'pt' },
  { group: 'g-greco',    frameIndex:  1, label: '38_greco_monitor_gr500',        size: 'pt' },
  { group: 'g-greco',    frameIndex:  2, label: '39_greco_sensor_fluxo_254',     size: 'pt' },
  { group: 'g-greco',    frameIndex:  3, label: '40_greco_sensor_fluxo_32',      size: 'pt' },
  { group: 'g-greco',    frameIndex:  4, label: '41_greco_levante_haste',        size: 'pt' },
  { group: 'g-greco',    frameIndex:  5, label: '42_greco_levante_corrente',     size: 'pt' },
  { group: 'g-greco',    frameIndex:  6, label: '43_greco_iluminacao',           size: 'pt' },
  { group: 'g-greco',    frameIndex:  7, label: '44_greco_ponta_cerca',          size: 'pt' },
  // ── Sensores Agral
  { group: 'g-sensores', frameIndex:  0, label: '45_sensor_sflx2',              size: 'pt' },
  { group: 'g-sensores', frameIndex:  1, label: '46_sensor_pul2',               size: 'pt' },
  // ── Stories (405×720 → 810×1440 @2x)
  { group: 'g-stories',  frameIndex:  0, label: '47_story_lancamento',          size: 'st' },
  { group: 'g-stories',  frameIndex:  1, label: '48_story_bombas',              size: 'st' },
  { group: 'g-stories',  frameIndex:  2, label: '49_story_pecas_oem',           size: 'st' },
  { group: 'g-stories',  frameIndex:  3, label: '50_story_greco',               size: 'st' },
  { group: 'g-stories',  frameIndex:  4, label: '51_story_sensores',            size: 'st' },
  { group: 'g-stories',  frameIndex:  5, label: '52_story_cta_whatsapp',        size: 'st' },
];

// Dimensões CSS dos frames
const SIZES = {
  sq: { w: 540, h: 540  },  // feed quadrado  → 1080×1080
  pt: { w: 540, h: 675  },  // feed retrato   → 1080×1350
  st: { w: 405, h: 720  },  // story          → 810×1440
};

import { mkdirSync } from 'fs';
mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();

  // Escala 2× para resolução Instagram (pixel-perfect)
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1200, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`file://${HTML_FILE}`, { waitUntil: 'networkidle' });

  // Aguarda Google Fonts carregar (ou timeout de 3s)
  await page.waitForTimeout(2500);

  let currentGroup = null;

  for (const post of POSTS) {
    // Ativar o grupo correto (remove .on de todos, adiciona no correto)
    if (post.group !== currentGroup) {
      await page.evaluate((gid) => {
        document.querySelectorAll('.grp').forEach(g => g.classList.remove('on'));
        document.getElementById(gid)?.classList.add('on');
      }, post.group);
      await page.waitForTimeout(300);
      currentGroup = post.group;
    }

    // Pegar o frame pelo índice dentro do grupo ativo
    const frames = await page.$$(`#${post.group} .f`);
    const frame = frames[post.frameIndex];
    if (!frame) {
      console.warn(`⚠  Frame não encontrado: ${post.label} (índice ${post.frameIndex}, total ${frames.length})`);
      continue;
    }

    // Scroll para o frame ficar visível
    await frame.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    const outPath = path.join(OUT_DIR, `${post.label}.png`);
    await frame.screenshot({ path: outPath, omitBackground: false });

    const bb = await frame.boundingBox();
    console.log(`✅ ${post.label}.png  (${Math.round(bb.width * 2)}×${Math.round(bb.height * 2)} px)`);
  }

  await browser.close();
  console.log(`\n🎉 Imagens salvas em: ${OUT_DIR}`);
})();
