# Contexto do Projeto: Igreja em Belo Horizonte (Portal de Vida Comum)

## 1. Visão Geral
Este não é um site institucional ou um sistema de gestão de uma "empresa religiosa". É uma intranet orgânica para facilitar a "vida comum" dos irmãos (Atos 2). O foco está em relacionamentos ("juntas e ligamentos") e não em membresia fria.

## 2. Nomenclatura Estrita
Os agentes DEVEM usar os seguintes termos nas interfaces e variáveis:
- NÃO use "Membros"; use "Discípulos" ou "Irmãos".
- NÃO use "Igreja" no sentido de instituição/prédio; use "A Igreja na cidade" ou "O Corpo".
- NÃO use "Líder/Chefe"; use "Presbitério", "Diaconato" ou "Discipulador".
- Os grupos que se reúnem nas casas são chamados de "Grupos Caseiros" ou "Oikos".

## 3. Lógica de Relacionamentos (Core Business)
A estrutura de dados central não é o indivíduo isolado, mas a quem ele está ligado. A tabela `profiles` possui auto-relacionamento (`discipler_id`) para montar a "Árvore de Discipulado". Todas as features desenvolvidas devem respeitar a privacidade e a prestação de contas baseada nesses vínculos.

## 4. Diretrizes Teológicas, Conteúdo e Design
Consulte obrigatoriamente [06-diretrizes-conteudo-design.md](file:///c:/Users/ggoes/Documents/igrejaBH/.agents/rules/06-diretrizes-conteudo-design.md) e [docs/DIRETRIZES_CONTEUDO_DESIGN.md](file:///c:/Users/ggoes/Documents/igrejaBH/docs/DIRETRIZES_CONTEUDO_DESIGN.md) para a aplicação prática dos 7 princípios teológicos no design, copywriting e arquitetura de informação.

## 5. Infraestrutura e Arquitetura de Deploy (Cloudflare + Resend + Supabase)
- **Hospedagem e DNS:** O projeto é hospedado no **Cloudflare Pages** (projeto `igreja-bh`), com DNS gerenciado na zona `igrejaembh.com.br`:
  - **Produção (`main`):** `https://igrejaembh.com.br` e `https://www.igrejaembh.com.br`
  - **Homologação (`dev`):** `https://dev.igrejaembh.com.br`
- **Rotas Serverless / APIs:** Endpoints `/api/*` rodam como **Cloudflare Pages Functions** em `functions/api/` (ex: `functions/api/send-email.ts`).
- **E-mails Transacionais:** Gerenciados via **Resend** com o domínio verificado `igrejaembh.com.br` (`sa-east-1`), utilizando `src/services/emailService.ts` (primário via Supabase Edge Function `send-email`, fallback via `/api/send-email` no Cloudflare Pages). As chaves (`RESEND_API_KEY`) devem ficar exclusivamente nas variáveis de ambiente/secrets do Cloudflare Pages e Supabase, nunca no código-fonte.
