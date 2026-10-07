# Instruções para trabalhar neste projeto

## Contexto e ponto de partida

Este repositório é o **SheetDock CRM**, uma extensão Chrome Manifest V3 para CRM configurável ao lado do WhatsApp Web, com armazenamento local ou uma planilha do próprio usuário. O nome é provisório. A base é um beta de desenvolvimento, com código público MIT; vendas e publicação na loja ainda não foram concluídas.

Antes de alterar o projeto, leia [README.md](README.md), [docs/CONTINUITY.md](docs/CONTINUITY.md), [docs/VALIDATION.md](docs/VALIDATION.md) e a seção pertinente de [docs/LAUNCH.md](docs/LAUNCH.md). Confira a raiz Git e o estado de trabalho antes de editar.

## Limites do projeto

- Trabalhe apenas nesta base independente. O projeto privado de origem continua em uso e deve permanecer intacto.
- Não importar histórico Git, dados de clientes, demonstrativos, marcas, links pessoais, integrações empresariais, identificadores ou credenciais do projeto de origem.
- Usar contatos e planilhas fictícios nos testes e exemplos. Nunca publicar tokens, senhas, chaves privadas ou backups reais.
- A primeira execução começa vazia; demonstração fictícia depende de ação explícita do usuário.
- O produto atual acompanha contatos e copia modelos de texto. Não lê mensagens, não envia respostas/campanhas, não usa APIs internas do WhatsApp e não inclui telemetria ou IA.
- Integrações adicionais, cobrança e automações são trabalho futuro, não funcionalidades existentes. Mudanças de escopo seguem a instrução expressa do usuário.

## Cuidados de implementação

- Preservar IDs únicos dos registros e chaves estáveis dos campos; gravações Google usam valores RAW.
- Conferir a base ativa antes de mutações. Um formulário antigo não pode gravar na planilha ou base escolhida depois.
- Nome exibido no WhatsApp é sugestão: exigir confirmação na sessão da conversa. Invalidar essa confirmação em navegação ou troca do cabeçalho.
- Seleção automática exige telefone normalizado com correspondência única. Se houver duplicidade no refresh, limpar a seleção automática; preservar apenas escolha manual explícita ainda válida.
- Preservar código de país e telefone internacional. Não remover dígitos nacionais para forçar correspondências.
- Preservar fórmulas, células protegidas, validações e mudanças de estrutura. Localizar linhas pelo ID depois de ordenação.
- Verificações Sheets de conflito não são comparação/gravação atômica. Não prometer prevenção absoluta de edições simultâneas.
- Importação de backup deve ser atômica; IDs importados são regenerados e vínculos de conversa precisam de nova confirmação. Em base vazia, restaurar o schema completo.
- O OAuth deve pertencer a este produto. O manifest de fonte permanece sem credenciais; o empacotador recebe cliente OAuth e chave pública novos do publicador. Nunca reutilizar configuração de outra extensão.
- O escopo atual permite acesso a todas as planilhas da conta. Selecionar uma planilha não restringe a autorização Google; `drive.file` ainda não foi implementado.
- Manter lógica executável no pacote, sem código remoto ou `eval`. Rever permissões e privacidade quando mudar tratamento de dados.

## Desenvolvimento e validação

Use Node.js 22 ou superior. Instalação reproduzível: `npm ci` e `npx playwright install chromium`.

```sh
npm test
npm run test:browser
npm run check
npm run package
```

Para alterações de comportamento, executar as verificações pertinentes descritas em CONTRIBUTING.md. Alterações somente de documentação pedem revisão de conteúdo, links e diff; não precisam repetir testes da aplicação sem outra razão. Usar branches `codex/` ao abrir uma nova frente.

Fixtures e Chromium com perfil temporário não comprovam funcionamento com WhatsApp autenticado, Google real, pagamento ou Chrome Web Store. Registrar separadamente o que foi testado localmente e o que teve evidência externa. Não apresentar build ou upload como aprovação da loja.

Atualize CONTINUITY.md e os documentos afetados quando houver mudança relevante de estado, arquitetura, permissões ou lançamento. Guarde evidências sem dados pessoais. Não efetuar cobranças, gastos, mensagens externas ou publicação na loja sem autorização correspondente à ação.
