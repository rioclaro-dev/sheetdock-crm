# SheetDock CRM

CRM configurável para trabalhar ao lado do WhatsApp Web. Seus contatos ficam no navegador ou na sua própria planilha do Google Sheets. Você escolhe os campos, as etapas do funil e os modelos de texto.

**Status: beta de desenvolvimento.** Esta base ainda não está disponível para compra ou instalação pela Chrome Web Store. A integração Google de uma distribuição pública depende de configuração e verificação pelo publicador. Instalação, OAuth e uso em uma conta real do WhatsApp ainda precisam de validação externa antes do lançamento.

Nome provisório: **SheetDock CRM**. Código público: [rioclaro-dev/sheetdock-crm](https://github.com/rioclaro-dev/sheetdock-crm). Licença MIT, incluindo uso comercial.

**Para retomar o desenvolvimento:** leia o [registro de continuidade](docs/CONTINUITY.md), com estado, evidências, decisões e próximas etapas. As [instruções do projeto](AGENTS.md) orientam o trabalho nesta base separada.

## O que você pode configurar

- Campos de texto, parágrafo, número, data, opções, checkbox, e-mail, telefone e URL.
- Etapas do funil, cadastro de contatos e vínculo explícito entre uma conversa e um contato.
- Modelos de resposta que você copia e utiliza manualmente.
- Exportação dos registros em JSON e CSV, reimportação atômica de backup e exclusão local com confirmação. O backup restaura campos e valores somente leitura como snapshots; IDs são novos e vínculos de conversa precisam ser confirmados novamente.
- Modo local, que funciona sem conta Google, e conexão direta à Google Sheets API.

A instalação começa vazia. O modo de demonstração, quando acionado, usa contatos fictícios e identifica esses dados como demonstração. Não há conexão com um CRM privado nem dados de clientes pré-carregados.

A extensão usa a identidade disponível no cabeçalho da conversa aberta para ajudar você a selecionar um contato. Confirme o vínculo: um nome exibido no WhatsApp, por si só, não identifica uma pessoa de forma inequívoca. A extensão não sincroniza o conteúdo das mensagens nem envia respostas, campanhas ou mensagens em massa. Os modelos copiam texto; o envio continua sendo uma ação sua no WhatsApp.

## Começar no modo local

1. Instale a extensão e abra seu painel. Durante o desenvolvimento, use a instalação manual descrita abaixo.
2. Escolha o modo local e crie os campos que precisa. Cadastre seu primeiro contato ou experimente a demonstração fictícia.
3. Abra o WhatsApp Web, entre na sua conta normalmente e abra uma conversa.
4. No painel da extensão, selecione ou crie o contato correspondente e confirme o vínculo.
5. Atualize dados, etapa do funil e anotações enquanto conversa. Copie um modelo quando quiser preparar uma resposta.

Faça exportações periódicas. Os dados locais pertencem ao perfil do navegador: desinstalar a extensão, apagar o perfil ou limpar seu armazenamento pode removê-los. O modo local não é um serviço de backup na nuvem.

## Conectar sua planilha

Na versão pública configurada, o comprador não precisa criar projeto Google Cloud, chave ou cliente OAuth.

1. Abra as configurações e escolha Google Sheets.
2. Clique em conectar conta Google e leia a autorização antes de aceitar.
3. Cole o endereço de uma planilha que sua conta possa editar, ou use o botão para criar uma nova planilha.
4. Escolha a aba de dados e configure o mapeamento das colunas. Se faltarem identificadores, use **Preparar IDs da planilha**: após sua confirmação, o CRM acrescenta uma coluna quando necessário e preenche somente IDs vazios. IDs duplicados, fórmulas e destinos protegidos bloqueiam essa preparação.
5. Mapeie nome, telefone e os campos do CRM às colunas correspondentes. Confira os primeiros registros antes de começar a editar.
6. Abra uma conversa no WhatsApp Web e confirme qual registro deve ser vinculado.

**Permissão Google atual:** `https://www.googleapis.com/auth/spreadsheets`. Ela permite ler e editar todas as planilhas da conta autorizada. A seleção de uma planilha nas configurações define onde a extensão trabalha, mas não restringe a permissão concedida pelo Google. Esta versão não usa `drive.file`. A documentação oficial classifica o escopo atual como sensível; veja [escopos da Google Sheets API](https://developers.google.com/workspace/sheets/api/scopes).

A configuração do publicador é feita uma vez para a distribuição. Em um pacote de desenvolvimento sem cliente OAuth configurado, o botão Google informa essa limitação; o modo local continua disponível. Esse pacote não representa a experiência final de instalação da loja.

### Cuidados com dados compartilhados

- Não reutilize nem duplique o ID de um contato. A coluna ID é a referência para localizar sua linha, inclusive depois de ordenar a planilha.
- Células com fórmulas devem ser preservadas. Use colunas de entrada para campos editáveis e mantenha cálculos separados.
- A sincronização usa verificações de conflito antes de gravar, mas a API Sheets não fornece uma operação de comparação e gravação atômica para esse fluxo. Duas edições simultâneas ainda podem conflitar. Para equipes, teste o comportamento e coordene alterações no mesmo registro.
- Alterações na estrutura da planilha podem exigir um novo mapeamento. Ao ocorrer um erro, confira a planilha e atualize os dados antes de repetir a edição.

## Instalação manual para desenvolvimento

Pré-requisitos: Node.js e npm disponíveis, Chrome 116 ou superior para desktop e uma cópia deste código.

```sh
npm install
npm test
npm run test:browser
npm run check
npm run package
```

O pacote local gera a pasta `dist/sheetdock-crm-local-beta` e o arquivo `dist/sheetdock-crm-0.1.0-local-beta.zip`. No Chrome, abra `chrome://extensions`, ative o modo do desenvolvedor e use **Carregar sem compactação** para selecionar `dist/sheetdock-crm-local-beta`.

O pacote de desenvolvimento não contém configuração OAuth. Para preparar uma distribuição com credenciais novas do produto:

```sh
npm run package -- --client-id ID --public-key BASE64
```

`ID` é o cliente OAuth do tipo apropriado para a extensão; `BASE64` é a chave pública que mantém sua identidade estável. Não são segredos de cliente. Nunca forneça chave privada, token, senha ou credenciais de outro projeto. O pacote de distribuição aplica verificações estritas para bloquear segredos e configuração incompleta. Consulte [preparação do lançamento](docs/LAUNCH.md) antes de configurar OAuth ou publicar.

Com a configuração Google, o script gera `dist/sheetdock-crm-google-beta` e `dist/sheetdock-crm-0.1.0-google-beta.zip`. O publicador utiliza o ZIP na submissão à Chrome Web Store depois de concluir os requisitos de lançamento.

Os comandos acima são verificações locais. Eles não comprovam aprovação da loja, autorização OAuth de produção nem compatibilidade com uma conta real do WhatsApp.

## Dados, código aberto e distribuição comercial

Leia a [política de privacidade](PRIVACY.md) para entender armazenamento, acesso e remoção dos dados. Não há telemetria ou serviço de IA nesta base.

O código é disponibilizado sob [licença MIT](LICENSE). A proposta comercial é cobrar por conveniência de instalação, distribuição mantida, atualizações e suporte. **R$19,90/mês ou R$199/ano por usuário são hipóteses de preço**, não uma oferta ativa. Checkout, licenciamento e condições comerciais ainda não foram implementados.

Veja o [benchmark com fontes e limitações](docs/BENCHMARK.md) e os [itens necessários para lançamento](docs/LAUNCH.md).

SheetDock CRM é um projeto independente. WhatsApp e Google Sheets pertencem aos respectivos titulares. Este projeto não representa endosso ou parceria com essas empresas.
