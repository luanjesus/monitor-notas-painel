// verificar-antes-do-push.js: procura o que NUNCA pode ir para o GitHub (chaves, CPFs, sessão do WhatsApp, fotos de notas).
// Confere só os arquivos que o git enviaria (respeita o .gitignore). Não precisa de internet nem de pacotes.
//
//   node tools/verificar-antes-do-push.js            confere tudo que seria enviado
//   node tools/verificar-antes-do-push.js --staged   confere só o que está em "git add" (usado pelo hook)
//   node tools/verificar-antes-do-push.js --instalar-hook   passa a conferir sozinho a cada "git commit"
//   acrescente --estrito para tratar avisos como erro
// Código de saída 1 = achou problema (o hook bloqueia o commit).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = new Set(process.argv.slice(2));
const raiz = (() => { try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); } catch (_) { return null; } })();
if (!raiz) { console.error('Esta pasta ainda não é um repositório git. Rode primeiro:  git init'); process.exit(2); }

if (args.has('--instalar-hook')) {
    const hook = path.join(raiz, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nnode tools/verificar-antes-do-push.js --staged || { echo "Commit bloqueado: veja acima."; exit 1; }\n', { mode: 0o755 });
    console.log('Hook instalado: todo "git commit" passa a ser conferido.');
    process.exit(0);
}

const git = (...a) => execFileSync('git', a, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
const arquivos = args.has('--staged')
    ? git('diff', '--cached', '--name-only', '--diff-filter=ACM')
    : [...new Set(git('ls-files', '-co', '--exclude-standard'))];

// ---------- arquivos que não podem ser enviados, pelo nome ----------
const PROIBIDOS = [
    [/(^|\/)\.env($|\.)(?!example$)/i, 'arquivo .env (guarda a chave service_role)'],
    [/(^|\/)\.wwebjs_(auth|cache)\//, 'sessão do WhatsApp (quem tem esta pasta controla a conta)'],
    [/(^|\/)(dados|logs|estado)\//, 'dados de clientes / logs / estado local (CPF em claro)'],
    [/\.(jsonl|log)$/i, 'arquivo de dados/log (pode ter CPF)'],
    [/(^|\/)config\/(vendedores|memoria-loja)\.json$/i, 'cadastro local de vendedores/lojas'],
    [/\.(jpe?g|png|webp|heic)$/i, 'imagem (foto de nota fiscal tem CPF e nome)'],
    [/\.(pem|key|p12|pfx)$/i, 'chave/certificado'],
    [/(^|\/)id_(rsa|ed25519)/, 'chave SSH'],
    [/\.bak/i, 'cópia de segurança (.bak) pode conter versão antiga com segredo'],
    [/\.(sqlite|db)$/i, 'banco local'],
    [/(^|\/)node_modules\//, 'node_modules']
];

// ---------- padrões de segredo dentro dos arquivos ----------
function cpfValido(d) {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    for (const n of [9, 10]) {
        let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i);
        if (((s * 10) % 11) % 10 !== +d[n]) return false;
    }
    return true;
}
function papelDoJwt(jwt) {
    try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role || '?'; } catch (_) { return '?'; }
}

const criticos = [], avisos = [];
const ESTE = path.basename(__filename);

for (const rel of arquivos) {
    const nome = rel.replace(/\\/g, '/');
    for (const [re, motivo] of PROIBIDOS) if (re.test(nome)) { criticos.push(`${nome}: ${motivo}`); break; }

    if (path.basename(nome) === ESTE || path.basename(nome) === '.env.example') continue;
    const caminho = path.join(raiz, rel);
    let txt;
    try {
        const st = fs.statSync(caminho);
        if (!st.isFile() || st.size > 3 * 1024 * 1024) continue;
        const buf = fs.readFileSync(caminho);
        if (buf.includes(0)) continue;                 // binário
        txt = buf.toString('utf8');
    } catch (_) { continue; }

    for (const m of txt.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
        const papel = papelDoJwt(m[0]);
        if (papel === 'anon') continue;                // chave pública por definição
        (papel === 'service_role' ? criticos : avisos).push(`${nome}: token JWT (papel: ${papel})${papel === 'service_role' ? ' - CHAVE SERVICE_ROLE' : ''}`);
    }
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(txt)) criticos.push(`${nome}: chave secreta do Supabase (sb_secret_...)`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(txt)) criticos.push(`${nome}: chave privada`);
    if (/SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*['"]?[A-Za-z0-9._-]{20,}/.test(txt)) criticos.push(`${nome}: SUPABASE_SERVICE_ROLE_KEY preenchida`);
    if (/(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(txt)) criticos.push(`${nome}: token do GitHub`);
    if (/\bBearer\s+[A-Za-z0-9._-]{30,}/.test(txt)) avisos.push(`${nome}: "Bearer <token>" escrito no arquivo`);
    if (/\b(token|secret|senha|password)\b['"]?\s*[:=]\s*['"][A-Za-z0-9._\/+-]{24,}['"]/i.test(txt)) avisos.push(`${nome}: possível token/senha escrito no código`);
    const cpfs = [...txt.matchAll(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g)].filter(m => cpfValido(m.slice(1).join('')));
    if (cpfs.length) avisos.push(`${nome}: ${cpfs.length} CPF(s) válido(s) em claro`);
}

console.log(`Arquivos conferidos: ${arquivos.length}`);
if (avisos.length) { console.log('\nAVISOS (confira):'); avisos.forEach(a => console.log('  - ' + a)); }
if (criticos.length) {
    console.log('\nBLOQUEADO - isto NÃO pode ir para o GitHub:');
    [...new Set(criticos)].forEach(c => console.log('  x ' + c));
    console.log('\nO que fazer: coloque o caminho no .gitignore e, se já estava no git, tire-o do controle com:');
    console.log('  git rm -r --cached <caminho>');
    console.log('Se uma CHAVE chegou a ser enviada ao GitHub (mesmo apagada depois), troque a chave no Supabase: o histórico continua público.');
    process.exit(1);
}
if (avisos.length && args.has('--estrito')) process.exit(1);
console.log(avisos.length ? '\nNenhum bloqueio, mas leia os avisos.' : '\nOK: nada perigoso encontrado.');
