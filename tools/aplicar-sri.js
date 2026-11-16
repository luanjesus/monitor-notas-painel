// aplicar-sri.js: trava os scripts de terceiros do painel (CDN) com SRI (Subresource Integrity).
// Com isso, se o CDN (ou alguém no caminho) trocar o arquivo, o navegador se recusa a executá-lo.
// Precisa de internet. Uso (na pasta app-mon-notas):   node tools/aplicar-sri.js
// Rode de novo quando trocar a versão de uma biblioteca no index.html.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arquivo = path.resolve(process.argv[2] || path.join(__dirname, '..', 'painel', 'index.html'));
const RE_TAG = /<script\b[^>]*\bsrc="(https:\/\/cdn\.jsdelivr\.net\/npm\/[^"]+)"[^>]*><\/script>/g;

async function baixar(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

async function aplicar(html, buscar = baixar) {
    const tags = [...html.matchAll(RE_TAG)];
    let saida = html, n = 0;
    for (const m of tags) {
        const [tag, url] = m;
        if (/\bintegrity=/.test(tag)) continue;
        if (!/@\d+\.\d+\.\d+\//.test(url)) throw new Error(`${url}: fixe a versão exata (ex.: pacote@1.2.3) antes de usar SRI`);
        const hash = 'sha384-' + crypto.createHash('sha384').update(await buscar(url)).digest('base64');
        const nova = tag.replace(/><\/script>$/, ` integrity="${hash}" crossorigin="anonymous"></script>`);
        saida = saida.replace(tag, nova);
        n++;
        console.log(`✓ ${url}\n    ${hash}`);
    }
    return { html: saida, n };
}

module.exports = { aplicar };

if (require.main === module) {
    (async () => {
        if (!fs.existsSync(arquivo)) { console.error(`Não achei ${arquivo}`); process.exit(1); }
        const original = fs.readFileSync(arquivo, 'utf8');
        const { html, n } = await aplicar(original);
        if (!n) { console.log('Nada a fazer: os scripts já têm SRI.'); return; }
        const copia = `${arquivo}.bak-antes-sri`;
        if (!fs.existsSync(copia)) fs.copyFileSync(arquivo, copia);
        fs.writeFileSync(arquivo, html);
        console.log(`Pronto: ${n} script(s) travado(s). Cópia: ${path.basename(copia)}`);
    })().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
}
