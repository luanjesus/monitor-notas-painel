/* Monitor de Notas - painel (GitHub Pages + Supabase). Sem build: JavaScript puro. */
(() => {
'use strict';

const CFG = window.APP_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
const T = (n) => 'tb_app_mon_notas_' + n;
const BUCKET = 'app-mon-notas';
const GRUPOS_PRODUTO = ['A07','A08','A17','A27','A36','A37','A56','A57','S20','S23','S24 Ultra','S25','S25 FE','S25 Ultra','S26','S26 Ultra','G05','G06','G17','G35','G47','G53','G56','G67','G77','G86','Edge 60 Fusion','Edge 60 Neo','Edge 70 Fusion','iPhone 11','iPhone 15','iPhone 16','iPhone 16e','iPhone 17','iPhone 17 Pro Max','Oppo A6','Oppo A6K','Oppo A6 Pro','Oppo A6X','Oppo A60','Oppo Reno 14','Oppo Reno 14 F','Oppo Reno 16 F','Xiaomi 14T 5G','Poco X8','Poco X8 Pro Max','Redmi 15C','Redmi Note 13 Pro','Vivo Y31','TV','Variados'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Sao_Paulo';
// colunas da fila de revisão (sem o JSON completo da nota, que pesa e só é usado em arquivo local)
const COLS_REVISAO = 'id,msg_id,status,prioridade_revisao,nome,cpf,celular,loja_chave,grupo,vendedor_nome,enviado_em,origem,observacao_complementar,imagem_path,motivos_revisao,erro_mensagem,produto,tipo_documento,valor_total,texto_original,mlc_status,mlc_cliente_id,mlc_erro,mlc_extra,mlc_conferir';

const S = {
  user: null, lojas: [], vendedores: [], config: {}, status: null,
  revisao: [], selRev: null, notas: [], grupos: [], comandos: [], logs: []
};

// ---------- utilidades ----------
function toast(msg, erro = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (erro ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, erro ? 6000 : 2800);
}
const fmtHora = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const fmtDur = (s) => {
  if (s == null || isNaN(s)) return '–';
  s = Math.round(s); if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60; if (m < 60) return m + 'min' + (r ? ' ' + r + 's' : '');
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
};
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const inicioDia = (d) => new Date(d + 'T00:00:00-03:00').toISOString();
const fimDia = (d) => new Date(new Date(d + 'T00:00:00-03:00').getTime() + 86400000).toISOString();
const soDig = (s) => String(s || '').replace(/\D/g, '');
function fmtCpf(d) { d = soDig(d); return d.length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : (d || ''); }
function fmtCel(d) { d = soDig(d); if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`; return d; }
function cpfValido(c) {
  c = soDig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const [n, p] of [[9, 10], [10, 11]]) {
    let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (p - i);
    let r = 11 - (s % 11); if (r >= 10) r = 0; if (r !== +c[n]) return false;
  }
  return true;
}
const lojaNome = (k) => { const l = S.lojas.find(x => x.chave === k); return l ? `${l.rede === 'CASAS_BAHIA' ? 'Casas Bahia' : 'Magalu'} ${l.cidade}` : (k || '–'); };
const mediana = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const media = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const tag = (t) => `<span class="tag ${esc(t)}">${esc(String(t).replace('_HUMANA', '').replace('INTERMEDIARIA', 'MÉDIA'))}</span>`;
// situação do envio ao Minha Loja Conectada (coluna mlc_status; reaproveita as cores das etiquetas)
const ENVIO = { PENDENTE: ['REVISAO_HUMANA', 'Na fila'], ENVIANDO: ['REVISAO_HUMANA', 'Enviando'], CADASTRADO: ['SUCESSO', 'Cadastrado'], ERRO: ['ERRO', 'Falhou'] };
const tagEnvio = (n) => { const e = ENVIO[n.mlc_status]; return e ? `<span class="tag ${e[0]}" title="${esc(n.mlc_erro || '')}">${e[1]}${n.mlc_conferir ? ' · conferir' : ''}</span>` : '<span class="muted">–</span>'; };

// ---------- login ----------
// Link de recuperação de senha: o Supabase devolve a pessoa para esta página com "type=recovery" no endereço
let emRecuperacao = /type=recovery/.test(location.hash);

async function boot() {
  sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY') { emRecuperacao = true; mostrarNovaSenha(); }
    else if (ev === 'SIGNED_OUT' && !emRecuperacao) mostrarLogin();
  });
  // link vencido/inválido: o endereço volta com error_description
  if (/error_description|error_code/.test(location.hash)) {
    history.replaceState(null, '', location.pathname);
    mostrarLogin(); $('#login-erro').textContent = 'Este link expirou ou já foi usado. Use “Esqueci minha senha” para pedir outro.';
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (emRecuperacao) { if (session) mostrarNovaSenha(); else { emRecuperacao = false; mostrarLogin(); } return; }
  if (session) await entrarNoApp(session.user); else mostrarLogin();
}
function telaLogin(qual) {
  $('#tela-app').hidden = true; $('#tela-login').hidden = false;
  $('#form-login').hidden = qual !== 'login'; $('#form-reset').hidden = qual !== 'reset'; $('#form-nova-senha').hidden = qual !== 'nova';
}
function mostrarLogin() { telaLogin('login'); }
function mostrarNovaSenha() { telaLogin('nova'); $('#nova-senha').focus(); }

$('#btn-esqueci').addEventListener('click', () => {
  $('#reset-email').value = $('#login-email').value; $('#reset-msg').textContent = ''; telaLogin('reset'); $('#reset-email').focus();
});
$('#btn-voltar-login').addEventListener('click', mostrarLogin);
$('#form-reset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-enviar-reset'), msg = $('#reset-msg'); btn.disabled = true; msg.style.color = ''; msg.textContent = '';
  const { error } = await sb.auth.resetPasswordForEmail($('#reset-email').value.trim(), { redirectTo: location.origin + location.pathname });
  if (error && (error.status === 429 || /rate|seconds/i.test(error.message))) {
    msg.textContent = 'Muitos pedidos seguidos. Espere alguns minutos e tente de novo.';
    setTimeout(() => { btn.disabled = false; }, 30000);
    return;
  }
  // mesma resposta exista ou não o e-mail (não revela quem tem cadastro)
  msg.style.color = 'var(--ok)';
  msg.textContent = 'Se este e-mail tiver cadastro, o link chega em instantes. Veja também a caixa de spam.';
  setTimeout(() => { btn.disabled = false; }, 30000);
});
$('#form-nova-senha').addEventListener('submit', async (e) => {
  e.preventDefault(); const msg = $('#nova-msg'); msg.style.color = ''; msg.textContent = '';
  const a = $('#nova-senha').value, b = $('#nova-senha2').value;
  if (a.length < 8) { msg.textContent = 'Use pelo menos 8 caracteres.'; return; }
  if (a !== b) { msg.textContent = 'As duas senhas não são iguais.'; return; }
  const { data, error } = await sb.auth.updateUser({ password: a });
  if (error) { msg.textContent = /same|different/i.test(error.message) ? 'A nova senha precisa ser diferente da anterior.' : 'Não foi possível salvar: ' + error.message; return; }
  emRecuperacao = false; history.replaceState(null, '', location.pathname);
  toast('Senha alterada com sucesso');
  await entrarNoApp(data.user);
});

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#login-erro').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-senha').value });
  if (error) { $('#login-erro').textContent = 'E-mail ou senha incorretos.'; return; }
  await entrarNoApp(data.user);
});
$('#btn-sair').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function entrarNoApp(user) {
  S.user = user;
  // O banco só devolve dados para usuários autorizados (RLS). Linha de status vazia = sem permissão.
  const { data, error } = await sb.from(T('status')).select('*').eq('id', 1).maybeSingle();
  if (error || !data) {
    await sb.auth.signOut();
    mostrarLogin(); $('#login-erro').textContent = 'Este usuário não tem permissão para o painel (precisa ser ADMIN, GESTOR ou SUPER_ADMIN).';
    return;
  }
  S.status = data;
  S.superAdmin = await verificarSuperAdmin();   // só SUPER_ADMIN vê "Conta do WhatsApp"
  $('#tela-login').hidden = true; $('#tela-app').hidden = false;
  $('#txt-usuario').textContent = user.email;
  await Promise.all([carregarLojas(), carregarConfig(), carregarVendedores(), carregarGrupos(), carregarComandos(), carregarLogs()]);
  montarFiltros(); renderStatus(); renderExec(); renderGrupoCfg(); renderVendedores(); renderGrupos(); renderComandos(); renderLogs();
  await carregarRevisao(); await carregarNotas(); await carregarTempo();
  assinar();
  setInterval(() => { if (!document.hidden) renderStatus(); }, 5000);
  iniciarOciosidade();
}

// ---------- carga de dados ----------
async function carregarLojas() { const { data } = await sb.from(T('lojas')).select('*').order('chave'); S.lojas = data || []; }
async function carregarConfig() { const { data } = await sb.from(T('config')).select('*'); S.config = {}; (data || []).forEach(r => S.config[r.chave] = r.valor); }
async function carregarVendedores() { const { data } = await sb.from(T('vendedores')).select('*').order('nome'); S.vendedores = data || []; }
async function carregarGrupos() { const { data } = await sb.from(T('grupos')).select('*').order('msgs_no_teste', { ascending: false }).order('nome'); S.grupos = data || []; }
async function carregarComandos() { const { data } = await sb.from(T('comandos')).select('*').order('id', { ascending: false }).limit(6); S.comandos = data || []; }
async function carregarLogs() { const { data } = await sb.from(T('logs')).select('*').order('id', { ascending: false }).limit(150); S.logs = data || []; }
async function carregarRevisao() {
  const { data, error } = await sb.from(T('notas')).select(COLS_REVISAO).or('status.in.(REVISAO_HUMANA,ERRO),mlc_conferir.eq.true').order('enviado_em', { ascending: false }).limit(300);
  if (error) return toast('Erro ao carregar revisão: ' + error.message, true);
  const peso = { MAXIMA: 0, INTERMEDIARIA: 1, BAIXA: 2 };
  S.revisao = (data || []).sort((a, b) => (peso[a.prioridade_revisao] ?? 3) - (peso[b.prioridade_revisao] ?? 3) || (a.enviado_em < b.enviado_em ? 1 : -1));
  renderRevisao();
}

// ---------- realtime ----------
function assinar() {
  sb.channel('app-mon-notas')
    .on('postgres_changes', { event: '*', schema: 'public', table: T('notas') }, (p) => {
      const n = p.new && p.new.id ? p.new : null;
      if (n && (['REVISAO_HUMANA', 'ERRO'].includes(n.status) || n.mlc_conferir)) {
        const i = S.revisao.findIndex(x => x.id === n.id);
        if (i >= 0) S.revisao[i] = n; else { S.revisao.unshift(n); }
      } else if (n) S.revisao = S.revisao.filter(x => x.id !== n.id);
      if (p.eventType === 'DELETE' && p.old) S.revisao = S.revisao.filter(x => x.id !== p.old.id);
      renderRevisao(true);
      clearTimeout(assinar._t); assinar._t = setTimeout(() => { if (!document.hidden) { carregarNotas(); carregarTempo(); } }, 4000);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: T('status') }, (p) => { S.status = p.new; renderStatus(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: T('grupos') }, () => carregarGrupos().then(renderGrupos))
    .on('postgres_changes', { event: '*', schema: 'public', table: T('comandos') }, () => carregarComandos().then(renderComandos))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: T('logs') }, (p) => { S.logs.unshift(p.new); S.logs = S.logs.slice(0, 150); renderLogs(); })
    .subscribe();
}

// ---------- abas ----------
$('#abas').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-aba]'); if (!b) return;
  $$('#abas button').forEach(x => x.classList.toggle('ativa', x === b));
  $$('.aba').forEach(a => a.hidden = a.id !== 'aba-' + b.dataset.aba);
});

// ---------- status / execução ----------
const ESTADOS = {
  conectado: ['on', 'Monitorando'], pausado_horario: ['warn', 'Fora do horário'], parado: ['warn', 'Parado pelo painel'],
  aguardando_qr: ['warn', 'Aguardando QR code'], iniciando: ['warn', 'Iniciando…'], erro: ['off', 'Erro'], offline: ['off', 'Robô offline']
};
function robOnline() { return S.status && S.status.ultimo_heartbeat && (Date.now() - new Date(S.status.ultimo_heartbeat)) < 70000; }
function renderStatus() {
  const s = S.status; if (!s) return;
  const on = robOnline();
  const [cls, txt] = on ? (ESTADOS[s.estado] || ['warn', s.estado]) : ['off', 'Robô offline'];
  const p = $('#pill-status'); p.className = 'pill ' + cls; p.textContent = txt;
  const g = S.config.grupo_alvo; $('#txt-grupo').textContent = g ? `Grupo: ${g.name}` : '';
  renderConexao();
}
function renderExec() {
  const modo = (S.config.execucao || {}).modo || 'horario', h = S.config.horario || { inicio: 8, fim: 21 };
  $$('#seg-modo button').forEach(b => b.classList.toggle('sel', b.dataset.modo === modo));
  $('#hor-inicio').value = h.inicio; $('#hor-fim').value = h.fim;
  $('#hor-inicio').disabled = $('#hor-fim').disabled = modo !== 'horario';
  const jan = S.config.janela || {};
  $('#chk-janela').checked = !!jan.visivel; $('#chk-espelho').checked = !!jan.espelho;
}
let modoSel = null;
$('#seg-modo').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-modo]'); if (!b) return;
  modoSel = b.dataset.modo; $$('#seg-modo button').forEach(x => x.classList.toggle('sel', x === b));
  $('#hor-inicio').disabled = $('#hor-fim').disabled = modoSel !== 'horario';
});
async function salvarConfig(chave, valor) {
  const { error } = await sb.from(T('config')).update({ valor, updated_by: S.user.id }).eq('chave', chave);
  if (error) throw error; S.config[chave] = valor;
}
$('#btn-salvar-exec').addEventListener('click', async () => {
  try {
    const modo = modoSel || (S.config.execucao || {}).modo || 'horario';
    const ini = +$('#hor-inicio').value, fim = +$('#hor-fim').value;
    if (modo === 'horario' && (!(ini >= 0 && ini <= 23) || !(fim >= 0 && fim <= 23) || ini === fim)) return toast('Horário inválido: use horas de 0 a 23, início diferente do fim.', true);
    await salvarConfig('execucao', { modo });
    if (modo === 'horario') await salvarConfig('horario', { ...(S.config.horario || {}), inicio: ini, fim });
    $('#msg-exec').textContent = 'Salvo. O robô aplica em até 15 s.'; setTimeout(() => $('#msg-exec').textContent = '', 5000);
  } catch (e) { toast('Não salvou: ' + e.message, true); }
});

// ---------- revisão ----------
function renderRevisao(manterSel) {
  const n = S.revisao.length;
  const b = $('#badge-revisao'); b.textContent = n; b.classList.toggle('zero', n === 0);
  $('#rev-contagem').textContent = n ? `${n} nota(s)` : '';
  $('#rev-lista').innerHTML = n ? S.revisao.map(x => `
    <button class="item ${S.selRev === x.id ? 'sel' : ''}" data-id="${esc(x.id)}">
      <div class="l1"><strong>${esc(x.nome || (x.status === 'ERRO' ? 'Erro de leitura' : 'Sem nome'))}</strong>${tag(x.prioridade_revisao || x.status)}${x.mlc_conferir ? '<span class="tag REVISAO_HUMANA">cadastrada: conferir</span>' : ''}</div>
      <div class="l2">${esc(fmtHora(x.enviado_em))} · ${esc(x.vendedor_nome || 'vendedor ?')} · ${esc(lojaNome(x.loja_chave))}</div>
      <div class="l2">${esc((x.motivos_revisao || []).join(', ').replace(/_/g, ' '))}</div>
    </button>`).join('') : '<p class="muted pad">Nada para ajustar. 🎉</p>';
  if (manterSel && S.selRev && !S.revisao.some(x => x.id === S.selRev)) {
    $('#rev-detalhe').innerHTML = '<p class="muted">Esta nota já foi tratada.</p>'; S.selRev = null;
  }
}
// abre a nota na área de detalhe; ao salvar/descartar, segue para a próxima da lista
function abrirRev(nota) {
  S.selRev = nota.id; renderRevisao(true);
  abrirEdicao(nota, $('#rev-detalhe'), () => {
    const i = S.revisao.findIndex(x => x.id === nota.id);
    const prox = S.revisao[i + 1] || S.revisao[i - 1];
    S.revisao = S.revisao.filter(x => x.id !== nota.id);
    S.selRev = null; renderRevisao();
    if (prox) abrirRev(prox); else $('#rev-detalhe').innerHTML = '<p class="muted">Tudo ajustado. 🎉</p>';
  });
}
$('#rev-lista').addEventListener('click', (e) => {
  const b = e.target.closest('.item'); if (!b) return;
  const nota = S.revisao.find(x => x.id === b.dataset.id);
  if (nota) abrirRev(nota);
});

// Formulário de edição (usado na revisão e no diálogo da aba Notas)
async function abrirEdicao(n, alvo, aoSalvar) {
  const lojasOpts = '<option value="">(sem loja)</option>' + S.lojas.map(l => `<option value="${esc(l.chave)}" ${l.chave === n.loja_chave ? 'selected' : ''}>${esc(lojaNome(l.chave))}</option>`).join('');
  const dados = n.dados_extraidos || {};
  alvo.innerHTML = `
  <div class="detalhe">
    <div>
      <div class="foto" id="foto-box">${n.imagem_path ? '<p class="muted pad">Carregando foto…</p>' : '<p class="muted pad">Sem foto guardada para esta nota' + (n.origem === 'texto' ? ' (veio de texto).' : '.') + '</p>'}</div>
      <p class="small"><a id="foto-abrir" href="#" target="_blank" rel="noopener" hidden>Abrir foto em outra aba</a></p>
    </div>
    <form class="form" id="form-edicao" autocomplete="off">
      <div class="linha quebra"><strong>${esc(fmtHora(n.enviado_em))}</strong> ${tag(n.status)} ${n.prioridade_revisao ? tag(n.prioridade_revisao) : ''}
        <span class="muted small">${esc(n.vendedor_nome || '')}</span></div>
      ${n.mlc_status ? `<div class="small">Envio ao Minha Loja Conectada: ${tagEnvio(n)} ${esc(n.mlc_erro || '')}${n.mlc_cliente_id ? ' · id ' + esc(n.mlc_cliente_id) : ''}</div>` : ''}
      ${n.mlc_conferir ? '<div class="small" style="color:var(--err)"><b>Cadastrada automaticamente sem validação.</b> Confira os dados; se corrigir, use “Salvar e recadastrar”. “Salvar como corrigida” só marca como conferida.</div>' : ''}
      <div class="motivos">${(n.motivos_revisao || []).map(m => `<span class="tag">${esc(m.replace(/_/g, ' '))}</span>`).join('')}${n.erro_mensagem ? `<span class="tag ERRO">${esc(n.erro_mensagem)}</span>` : ''}</div>
      <label>Nome<input name="nome" value="${esc(n.nome || '')}" placeholder="vazio = cadastrado com caracteres invisíveis"></label>
      <div class="par">
        <label>CPF<input name="cpf" inputmode="numeric" value="${esc(fmtCpf(n.cpf))}" placeholder="000.000.000-00"></label>
        <label>Celular<input name="celular" inputmode="tel" value="${esc(fmtCel(n.celular))}" placeholder="(32) 99999-9999"></label>
      </div>
      <div class="par">
        <label>Loja<select name="loja_chave">${lojasOpts}</select></label>
        <label>Grupo (produto)<input name="grupo" list="dl-grupos" value="${esc(n.grupo || '')}"><datalist id="dl-grupos">${GRUPOS_PRODUTO.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
      </div>
      ${blocoExtra(n)}
      <label>Informações complementares<textarea name="observacao_complementar" placeholder="Anotações para quem for cadastrar">${esc(n.observacao_complementar || '')}</textarea></label>
      <div class="small muted">Produto lido: <b>${esc(n.produto || '–')}</b> · Documento: ${esc(n.tipo_documento || '–')}${n.valor_total ? ' · R$ ' + Number(n.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}</div>
      ${n.texto_original ? `<details><summary>Texto lido da foto</summary><pre>${esc(n.texto_original)}</pre></details>` : ''}
      <div class="acoes">
        <button class="btn" type="submit" id="btn-salvar-nota">Salvar como corrigida</button>
        ${(!n.mlc_status || ['ERRO', 'CADASTRADO'].includes(n.mlc_status)) ? '<button class="btn primary" type="submit" id="btn-salvar-cadastrar">' + (n.mlc_status === 'CADASTRADO' ? 'Salvar e recadastrar' : 'Salvar e cadastrar') + '</button>' : ''}
        <button class="btn danger" type="button" id="btn-descartar">Não é nota / descartar</button>
        <span id="msg-edicao" class="small"></span>
      </div>
    </form>
  </div>`;
  const f = $('#form-edicao', alvo);
  const cpfEl = f.elements.cpf;
  const checarCpf = () => { const d = soDig(cpfEl.value); cpfEl.classList.toggle('bad', d.length > 0 && !cpfValido(d)); cpfEl.classList.toggle('good', cpfValido(d)); };
  cpfEl.addEventListener('input', checarCpf); checarCpf();
  cpfEl.addEventListener('blur', () => { const d = soDig(cpfEl.value); if (d.length === 11) cpfEl.value = fmtCpf(d); });
  f.elements.celular.addEventListener('blur', () => { f.elements.celular.value = fmtCel(f.elements.celular.value); });

  if (n.imagem_path) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(n.imagem_path, 600);
    const box = $('#foto-box', alvo);
    if (error || !data) box.innerHTML = '<p class="muted pad">Não foi possível abrir a foto.</p>';
    else {
      box.innerHTML = `<img src="${esc(data.signedUrl)}" alt="Foto da nota" title="Clique para ampliar">`;
      $('img', box).addEventListener('click', (ev) => ev.target.classList.toggle('zoom'));
      const a = $('#foto-abrir', alvo); a.href = data.signedUrl; a.hidden = false;
    }
  }

  const msg = (t, erro) => { const m = $('#msg-edicao', alvo); m.textContent = t; m.style.color = erro ? 'var(--err)' : 'var(--ok)'; };
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cadastrar = !!(ev.submitter && ev.submitter.id === 'btn-salvar-cadastrar');
    const cpf = soDig(f.elements.cpf.value), cel = soDig(f.elements.celular.value);
    if (cpf && !cpfValido(cpf) && !confirm('Este CPF não passa na validação. Salvar mesmo assim?')) return;
    if (cel && !/^\d{10,11}$/.test(cel)) return msg('Celular precisa ter DDD + 8 ou 9 dígitos.', true);
    const upd = {
      nome: f.elements.nome.value.trim() || null, cpf: cpf || null, celular: cel || null,
      loja_chave: f.elements.loja_chave.value || null, grupo: f.elements.grupo.value.trim() || null,
      observacao_complementar: f.elements.observacao_complementar.value.trim() || null,
      status: 'CORRIGIDO'
    };
    if (cpf && cpf.length !== 11) return msg('CPF precisa ter 11 dígitos.', true);
    upd.mlc_extra = lerExtra(f);
    if (cadastrar) {
      const r = motivoNaoCadastra({ status: 'CORRIGIDO', mlc_status: n.mlc_status, cpf, loja_chave: f.elements.loja_chave.value, nome: f.elements.nome.value });
      if (r) return msg('Para cadastrar: ' + r + '.', true);
      upd.mlc_status = 'PENDENTE'; upd.mlc_erro = null;
    }
    $$('#btn-salvar-nota, #btn-salvar-cadastrar', alvo).forEach(b => { b.disabled = true; });
    let q = sb.from(T('notas')).update(upd).eq('id', n.id);
    if (cadastrar) q = q.or('mlc_status.is.null,mlc_status.eq.ERRO,mlc_status.eq.CADASTRADO').select('id');   // não mexe numa nota que o robô já pegou
    const { data: salvo, error } = await q;
    const liberar = () => $$('#btn-salvar-nota, #btn-salvar-cadastrar', alvo).forEach(b => { b.disabled = false; });
    if (error) { liberar(); return msg('Não salvou: ' + error.message, true); }
    if (cadastrar && !(salvo || []).length) { liberar(); return msg('Esta nota mudou de situação (o robô já a enviou). Feche e atualize a lista.', true); }
    toast(cadastrar ? 'Nota salva e na fila para cadastro' : 'Nota salva como corrigida'); Object.assign(n, upd); aoSalvar && aoSalvar(n);
  });
  $('#btn-descartar', alvo).addEventListener('click', async () => {
    if (!confirm('Descartar esta nota? (ela deixa de aparecer na revisão)')) return;
    const { error } = await sb.from(T('notas')).update({ status: 'DESCARTADO' }).eq('id', n.id);
    if (error) return msg('Não descartou: ' + error.message, true);
    toast('Nota descartada'); n.status = 'DESCARTADO'; aoSalvar && aoSalvar(n);
  });
}

// ---------- notas ----------
function montarFiltros() {
  $('#f-loja').innerHTML = '<option value="">Todas</option><option value="__sem">Sem loja</option>' + S.lojas.map(l => `<option value="${esc(l.chave)}">${esc(lojaNome(l.chave))}</option>`).join('');
  $('#f-de').value = $('#f-ate').value = $('#t-dia').value = hojeSP();
}
async function carregarNotas() {
  const de = $('#f-de').value || hojeSP(), ate = $('#f-ate').value || de;
  let q = sb.from(T('notas')).select('id,msg_id,status,prioridade_revisao,nome,cpf,celular,loja_chave,grupo,vendedor_nome,enviado_em,tempo_cadastro_seg,origem,observacao_complementar,imagem_path,motivos_revisao,erro_mensagem,produto,tipo_documento,valor_total,mlc_status,mlc_cliente_id,mlc_erro,mlc_extra,mlc_conferir')
    .gte('enviado_em', inicioDia(de)).lt('enviado_em', fimDia(ate)).order('enviado_em', { ascending: false }).limit(500);
  if ($('#f-status').value) q = q.eq('status', $('#f-status').value);
  const lj = $('#f-loja').value; if (lj === '__sem') q = q.is('loja_chave', null); else if (lj) q = q.eq('loja_chave', lj);
  const { data, error } = await q;
  if (error) return toast('Erro ao carregar notas: ' + error.message, true);
  S.notas = data || []; renderNotas();
}
function notasFiltradas() {
  const b = $('#f-busca').value.trim().toLowerCase(), bd = soDig(b);
  return !b ? S.notas : S.notas.filter(n => [n.nome, n.vendedor_nome, n.grupo].some(v => (v || '').toLowerCase().includes(b)) || (bd && ((n.cpf || '').includes(bd) || (n.celular || '').includes(bd))));
}
function renderNotas() {
  const l = notasFiltradas();
  $('#tab-notas tbody').innerHTML = l.map(n => `<tr class="clic" data-id="${esc(n.id)}">
    <td>${esc(fmtHora(n.enviado_em))}</td><td>${esc(lojaNome(n.loja_chave))}</td><td title="${esc(n.nome || '')}">${esc(n.nome || '–')}</td>
    <td>${esc(fmtCpf(n.cpf) || '–')}</td><td>${esc(fmtCel(n.celular) || '–')}</td><td>${esc(n.grupo || '–')}</td>
    <td>${esc(n.vendedor_nome || '–')}</td><td>${tag(n.status)}</td><td>${tagEnvio(n)}</td><td class="dir">${esc(fmtDur(n.tempo_cadastro_seg))}</td><td class="dir">${botaoCadastrar(n)}</td></tr>`).join('');
  $('#notas-rodape').textContent = `${l.length} nota(s)` + (S.notas.length >= 500 ? ' (mostrando as 500 mais recentes do período)' : '');
  const nCorr = l.filter(n => n.status === 'CORRIGIDO' && !n.mlc_status).length;
  const bTodas = $('#btn-cadastrar-todas'); bTodas.textContent = nCorr ? `Cadastrar corrigidas (${nCorr})` : 'Cadastrar corrigidas'; bTodas.disabled = !nCorr;
}
$('#tab-notas tbody').addEventListener('click', async (e) => {
  const bCad = e.target.closest('[data-cad]');
  if (bCad) { cadastrarUma(S.notas.find(x => x.id === bCad.dataset.cad)); return; }
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const n = S.notas.find(x => x.id === tr.dataset.id); const dlg = $('#dlg-edicao');
  // a lista não traz o texto lido da foto (pesado): busca só desta nota
  if (n && n.texto_original === undefined) { const { data: tx } = await sb.from(T('notas')).select('texto_original').eq('id', n.id).maybeSingle(); n.texto_original = tx ? tx.texto_original : null; }
  abrirEdicao(n, $('#dlg-corpo'), () => { dlg.close(); carregarNotas(); });
  dlg.showModal();
});
$('#dlg-edicao').addEventListener('click', (e) => { if (e.target.id === 'dlg-edicao') e.target.close(); });
$('#btn-filtrar').addEventListener('click', carregarNotas);
$('#f-busca').addEventListener('input', renderNotas);
$('#btn-csv').addEventListener('click', () => {
  const l = notasFiltradas();
  const cols = ['enviado_em', 'loja_chave', 'nome', 'cpf', 'celular', 'grupo', 'vendedor_nome', 'status', 'tempo_cadastro_seg', 'observacao_complementar', 'mlc_status', 'mlc_erro'];
  const cel = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };   // texto que começa com = + - @ viraria fórmula no Excel
  const csv = '﻿' + [cols.join(';'), ...l.map(n => cols.map(c => cel(n[c])).join(';'))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `notas_${$('#f-de').value}_${$('#f-ate').value}.csv`; a.click();
});

// ---------- cadastro no Minha Loja Conectada ----------
// O painel só coloca a nota na fila (mlc_status = PENDENTE). Quem envia à loja é o robô, uma nota de cada vez.
function motivoNaoCadastra(n) {
  if (!['SUCESSO', 'CORRIGIDO'].includes(n.status)) return 'a nota precisa estar como SUCESSO ou CORRIGIDO';
  if (n.mlc_status && !['ERRO', 'CADASTRADO'].includes(n.mlc_status)) return 'já está em "' + (ENVIO[n.mlc_status] || [0, n.mlc_status])[1].toLowerCase() + '"';
  if (!cpfValido(n.cpf)) return 'CPF vazio ou inválido';
  if (!n.loja_chave) return 'falta escolher a loja';
  // nome vazio é aceito: o robô cadastra com caracteres invisíveis
  return '';
}
function botaoCadastrar(n) {
  if (!['SUCESSO', 'CORRIGIDO'].includes(n.status) || (n.mlc_status && !['ERRO', 'CADASTRADO'].includes(n.mlc_status))) return '';
  return `<button class="btn" data-cad="${esc(n.id)}">${n.mlc_status === 'ERRO' ? 'Reenviar' : n.mlc_status === 'CADASTRADO' ? 'Recadastrar' : 'Cadastrar'}</button>`;
}
async function colocarNaFila(lista) {
  // as condições evitam mexer em nota que o robô já está enviando ou que já foi cadastrada
  const { data, error } = await sb.from(T('notas')).update({ mlc_status: 'PENDENTE', mlc_erro: null })
    .in('id', lista.map(n => n.id)).in('status', ['SUCESSO', 'CORRIGIDO']).or('mlc_status.is.null,mlc_status.eq.ERRO,mlc_status.eq.CADASTRADO').select('id');
  if (error) throw error;
  return (data || []).length;
}
const avisoRobo = () => robOnline() ? '' : '\n\nO robô está offline: as notas ficam na fila e são cadastradas quando ele voltar.';
async function cadastrarUma(n) {
  if (!n) return;
  const motivo = motivoNaoCadastra(n);
  if (motivo) return toast('Não dá para cadastrar: ' + motivo + '.', true);
  const txt = n.mlc_status === 'CADASTRADO'
    ? 'Esta nota já foi cadastrada (cliente ' + (n.mlc_cliente_id || '?') + '). Recadastrar envia um novo pedido ao sistema da loja, que pode recusar o CPF repetido ou criar um cliente duplicado. Confira lá antes.\n\nRecadastrar mesmo assim?'
    : n.mlc_status === 'ERRO'
    ? 'Esta nota já falhou no envio. Antes de reenviar, confira no sistema da loja se o cliente não foi criado.\n\nReenviar mesmo assim?'
    : `Cadastrar ${n.nome} em ${lojaNome(n.loja_chave)}?`;
  if (!confirm(txt + avisoRobo())) return;
  try {
    const k = await colocarNaFila([n]);
    toast(k ? 'Na fila: o robô cadastra em instantes' : 'Nada a fazer: a nota mudou de situação. Atualize a lista.', !k);
    await carregarNotas();
  } catch (e) { toast('Não foi possível colocar na fila: ' + e.message, true); }
}
async function cadastrarCorrigidas() {
  const corr = notasFiltradas().filter(n => n.status === 'CORRIGIDO' && !n.mlc_status);
  const ok = [], fora = [];
  corr.forEach(n => { const m = motivoNaoCadastra(n); (m ? fora : ok).push({ n, m }); });
  if (!ok.length) return toast(fora.length ? `Nenhuma pode ser cadastrada agora (${fora.length} com pendência).` : 'Nenhuma nota corrigida para cadastrar neste filtro.', true);
  const porLoja = {}; ok.forEach(({ n }) => { const k = lojaNome(n.loja_chave); porLoja[k] = (porLoja[k] || 0) + 1; });
  let txt = `Cadastrar ${ok.length} nota(s) corrigida(s) no Minha Loja Conectada?\n\n` + Object.entries(porLoja).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  if (fora.length) txt += `\n\nFicam de fora ${fora.length}: ` + fora.slice(0, 5).map(({ n, m }) => `${n.nome || 'sem nome'} (${m})`).join('; ') + (fora.length > 5 ? '…' : '');
  if (!confirm(txt + avisoRobo())) return;
  try {
    const k = await colocarNaFila(ok.map(x => x.n));
    toast(`${k} nota(s) na fila: o robô cadastra uma de cada vez`);
    await carregarNotas();
  } catch (e) { toast('Não foi possível colocar na fila: ' + e.message, true); }
}
$('#btn-cadastrar-todas').addEventListener('click', cadastrarCorrigidas);

// ---------- tempo ----------
async function carregarTempo() {
  const dia = $('#t-dia').value || hojeSP();
  const { data, error } = await sb.from(T('notas')).select('enviado_em,processado_em,tempo_cadastro_seg,loja_chave,status')
    .gte('enviado_em', inicioDia(dia)).lt('enviado_em', fimDia(dia)).neq('status', 'DESCARTADO').order('enviado_em').limit(5000);
  if (error) return toast('Erro no tempo: ' + error.message, true);
  renderTempo(data || []);
}
function horaSP(iso) { return +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(iso)) % 24; }
function renderTempo(l) {
  const tempos = l.map(n => +n.tempo_cadastro_seg).filter(x => isFinite(x) && x >= 0);
  const ts = l.map(n => new Date(n.enviado_em).getTime()).sort((a, b) => a - b);
  const gaps = []; for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 1000);
  const horasAtivas = new Set(l.map(n => horaSP(n.enviado_em))).size;
  const ult = l.length ? l[l.length - 1].processado_em : null;
  const c = (v, r) => `<div class="cartao"><div class="v">${v}</div><div class="r">${r}</div></div>`;
  $('#t-cartoes').innerHTML =
    c(l.length, 'notas no dia') + c(fmtDur(media(tempos)), 'tempo médio até cadastrar') + c(fmtDur(mediana(tempos)), 'mediana (metade foi mais rápido)') +
    c(fmtDur(Math.max(0, ...tempos)), 'mais demorada') + c(gaps.length ? fmtDur(media(gaps)) : '–', 'intervalo médio entre notas') +
    c(horasAtivas ? (l.length / horasAtivas).toFixed(1) : '–', 'notas por hora (horas com movimento)') +
    c(ult ? fmtHora(ult).slice(-8) : '–', 'último cadastro');
  const porHora = Array.from({ length: 24 }, () => []);
  l.forEach(n => porHora[horaSP(n.enviado_em)].push(+n.tempo_cadastro_seg));
  const max = Math.max(1, ...porHora.map(a => a.length));
  $('#t-grafico').innerHTML = `<svg viewBox="0 0 480 130" width="100%" role="img" aria-label="Notas por hora">` +
    porHora.map((a, h) => { const alt = a.length / max * 90; return `<rect class="graf-barra" x="${h * 20 + 3}" y="${105 - alt}" width="14" height="${alt}" rx="2"><title>${h}h: ${a.length} nota(s)</title></rect>` +
      (a.length ? `<text class="graf-eixo" x="${h * 20 + 10}" y="${101 - alt}" text-anchor="middle">${a.length}</text>` : '') +
      `<text class="graf-eixo" x="${h * 20 + 10}" y="120" text-anchor="middle">${h}</text>`; }).join('') + '</svg>';
  $('#t-horas tbody').innerHTML = porHora.map((a, h) => a.length ? `<tr><td>${h}h</td><td class="dir">${a.length}</td><td class="dir">${fmtDur(media(a))}</td><td class="dir">${fmtDur(mediana(a))}</td><td class="dir">${fmtDur(Math.max(...a))}</td></tr>` : '').join('') || '<tr><td colspan="5" class="muted">Sem notas neste dia.</td></tr>';
  const lojas = {}; l.forEach(n => (lojas[n.loja_chave || '__sem'] ||= []).push(+n.tempo_cadastro_seg));
  $('#t-lojas tbody').innerHTML = Object.entries(lojas).map(([k, a]) => `<tr><td>${esc(k === '__sem' ? 'Sem loja' : lojaNome(k))}</td><td class="dir">${a.length}</td><td class="dir">${fmtDur(media(a))}</td><td class="dir">${fmtDur(mediana(a))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sem notas neste dia.</td></tr>';
}
$('#btn-tempo').addEventListener('click', carregarTempo);

// ---------- WhatsApp: conexão, grupo, descoberta, janela ----------
function renderConexao() {
  const s = S.status, box = $('#conexao-corpo'); if (!s) return;
  const on = robOnline();
  const visto = s.ultimo_heartbeat ? `último sinal ${fmtHora(s.ultimo_heartbeat)}` : 'nunca conectou';
  let html = `<p><b>${on ? (ESTADOS[s.estado] || [0, s.estado])[1] : 'Robô offline'}</b> <span class="muted small">(${esc(visto)})</span></p>`;
  if (!on) html += '<p class="muted small">O programa do robô precisa estar rodando no computador/servidor. Veja o passo a passo no DEPLOY.md.</p>';
  if (s.detalhe) html += `<p class="small">${esc(s.detalhe)}</p>`;
  if (on && s.estado === 'aguardando_qr' && s.qr_code) html += '<p class="small">No celular: WhatsApp → Aparelhos conectados → Conectar aparelho. Escaneie:</p><div class="qr" id="qr-box"></div>';
  const c = s.contadores || {};
  if (on && c.limites) html += `<p class="muted small">Mensagens/h ${esc(c.limites.messages)} · imagens/h ${esc(c.limites.images)} · na fila ${esc(c.na_fila ?? 0)} · lidas ${esc(c.processadas ?? 0)}</p>`;
  box.innerHTML = html;
  if (on && s.estado === 'aguardando_qr' && s.qr_code && window.QRCode) {
    const cv = document.createElement('canvas'); $('#qr-box').appendChild(cv); window.QRCode.toCanvas(cv, s.qr_code, { width: 220, margin: 1 });
  }
  atualizarEspelho();
}
function renderGrupoCfg() {
  const g = S.config.grupo_alvo || {}; $('#g-id').value = g.id || ''; $('#g-nome').value = g.name || '';
}
$('#btn-salvar-grupo').addEventListener('click', async () => {
  const id = $('#g-id').value.trim(), name = $('#g-nome').value.trim() || id;
  if (!/^\d{8,}(-\d+)?@g\.us$/.test(id)) return toast('O ID de grupo termina em @g.us (ex.: 120363429448325770@g.us).', true);
  try { await salvarConfig('grupo_alvo', { id, name }); $('#msg-grupo').textContent = 'Salvo. O robô passa a ler este grupo em até 15 s.'; setTimeout(() => $('#msg-grupo').textContent = '', 6000); renderStatus(); }
  catch (e) { toast('Não salvou: ' + e.message, true); }
});
function renderGrupos() {
  $('#tab-grupos tbody').innerHTML = S.grupos.length ? S.grupos.map(g => `<tr><td>${esc(g.nome)}</td><td><code>${esc(g.id)}</code></td><td class="dir">${esc(g.participantes ?? '–')}</td><td class="dir"><b>${esc(g.msgs_no_teste)}</b></td>
    <td><button class="btn" data-usar="${esc(g.id)}">Usar este</button></td></tr>`).join('') : '<tr><td colspan="5" class="muted">Nenhum grupo detectado ainda. Use “Listar meus grupos” ou o teste.</td></tr>';
}
$('#tab-grupos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-usar]'); if (!b) return;
  const g = S.grupos.find(x => x.id === b.dataset.usar);
  if (!confirm(`Monitorar o grupo "${g.nome}"?`)) return;
  try { await salvarConfig('grupo_alvo', { id: g.id, name: g.nome }); renderGrupoCfg(); renderStatus(); toast('Grupo alterado. O robô aplica em até 15 s.'); }
  catch (er) { toast('Não salvou: ' + er.message, true); }
});
async function enviarComando(tipo, payload = {}) {
  if (!robOnline()) return toast('O robô está offline: o comando fica na fila e roda quando ele voltar.', true);
  const { error } = await sb.from(T('comandos')).insert({ tipo, payload });
  if (error) return toast('Não enviou o comando: ' + error.message, true);
  toast('Comando enviado ao robô');
}
$('#btn-listar').addEventListener('click', () => enviarComando('descobrir_grupos'));
$('#btn-teste').addEventListener('click', () => enviarComando('teste_monitoramento', { segundos: +$('#teste-seg').value }));
$('#btn-rp-pend').addEventListener('click', () => enviarComando('reprocessar_pendencias', { desde: $('#rp-hora').value || '09:00', dias_atras: +$('#rp-dia').value }));
$('#btn-rp-erros').addEventListener('click', () => enviarComando('reprocessar_erros'));
$('#btn-captura').addEventListener('click', () => enviarComando('captura_tela'));
function renderComandos() {
  const nome = { descobrir_grupos: 'Listar grupos', teste_monitoramento: 'Teste de monitoramento', reprocessar_pendencias: 'Reprocessar pendentes', reprocessar_erros: 'Reprocessar erros', captura_tela: 'Captura de tela', reiniciar: 'Reiniciar', trocar_conta: 'Conectar outra conta', restaurar_conta: 'Voltar à conta anterior' };
  $('#cmd-lista').innerHTML = S.comandos.map(c => `<div class="cmd"><span class="tag ${c.status === 'erro' ? 'ERRO' : c.status === 'ok' ? 'SUCESSO' : 'REVISAO_HUMANA'}">${esc(c.status)}</span>
    <span>${esc(nome[c.tipo] || c.tipo)}</span><span class="muted">${esc(fmtHora(c.created_at))}</span>
    <span class="muted">${c.resultado ? esc(c.resultado.erro || Object.entries(c.resultado).map(([k, v]) => `${k}: ${v}`).join(' · ')) : ''}</span></div>`).join('');
}
$('#chk-janela').addEventListener('change', async (e) => {
  try { await salvarConfig('janela', { ...(S.config.janela || {}), visivel: e.target.checked }); toast(e.target.checked ? 'Abrindo a janela no computador do robô…' : 'Voltando ao modo oculto…'); }
  catch (er) { toast('Não salvou: ' + er.message, true); e.target.checked = !e.target.checked; }
});
$('#chk-espelho').addEventListener('change', async (e) => {
  try { await salvarConfig('janela', { ...(S.config.janela || {}), espelho: e.target.checked }); atualizarEspelho(); }
  catch (er) { toast('Não salvou: ' + er.message, true); e.target.checked = !e.target.checked; }
});
let espelhoVisto = null;
async function atualizarEspelho() {
  const s = S.status, quer = (S.config.janela || {}).espelho;
  $('#espelho-box').hidden = !quer;
  if (!quer || !s || !s.captura_path || s.captura_em === espelhoVisto) return;
  espelhoVisto = s.captura_em;
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(s.captura_path, 120);
  if (data) { $('#espelho-img').src = data.signedUrl; $('#espelho-info').textContent = 'Atualizado às ' + fmtHora(s.captura_em); }
}

// ---------- trocar a conta do WhatsApp (só SUPER_ADMIN) ----------
// A tela só mostra este cartão para SUPER_ADMIN. Quem garante de verdade é o banco (trigger do 003_*.sql)
// e o robô, que confere o autor do comando antes de executar. Se o 003 ainda não foi aplicado, a opção some.
async function verificarSuperAdmin() {
  let ok = false;
  try { const { data, error } = await sb.rpc('fn_app_mon_notas_eh_super_admin'); ok = !error && data === true; } catch (_) { ok = false; }
  const velho = $('#card-troca-conta'); if (velho) velho.remove();
  if (ok) montarTrocaConta();
  return ok;
}
function montarTrocaConta() {
  const ancora = $('#card-conexao'); if (!ancora) return;
  const card = document.createElement('div'); card.className = 'card larga'; card.id = 'card-troca-conta';
  card.innerHTML = `
    <h3>Conta do WhatsApp <span class="tag">SUPER_ADMIN</span></h3>
    <p class="small">Conecta <b>outro número</b> de WhatsApp ao robô. A conta atual fica guardada no computador do robô e pode ser restaurada.</p>
    <div class="linha quebra">
      <button class="btn danger" id="btn-trocar-conta">Conectar outra conta</button>
      <button class="btn" id="btn-restaurar-conta">Voltar à conta anterior</button>
    </div>
    <p class="muted small">Depois de pedir, o QR code aparece na caixa <b>Conexão</b> (em até ~1 min). No celular da nova conta: WhatsApp → Aparelhos conectados → Conectar aparelho. Enquanto o QR não for lido, <b>nada é monitorado</b>. A nova conta precisa estar no grupo; se o grupo for outro, escolha-o depois em “Listar meus grupos”.</p>`;
  ancora.after(card);
  $('#btn-trocar-conta', card).addEventListener('click', () => {
    const g = S.config.grupo_alvo;
    if (!confirm('Conectar OUTRA conta de WhatsApp ao robô?\n\n• O robô para de ler com a conta atual agora.\n• A sessão atual é guardada (dá para voltar).\n• Você precisará ler um QR code com o celular da nova conta.' + (g ? `\n\nGrupo monitorado hoje: ${g.name}` : ''))) return;
    enviarComando('trocar_conta', { confirmar: true });
  });
  $('#btn-restaurar-conta', card).addEventListener('click', () => {
    if (!confirm('Voltar para a conta de WhatsApp usada antes da última troca?\n\nA conta que está conectada agora também fica guardada.')) return;
    enviarComando('restaurar_conta', { confirmar: true });
  });
}

// ---------- vendedores ----------
function renderVendedores() {
  const lojasOpts = (sel) => '<option value="">(todas / nenhuma)</option>' + S.lojas.map(l => `<option value="${esc(l.chave)}" ${l.chave === sel ? 'selected' : ''}>${esc(lojaNome(l.chave))}</option>`).join('');
  $('#tab-vend tbody').innerHTML = S.vendedores.map(v => `<tr data-id="${esc(v.id)}">
    <td><input data-c="nome" value="${esc(v.nome)}"></td>
    <td><input data-c="apelidos" value="${esc((v.apelidos || []).join(', '))}" placeholder="Ph, Paulo"></td>
    <td><select data-c="loja_principal">${lojasOpts(v.loja_principal)}</select></td>
    <td><input type="checkbox" data-c="todas_lojas" ${v.todas_lojas ? 'checked' : ''}></td>
    <td><input type="checkbox" data-c="visita_outras_lojas" ${v.visita_outras_lojas ? 'checked' : ''}></td>
    <td class="small muted" title="${esc(v.whatsapp_id || '')}">${v.whatsapp_id ? 'vinculado ✓' : 'ainda não'}</td>
    <td><input type="checkbox" data-c="ativo" ${v.ativo ? 'checked' : ''}></td>
    <td><button class="btn" data-salvar>Salvar</button></td></tr>`).join('');
}
$('#tab-vend').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-salvar]'); if (!b) return;
  const tr = b.closest('tr'), val = (c) => { const el = $(`[data-c="${c}"]`, tr); return el.type === 'checkbox' ? el.checked : el.value; };
  const row = {
    nome: val('nome').trim(), apelidos: val('apelidos').split(',').map(x => x.trim()).filter(Boolean),
    loja_principal: val('loja_principal') || null, todas_lojas: val('todas_lojas'), visita_outras_lojas: val('visita_outras_lojas'), ativo: val('ativo')
  };
  if (!row.nome) return toast('Informe o nome.', true);
  const novo = tr.dataset.id === 'novo';
  const { error } = novo ? await sb.from(T('vendedores')).insert(row) : await sb.from(T('vendedores')).update(row).eq('id', tr.dataset.id);
  if (error) return toast('Não salvou: ' + error.message, true);
  toast('Vendedor salvo'); await carregarVendedores(); renderVendedores();
});
$('#btn-novo-vend').addEventListener('click', () => {
  if ($('#tab-vend tr[data-id="novo"]')) return;
  S.vendedores.push({ id: 'novo', nome: '', apelidos: [], loja_principal: null, todas_lojas: false, visita_outras_lojas: false, ativo: true, whatsapp_id: null });
  renderVendedores(); $('#tab-vend tr[data-id="novo"] input').focus();
});

// ---------- registro ----------
function renderLogs() {
  $('#log-lista').innerHTML = S.logs.map(l => `<div class="${esc(l.nivel === 'erro' ? 'erro' : l.nivel === 'aviso' ? 'aviso' : '')}">${esc(fmtHora(l.created_at))} · ${esc(l.mensagem)}</div>`).join('') || '<span class="muted">Sem registros.</span>';
}

// Sai da conta depois de IDLE_MIN minutos sem uso (config.js, padrão 30): um computador esquecido logado dá acesso a CPFs.
let ociosidadeLigada = false;
function iniciarOciosidade() {
  if (ociosidadeLigada) return; ociosidadeLigada = true;
  const lim = (Number(CFG.IDLE_MIN) || 30) * 60000; let ultimo = Date.now();
  ['click', 'keydown', 'pointerdown', 'touchstart', 'scroll'].forEach(ev => window.addEventListener(ev, () => { ultimo = Date.now(); }, { passive: true, capture: true }));
  setInterval(async () => { if (Date.now() - ultimo > lim) { try { await sb.auth.signOut(); } finally { location.reload(); } } }, 30000);
}
// ao voltar para a aba, atualiza (enquanto ela estava escondida as atualizações ficam em pausa)
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) { renderStatus(); carregarNotas(); carregarTempo(); } });

