# Preparação de lançamento

Atualizado em 5 de outubro de 2026. Esta base é um beta de desenvolvimento. Build, ZIP, testes locais e repositório público não comprovam instalação pela loja, autorização Google de produção nem compatibilidade com uma conta real do WhatsApp.

## Caminho do comprador

A experiência pretendida é instalar pela Chrome Web Store, abrir o painel, utilizar modo local ou autorizar Google, escolher/criar a planilha, mapear as colunas e começar. O comprador não deve precisar criar cliente OAuth, editar manifesto, copiar código Apps Script ou configurar um backend.

O modo local deve continuar funcional sem Google. A primeira execução deve estar vazia. Dados de demonstração só entram por ação explícita e devem ser identificados como fictícios.

## OAuth configurado pelo publicador

1. Criar um projeto Google Cloud exclusivo deste produto, habilitar Sheets API e configurar a tela de consentimento para usuários externos.
2. Preparar domínio e páginas públicas exigidos para identificação, privacidade e suporte.
3. Definir a identidade estável da extensão e criar o cliente OAuth correspondente. O publicador configura o cliente uma vez; compradores usam esse fluxo pela interface.
4. Usar credenciais novas deste produto. Não reutilizar IDs, chaves ou projetos de outra extensão.
5. Preparar o pacote com `npm run package -- --client-id ID --public-key BASE64`. A chave fornecida é pública; nunca colocar chave privada ou segredo de cliente no pacote.
6. Completar a verificação aplicável ao aplicativo e ao escopo antes de uma distribuição para o público geral.
7. Testar autorização, cancelamento, expiração, desconexão, revogação e troca de conta com contas novas para o produto.

