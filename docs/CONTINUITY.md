# Continuidade do SheetDock CRM

Registrado em **7 de outubro de 2026** para retomar o trabalho neste projeto separado. Esta documentação registra o beta e o que falta para transformá-lo em uma distribuição comercial. Não representa lançamento ou aprovação das plataformas.

## Objetivo e decisões já tomadas

Criar um CRM para WhatsApp Web que uma pessoa ou empresa consiga configurar sozinha: contatos, campos, funil e modelos próprios, usando uma planilha de sua posse como banco de dados ou armazenamento local. A experiência de compra pretendida é instalar pela Chrome Web Store, configurar pela interface e começar, sem criar credenciais de desenvolvedor.

- Repositório público independente: [rioclaro-dev/sheetdock-crm](https://github.com/rioclaro-dev/sheetdock-crm), branch principal `main`, licença MIT.
- Nome provisório: **SheetDock CRM**. Versão da base: **0.1.0**, beta de desenvolvimento.
- O projeto privado de origem continua separado e em uso. Trabalho futuro deste CRM deve acontecer somente neste repositório.
- Não foram trazidos dados de clientes, integrações empresariais, demonstrativos, credenciais ou links pessoais. Não adicionar esses materiais à base pública.
- Código aberto e comercialização são compatíveis com MIT. Terceiros também podem redistribuir e vender o código; a proposta comercial é distribuição mantida, atualizações e suporte.
- **R$19,90/mês ou R$199/ano por usuário são hipóteses**, não preço aprovado, oferta ativa ou cobrança implementada.

## Estado implementado

| Área | O que existe no beta |
|---|---|
| Base local | Inicia vazia; cadastro, edição, exclusão confirmada, busca, filtros, funil e acompanhamento de datas |
| Campos | Texto, parágrafo, número, data, opções, checkbox, e-mail, telefone e URL; rótulos, obrigatoriedade, ocultação, somente leitura e mapeamento de papéis |
| Modelos | Texto copiado para a área de transferência; envio manual pelo usuário |
| Portabilidade | CSV com proteção contra interpretação de fórmulas; backup JSON completo e importação atômica; limpeza local explícita |
| WhatsApp | Painel isolado por Shadow DOM, identificação pelo cabeçalho visível da conversa e vínculo de contato confirmado |
| Google Sheets | Implementação de autorização por chrome.identity, seleção/criação de planilha, mapeamento, preparação explícita de IDs e leitura/gravação pela Sheets API; falta configurar o OAuth público e testar com contas reais |
| Qualidade | Testes de modelo/serviço, painel e dashboard, extensão MV3 em Chromium, auditoria estática e empacotamento com lista de arquivos permitidos |
| Distribuição | Código público, licença, política de privacidade inicial, CI e pacote local beta; loja e cobrança pendentes |

A demonstração só é inserida por ação explícita em base local vazia e usa contatos fictícios. Não há coleta de mensagens, envio automático, campanhas, API interna do WhatsApp, backend obrigatório no modo local, telemetria ou IA.

O suporte atual de integração é Google Sheets e campos configuráveis, incluindo URL. Compatibilidade com qualquer outra ferramenta depende de implementar e validar o conector correspondente.

## Evidências e alcance da validação

Base de código validada: commit [`3f100937bd52e3e938e75ae8d219b2ae569db42d`](https://github.com/rioclaro-dev/sheetdock-crm/commit/3f100937bd52e3e938e75ae8d219b2ae569db42d).

- Em 05/10/2026, **50 testes passaram**: 37 de modelo/serviço, 8 do painel, 4 do dashboard e 1 de extensão MV3 carregada em Chromium.
- O [CI dessa base](https://github.com/rioclaro-dev/sheetdock-crm/actions/runs/37387378932) concluiu com sucesso: instalação reproduzível, testes, auditoria, pacote e upload do artefato. O resultado e o commit foram reconferidos em 07/10/2026.
- Pacote local: `dist/sheetdock-crm-0.1.0-local-beta.zip`; pasta para carregar no Chrome: `dist/sheetdock-crm-local-beta`.
- ZIP conferido com 19 arquivos permitidos, CRC e conteúdo iguais à fonte. SHA256 reconferido em 07/10/2026:

```text
143259341fa7e756c28412b5115e46be22cb8adae240b0482d5027adce807d8f
```

- A preservação do projeto de origem foi verificada ao concluir a derivação em 05/10/2026: 53 hashes da extensão e estado Git permaneceram iguais. Esse resultado é evidência daquela entrega, não uma auditoria contínua do outro projeto.

O teste de extensão usa perfil temporário e uma página fictícia interceptada no endereço do WhatsApp. Sheets usa respostas controladas nos testes. **Não houve validação com WhatsApp autenticado, OAuth Google real ou planilha real, nem publicação na loja ou teste de pagamento.** As mudanças deste registro são de documentação.

Detalhes das verificações e limitações: [VALIDATION.md](VALIDATION.md).

## Limites que precisam continuar explícitos

1. **Google no pacote local:** o manifest de fonte não contém cliente OAuth nem chave de extensão. O modo local funciona; conectar Google depende de configuração nova do publicador. Não usar credenciais de outro projeto. O comprador final deverá apenas autorizar a conta e escolher/criar sua planilha.
2. **Permissão ampla:** o escopo atual é `https://www.googleapis.com/auth/spreadsheets`, que permite ler/editar todas as planilhas da conta. A seleção de arquivo na interface não reduz esse escopo. `drive.file` e Picker são uma possibilidade futura, não parte implementada deste beta.
3. **Concorrência Google:** verificação de conflito antes da gravação ajuda a detectar alterações, mas não é uma transação atômica. Duas edições externas simultâneas ainda podem conflitar.
4. **Estrutura e remoção Google:** a coluna ID precisa ser única e estável. Fórmulas/proteções são preservadas; validações dependentes de fórmulas/intervalos externos podem bloquear um campo. Remover linhas Google é uma ação feita diretamente na planilha.
5. **Identidade WhatsApp:** nome não comprova identidade e exige confirmação na sessão. Telefone duplicado limpa seleção automática. Mudança de cabeçalho/conversa invalida vínculo confirmado pela sessão anterior. O DOM do WhatsApp pode mudar.
6. **Dados locais:** pertencem ao perfil do navegador e podem ser perdidos ao remover a extensão ou limpar o perfil. Exportação periódica é necessária. Importar JSON regenera IDs e exige confirmar vínculos novamente; uma base vazia recebe o schema completo do backup.
7. **Privacidade e oferta:** política inicial e código público não substituem responsável comercial identificável, canal privado, operação de suporte, checkout ou termos da oferta.

## Próximas etapas, em ordem

| Etapa | Trabalho necessário | Evidência para concluir |
|---|---|---|
| 1. Identidade do produto | Confirmar marca, publicador, páginas de privacidade/suporte e canais | Identidade e URLs públicas corretas; política sem placeholders |
| 2. Google público | Criar configuração exclusiva do produto, ativar Sheets API, consentimento externo, ID estável da extensão e cliente OAuth; avaliar se o escopo amplo atende ao produto | Pacote com configuração nova, consentimento e verificação aplicável concluídos |
| 3. QA Google real | Autorizar conta nova, criar/escolher aba, mapear campos, preparar IDs, ler/gravar, ordenar linhas, testar conflitos/proteções, trocar/revogar conta | Registro dos fluxos e resultados, sem tokens ou dados pessoais |
| 4. QA WhatsApp e onboarding | Testar conta autorizada, grupos, homônimos, telefone ausente/duplicado, troca rápida de conversas, reabertura e troca de conta; pessoa nova usa sem assistência técnica | Evidência de cadastro/configuração e edição no contato correto |
| 5. Oferta e cobrança | Confirmar preço e modelo; implementar compra, ativação, cancelamento, reembolso, suporte e condições comerciais | Compra de teste e ciclo de assinatura/licença verificados |
| 6. Loja | Conta do publicador, materiais, declarações de dados/permissões, envio beta para testadores e análise da Chrome Web Store | Revisão concluída e instalação pelo endereço real da loja |
| 7. Operação | Acompanhar quotas/erros Google, mudanças de DOM, backup, incidentes e suporte | Procedimentos claros e critérios de manutenção |

O próximo bloco recomendado é **configuração Google do produto e validação externa do onboarding**. Antes de vender, concluir também cobrança, privacidade, suporte e aprovação da loja. Não substituir uma validação externa por fixtures ou afirmar que um pacote gerado já foi publicado.

## Benchmark e decisões comerciais pendentes

[BENCHMARK.md](BENCHMARK.md) guarda a pesquisa de 05/10/2026 com fontes oficiais de Cooby, Eazybe, WAPlus, Vepaar, Zapext, SheetWA e InboxCRM, preços observados e limitações da comparação. Revalidar planos, descontos, moeda e condições ao definir a oferta; os valores da pesquisa não são cotações atuais garantidas.

Pendências de decisão: nome definitivo, identidade/canais do publicador, preço final, assinatura ou outro modelo, recursos gratuitos versus serviço pago, provedor de cobrança, formato de suporte e eventual redução do escopo Google. Ainda não existe sistema de licenciamento ou checkout.

## Mapa do repositório

| Arquivo ou pasta | Responsabilidade |
|---|---|
| `manifest.json` | Manifest V3, permissões e recursos empacotados |
| `src/background.js` | Serviço CRM e mensagens entre interfaces, armazenamento e Sheets |
| `src/lib/model.js`, `keys.js`, `storage.js`, `sheets.js` | Modelo, identidade, persistência e acesso às planilhas |
| `src/content.js`, `src/overlay/` | Painel e leitura do cabeçalho visível do WhatsApp |
| `src/dashboard/`, `src/popup/` | Configurações, contatos e entrada da extensão |
| `tests/` | Regressões locais e fixtures fictícias |
| `scripts/check.mjs`, `scripts/package.mjs` | Auditoria e geração dos pacotes |
| `.github/workflows/ci.yml` | Verificação automática e artefato do pacote local |
| `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md` | Tratamento de dados, segurança e contribuição |
| `AGENTS.md` | Instruções para agentes e limites de trabalho |
| `docs/LAUNCH.md` | Checklist detalhado de lançamento e fontes oficiais |

## Retomar em outro chat/projeto

Abra a pasta deste repositório como projeto separado no Codex. Confirme que a raiz Git é `sheetdock-crm`, leia este registro e confira o estado atual antes de editar. Não continuar o CRM público no checkout do projeto privado de origem.

Prompt sugerido para iniciar a próxima frente:

```text
Vamos continuar o SheetDock CRM neste repositório separado. Leia AGENTS.md,
README.md, docs/CONTINUITY.md, docs/VALIDATION.md e docs/LAUNCH.md.
O objetivo é uma extensão Chrome de CRM para WhatsApp Web, configurável pelo
comprador, com dados locais ou na planilha Google dele, código MIT e futura
distribuição comercial. Preserve integralmente o projeto privado de origem.
Confira o estado atual do Git e proponha a próxima entrega concreta com base
nas pendências registradas. Prioridade: OAuth exclusivo do produto e onboarding
validado com Google e WhatsApp reais, mantendo credenciais e dados pessoais
fora do repositório. Não trate o beta, os testes locais ou o preço sugerido
como lançamento, aprovação externa ou oferta comercial já implementada.
```

Ao concluir a próxima entrega, atualizar este registro com commit, evidências, limitações e pendências remanescentes.
