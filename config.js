// Estes dois valores são PÚBLICOS por definição (chave "publishable"/anon). A segurança vem do login
// e das regras RLS do banco. NUNCA coloque aqui a chave service_role.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://tvdpjdnfzegircxbnqbx.supabase.co',
  SUPABASE_KEY: 'sb_publishable_t7URgvjCJEgg3nyuzraIfw_t82luKN7',
  // minutos sem usar o painel até sair da conta sozinho (computador esquecido logado = acesso a CPFs)
  IDLE_MIN: 30
};