**Escopo atual:** `https://www.googleapis.com/auth/spreadsheets`, classificado como sensível. Ele dá acesso a todas as planilhas da conta; escolher um arquivo na interface não reduz essa autorização. A base atual não implementa `drive.file`. Uma migração futura para acesso por arquivo exigirá criação pelo aplicativo ou seleção autorizada, como Google Picker, e validação do fluxo. [Documentação de escopos](https://developers.google.com/workspace/sheets/api/scopes), [seleção por Picker](https://developers.google.com/chart/interactive/docs/spreadsheets).

O pacote gerado apenas com `npm run package` é de desenvolvimento, sem OAuth configurado. O erro de configuração no botão Google desse pacote é esperado e precisa ser claro. Não distribuí-lo como uma versão pronta para conectar planilhas.

### Quotas e custos Google

A [documentação de limites da Sheets API](https://developers.google.com/workspace/sheets/api/limits), atualizada em 3 de setembro de 2026, publica quotas padrão de 300 leituras e 300 gravações por minuto por projeto, e 60 de cada por usuário/projeto. Os compradores que usam o mesmo projeto OAuth compartilham a quota do projeto. Conferir as quotas efetivas no projeto do publicador e testar tratamento de `429`, tentativas com espera crescente e redução de chamadas repetidas.

Na data da pesquisa, o uso padrão é descrito como sem custo adicional; o documento também prevê cobrança por excedente mais tarde em 2026. Não anunciar Google ilimitado ou gratuito para sempre. Revalidar preços e quotas antes de fixar a oferta comercial ou atender equipes maiores.

## Integridade e concorrência dos dados

- Exigir coluna ID com valores únicos, estáveis e não vazios, e rejeitar ambiguidades antes de gravar.
- Conferir mapeamento de campos, cabeçalhos, seleção de aba e tipos com uma planilha nova e uma existente.
- Proteger fórmulas contra substituição; testar células com fórmula e texto semelhante a fórmula. Manter colunas calculadas separadas dos campos editáveis.
- Testar ordenação, inserção/remoção de linhas e alteração da estrutura entre leitura e gravação.
- Mostrar conflito e preservar dados quando uma verificação detectar mudança externa.
- Comunicar o limite: as verificações são best effort. Sheets não oferece comparação e gravação atômica para esse fluxo; outra gravação pode ocorrer entre a verificação e o envio. Não anunciar prevenção absoluta de conflitos.
- Conferir exportações JSON/CSV, caracteres especiais, campos vazios, delimitadores, Unicode e conteúdo que possa ser interpretado como fórmula por um editor de planilhas.
- Validar reimportação do próprio JSON exportado: novos registros recebem novos IDs; esclarecer o que é recuperado e o que exige configuração manual.
- Exclusão individual e limpeza local com confirmação estão implementadas e passaram em testes. Validar também com pessoa nova. Linhas Google são removidas diretamente na planilha.

## WhatsApp Web

Validar em conta real, com autorização do testador, o painel, identificação do cabeçalho, vínculo explícito e troca de conversas. Testar nome repetido, contato desconhecido, conversa sem telefone disponível, grupos, reabertura de aba e mudança de conta. Não gravar em um contato anterior depois de trocar de conversa.

O produto deve permanecer centrado em acompanhamento manual. Modelos copiam texto; não há sincronização de mensagens, campanhas, envio em massa, respostas automáticas ou IA.

O [WhatsApp informa que práticas automáticas ou em massa não autorizadas violam seus termos](https://faq.whatsapp.com/5957850900902049/?category=5245250&locale=pt_BR). A existência de extensões de terceiros não prova autorização da Meta. Mudanças no WhatsApp Web podem quebrar a integração; preparar procedimento de suporte e correção, sem prometer ausência de bloqueio.

## Chrome Web Store

O publicador precisa [registrar a conta e pagar a taxa única](https://developer.chrome.com/docs/webstore/register/), conferir seu valor no painel, verificar e-mail e completar dados do publicador. Produtos com compras, recursos pagos ou assinaturas precisam informar endereço físico conforme as [instruções oficiais](https://developer.chrome.com/docs/webstore/set-up-account/).

A página da loja deve explicar finalidade única, permissões, política de privacidade, compras e limites do produto. Declarar tratamento de contatos e dados mesmo quando ficam apenas no dispositivo. Solicitar as permissões mínimas para os recursos implementados. [Políticas da loja](https://developer.chrome.com/docs/webstore/program-policies/policies), [FAQ sobre dados locais](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/).

Manter a lógica executável no pacote. Manifest V3 permite comunicação para obter dados ou realizar operações de servidor, mas restringe código remoto, `eval` e interpretação de comandos remotos. [Requisitos MV3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).

Fazer primeiro distribuição privada para testadores. Todas as modalidades de visibilidade passam pelas mesmas políticas e análise. [Distribuição e testes](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## Pagamento e código aberto

Checkout e licenciamento ainda não foram implementados. O publicador deve preparar cobrança externa, autenticação de compras, cancelamento, reembolso, registros e tributos. O [acordo da loja](https://developer.chrome.com/docs/webstore/program-policies/terms) atribui essas responsabilidades ao desenvolvedor e exige suporte para produtos pagos em até três dias úteis, ou 24 horas para preocupações urgentes apresentadas pelo Google.

Definir uma oferta concreta e clara. R$19,90/mês e R$199/ano por usuário são hipóteses para serviços de distribuição mantida e suporte. Não cobrar retroativamente por uma cópia que foi anunciada como gratuita; descrever versão gratuita, teste e serviço pago de forma consistente.

O código MIT pode ser utilizado e redistribuído, inclusive comercialmente, por terceiros. Antes da publicação, conferir direitos sobre os arquivos copiados e avisos das dependências. Não levar histórico Git, segredos, dados pessoais ou credenciais de outro projeto ao repositório público.

## Privacidade e operação

Finalizar a [política de privacidade](../PRIVACY.md) com responsável identificável e canal privado de atendimento. Incluir os fornecedores realmente utilizados se houver cobrança ou suporte externo. Não anunciar que nenhum dado deixa o dispositivo quando o usuário pode conectar Google.

No Brasil, agentes de pequeno porte dispensados de encarregado ainda precisam disponibilizar canal para titulares e adotar medidas de segurança, conforme a [ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022). Definir responsabilidades sobre cadastros de clientes, retenção, exportação, remoção e incidentes conforme a operação efetiva.

## Evidências necessárias para liberar vendas

| Item | Evidência esperada | Situação inicial |
|---|---|---|
| Testes locais | `npm test`, `npm run test:browser` e `npm run check` sem falhas | 45/45 testes locais e auditoria passaram; veja VALIDATION.md |
| Pacote | ZIP inspecionado, sem dados pessoais ou segredos | ZIP local beta conferido: 19 arquivos e CRC válidos; veja VALIDATION.md |
| Onboarding | Pessoa nova instala e cadastra contato sem assistência técnica | Pendente |
| WhatsApp real | Conta autorizada usada no fluxo completo, inclusive troca de conversa | Pendente |
| Google real | Conta nova autoriza, cria/escolhe planilha, lê, grava e revoga acesso | Pendente |
| OAuth público | Configuração e verificação aplicável concluídas | Pendente |
| Publicação | Revisão da loja concluída e instalação pelo endereço da loja | Pendente |
| Privacidade e suporte | Responsável, canal privado, páginas e processo definidos | Pendente |
| Cobrança | Compra de teste, ativação, cancelamento e suporte verificados | Não implementada |

Atualize essa tabela com evidências verificáveis. Testes com mocks e interface local ajudam a encontrar erros, mas não substituem validação nas plataformas externas.