// campos opcionais do cadastro no Minha Loja Conectada (guardados em notas.mlc_extra; vazio = não envia)
const CAMPOS_EXTRA = [['apelido', 'Apelido', 'automático: primeiro + último nome'], ['sexo', 'Sexo', ''], ['nascimento', 'Nascimento (AAAA-MM-DD)', ''], ['email', 'E-mail', ''], ['telefone', 'Telefone', ''], ['cep', 'CEP', ''], ['endereco', 'Endereço', ''], ['numero', 'Número', ''], ['complemento', 'Complemento', ''], ['bairro', 'Bairro', ''], ['cidade', 'Cidade', 'da loja'], ['uf', 'UF', 'da loja'], ['comoConheceu', 'Como conheceu', 'padrão do robô'], ['rg_ie', 'RG / IE', 'ISENTO'], ['obs', 'Observação (obs)', '']];
function blocoExtra(n) {
  const x = n.mlc_extra || {};
  const campos = CAMPOS_EXTRA.map(([k, rot, dica]) => `<label>${esc(rot)}<input name="x_${k}" value="${esc(x[k] || '')}" placeholder="${esc(dica)}" maxlength="300"></label>`);
  const pares = []; for (let i = 0; i < campos.length; i += 2) pares.push(`<div class="par">${campos[i]}${campos[i + 1] || ''}</div>`);
  return `<details class="extra" ${Object.keys(x).length ? 'open' : ''}><summary>Todos os dados do cadastro no Minha Loja Conectada</summary><p class="small muted">Campo vazio não é enviado (ou usa o padrão que aparece em cinza). Nome vazio é cadastrado com caracteres invisíveis.</p>${pares.join('')}</details>`;
}
function lerExtra(f) {
  const x = {}; CAMPOS_EXTRA.forEach(([k]) => { const v = f.elements['x_' + k].value.trim(); if (v) x[k] = v; });
  return Object.keys(x).length ? x : null;
}

boot().catch(e => { console.error(e); mostrarLogin(); $('#login-erro').textContent = 'Erro ao iniciar: ' + e.message; });
})();
