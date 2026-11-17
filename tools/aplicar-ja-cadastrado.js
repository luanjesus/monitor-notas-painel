// tools/aplicar-ja-cadastrado.js: mostra "Já possui cadastro" na coluna Envio do painel.
// Rodar dentro da pasta app-mon-notas:  node tools\aplicar-ja-cadastrado.js
// Faz cópia de segurança (painel\app.js.bak-antes-ja-cadastrado) e só troca a linha da tabela ENVIO.
const fs = require('fs');
const path = require('path');

const arq = path.join(__dirname, '..', 'app.js');
let s = fs.readFileSync(arq, 'utf8');
if (s.includes('JA_CADASTRADO')) { console.log('Já aplicado. Nada a fazer.'); process.exit(0); }

const antigo = "CADASTRADO: ['SUCESSO', 'Cadastrado'], ERRO: ['ERRO', 'Falhou'] };";
if (!s.includes(antigo)) {
    console.log('Não achei a linha "const ENVIO = {...}" esperada em painel/app.js. Nada foi alterado.');
    console.log('Edite à mão: acrescente  JA_CADASTRADO: [\'SUCESSO\', \'Já possui cadastro\']  dentro de const ENVIO.');
    process.exit(1);
}
fs.writeFileSync(arq + '.bak-antes-ja-cadastrado', s);
s = s.replace(antigo, "CADASTRADO: ['SUCESSO', 'Cadastrado'], ERRO: ['ERRO', 'Falhou'], JA_CADASTRADO: ['SUCESSO', 'Já possui cadastro'] };");
fs.writeFileSync(arq, s);
console.log('Pronto: painel/app.js atualizado (cópia em painel/app.js.bak-antes-ja-cadastrado).');
console.log('Se o painel publicado (GitHub Pages) é outro repositório, envie o app.js novo para lá também.');
