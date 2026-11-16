# Monitor de Notas — painel

Página estática (GitHub Pages) que mostra e corrige as notas lidas pelo robô do WhatsApp. Usa Supabase com login.

- **Sem segredos aqui.** `config.js` tem só a URL do projeto e a chave *publishable*, que é pública por definição. A proteção é o login e as regras de acesso (RLS) do banco.
- **Nunca** coloque neste repositório a chave `service_role`/`sb_secret_`, CPFs, fotos de notas ou arquivos `.env`.
- Antes de cada envio: `node tools/verificar-antes-do-push.js`.

## Publicar
1. `node tools/aplicar-sri.js` (uma vez; precisa de internet) trava os scripts do CDN.
2. Settings → Pages → *Deploy from a branch* → `main` / root.
3. Supabase → Authentication → URL Configuration: adicione a URL do Pages.

Arquivos que devem estar aqui: `index.html`, `app.js`, `styles.css`, `config.js`, `.nojekyll`.
