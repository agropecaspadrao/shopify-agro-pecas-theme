// Boot da Carol: sobe o HTTP PRIMEIRO (o /health responde em segundos e o
// healthcheck do Railway passa) e só depois, em segundo plano, faz o que é
// lento: catálogo, palavra-chave inicial (e-mail), migrações da memória e
// recuperação da agenda (que pode rodar relatórios atrasados com IA).
// Nada disso pode impedir o servidor de atender.

import { config, validarConfig, recursosConfigurados } from './config.js';
import { carolAtende } from './horarioConfig.js';
import { carregarCatalogo, estadoCatalogo } from './catalogo.js';
import { enviarRelatorio } from './relatorio.js';
import { reportarAnomalia } from './alertas/anomalias.js';
import { agendarSupervisor } from './saude/supervisor.js';
import { rotacionarEEnviar, precisaRotacionar } from './comandos/chave.js';
import { enviarRelatorioSocios } from './relatorios/socios.js';
import * as agenda from './agenda.js';
import { memoria } from './memoria/index.js';
import { registrarServidorHttp } from './admin/maquina.js';
import { criarApp } from './app.js';

function avisosDeConfiguracao() {
  const faltando = validarConfig({ exigirWhatsApp: false });
  if (faltando.length) console.warn('[config] variáveis ausentes:', faltando.join(', '));
  if (!config.waPhoneNumberId || !config.waVerifyToken) {
    console.warn('[config] WhatsApp não configurado por completo (WA_PHONE_NUMBER_ID / WA_VERIFY_TOKEN). O widget do site funciona mesmo assim.');
  }
  if (config.waPhoneNumberId && !config.metaAppSecret) {
    console.error('[config] META_APP_SECRET ausente com WhatsApp configurado — o webhook rejeitará TODAS as entregas (fail-closed). Configure a variável no Railway.');
  }
  if (!process.env.SDR_SYNC_KEY && process.env.SDR_SYNC_URL) console.warn('[config] SDR_SYNC_KEY ausente: o espelho usa CAROL_ADMIN_KEY (transição). Configure SDR_SYNC_KEY igual na Carol e no SDR.');
  const r = recursosConfigurados();
  if (!r.emailHttp) console.warn('[config] nenhum provedor de e-mail HTTP (GOOGLE_SERVICE_ACCOUNT_JSON+GMAIL_SENDER, RESEND_API_KEY ou BREVO_API_KEY). No Railway o SMTP é bloqueado: e-mails NÃO vão sair; relatórios caem para o WhatsApp dos admins e a palavra-chave só pelo painel.');
  if (!r.admins) console.warn('[config] CAROL_ADMINS vazio: comandos /carol desativados e alertas por WhatsApp sem destinatário.');
  if (!r.tokenReservaWhatsApp) console.warn('[config] WA_ACCESS_TOKEN_FALLBACK vazio: sem auto-recovery de token do WhatsApp.');
  console.log(`[config] recursos: e-mail HTTP=${r.emailHttp} admins=${r.admins} tokenReserva=${r.tokenReservaWhatsApp} metaAds=${r.metaAds} googleAds=${r.googleAds} masterDrive=${r.masterDrive}`);
}

/** Rotinas automáticas (horários em Brasília). Registradas antes do listen para /admin/agenda listar. */
export function registrarTarefas() {
  agenda.registrarTarefa({ nome: 'relatorio_dai', descricao: 'Resumo operacional das últimas 24h para a Dai', quando: { hora: config.agenda.relatorioDaiHora, minuto: 0 }, executar: enviarRelatorio });
  agenda.registrarTarefa({ nome: 'relatorio_socios', descricao: 'Relatório executivo diário para os sócios', quando: { hora: config.agenda.relatorioSociosHora, minuto: config.agenda.relatorioSociosMinuto }, executar: enviarRelatorioSocios });
  agenda.registrarTarefa({
    nome: 'chave_semanal',
    descricao: 'Rotação da palavra-chave dos comandos, enviada por e-mail',
    quando: { diaSemana: config.agenda.chaveDiaSemana, hora: config.agenda.chaveHora, minuto: config.agenda.chaveMinuto },
    executar: async () => `enviada para ${(await rotacionarEEnviar()).enviadaPara.join(', ')}`,
  });
  // Memória de conversa: limpeza diária às 3h (fecha episódios pendentes antes
  // de apagar a memória expirada; episódios > 7 dias, fichas > 180 dias sem
  // contato, sessões de teste e registro JSONL > 90 dias)
  agenda.registrarTarefa({ nome: 'memoria_limpeza', descricao: 'Limpeza da memória de conversa e do registro antigo', quando: { hora: 3, minuto: 0 }, executar: async () => (await memoria.limpar()).resumo });
  // Catálogo da loja: 3x ao dia (a maior pausa é 18h→6h, por isso o aviso de saúde só após 13h)
  for (const hora of [6, 12, 18]) {
    agenda.registrarTarefa({
      nome: `catalogo_${String(hora).padStart(2, '0')}h`,
      descricao: `Recarga do catálogo da loja (${hora}h)`,
      quando: { hora, minuto: 0 },
      executar: async () => {
        await carregarCatalogo({ forcar: true });
        return `catálogo recarregado: ${estadoCatalogo().produtos} produtos`;
      },
    });
  }
}

/** Tudo que é lento, depois do listen. Cada passo isolado: falha de um não impede os outros. */
export async function tarefasEmSegundoPlano(estado) {
  try {
    await carregarCatalogo();
  } catch (e) {
    console.error('[catalogo] falha na carga inicial:', e.message);
    reportarAnomalia({ tipo: 'catalogo_falha', detalhe: `Carga inicial falhou: ${e.message}` }).catch(() => {});
  }
  // Memória: migrações do Postgres (falha não impede nada: fica no modo local)
  // e o job que fecha episódios de conversas ociosas a cada 10 min.
  await memoria.iniciar().catch((e) => console.error('[memoria] falha ao iniciar:', e.message));
  memoria.agendarFechamento();
  estado.pronto = true;

  // Primeira palavra-chave (ou expirada): gera e manda agora, sem esperar segunda-feira
  if (precisaRotacionar()) {
    try {
      const r = await rotacionarEEnviar();
      console.log(`[chave] palavra-chave inicial enviada por e-mail para ${r.enviadaPara.length} destinatário(s)`);
    } catch (e) {
      console.warn('[chave] não consegui enviar a palavra-chave inicial:', e.message);
    }
  }
  try {
    const recuperadas = await agenda.iniciar({ reportarAnomalia });
    if (recuperadas.length) console.warn(`[agenda] ${recuperadas.length} tarefa(s) recuperada(s) no boot`);
  } catch (e) {
    console.error('[agenda] falha ao iniciar:', e.message);
  }
  agendarSupervisor();
}

export function iniciarServico({ porta = config.port } = {}) {
  avisosDeConfiguracao();
  registrarTarefas();
  const { app, estado } = criarApp();
  const servidor = app.listen(porta, () => {
    console.log(`Carol no ar na porta ${porta} (Carol atende o WhatsApp agora: ${carolAtende()})`);
    // segundo plano: o healthcheck já responde enquanto isto roda
    setImmediate(() => tarefasEmSegundoPlano(estado).catch((e) => console.error('[boot] falha em segundo plano:', e.message)));
  });
  registrarServidorHttp(servidor);
  return servidor;
}
