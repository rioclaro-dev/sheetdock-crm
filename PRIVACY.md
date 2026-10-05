# Política de privacidade — SheetDock CRM

Atualizada em 5 de outubro de 2026. Aplica-se à base de desenvolvimento descrita neste repositório.

**A distribuição comercial ainda não foi lançada.** A identidade do responsável comercial e um canal privado de privacidade deverão ser informados antes da distribuição pública. Este documento não afirma aprovação da Chrome Web Store ou verificação OAuth pelo Google.

## Dados usados pela extensão

A extensão utiliza os dados que você cadastra: contatos, campos personalizados, etapas de funil, modelos de texto e vínculos entre conversas e registros. Esses dados podem incluir nome, telefone, e-mail e outras informações que você decida registrar.

No WhatsApp Web, a extensão utiliza a identidade apresentada no cabeçalho da conversa aberta para ajudar a encontrar ou vincular um contato. Telefone exato e único pode identificar um registro; nomes requerem confirmação explícita por conversa. Ela não importa o histórico da conversa, não sincroniza o conteúdo das mensagens e não envia mensagens.

Ao conectar Google Sheets, a extensão acessa a planilha e a aba configuradas para carregar, criar e editar registros. As requisições vão diretamente às APIs do Google, usando a conta que você autorizou. A extensão não utiliza um banco de dados operado pelo fornecedor para guardar seus contatos.

## Onde os dados ficam

| Informação | Armazenamento |
|---|---|
| Contatos criados no modo local | `chrome.storage.local`, no perfil do navegador |
| Configurações, definição de campos, etapas, modelos e vínculos de conversas | `chrome.storage.local`, no perfil do navegador |
| Registros conectados ao Google Sheets | Sua planilha Google; cópia de trabalho em memória durante o uso |
| Exportações JSON/CSV | Arquivo que você salva no dispositivo |
| Autorização Google | Gerenciada pelo fluxo `chrome.identity`; usada para acessar a API |

Os registros lidos da planilha não são persistidos como uma cópia local do banco Google. Vínculos e configurações podem conter identificadores e referências a esses registros, e permanecem no armazenamento local até remoção.

`chrome.storage.local` não equivale a um cofre com senha própria nem a um backup. Quem tiver acesso ao seu perfil ou dispositivo pode conseguir acessar os dados locais. Proteja o dispositivo, o perfil do navegador e os arquivos exportados. A [documentação do Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage) descreve a persistência local e a remoção do armazenamento quando a extensão é desinstalada.

## Permissão Google

O escopo atual é `https://www.googleapis.com/auth/spreadsheets`. Ele autoriza leitura e edição de todas as planilhas da conta autorizada. Embora a extensão trabalhe na planilha configurada, o consentimento OAuth não se limita a ela. A versão atual não usa a permissão por arquivo `drive.file`.

A conexão é opcional: o modo local funciona sem Google. Você pode encerrar a conexão na extensão e revogar o acesso em sua conta Google. Revogar acesso não apaga os registros que já estão em sua planilha.

## Compartilhamento e finalidades

Os dados servem para as funções do CRM que você aciona. A base não inclui telemetria, publicidade, venda de dados ou processamento por IA. Não encaminha contatos ou conversas para servidores de licenciamento ou cobrança.

Se você optar pela integração, o Google recebe as requisições necessárias às operações na planilha. O uso de Google e WhatsApp também está sujeito às condições e políticas desses serviços. Ao compartilhar sua planilha ou exportações, você determina quem terá acesso aos dados.

Qualquer futura integração de cobrança, suporte, telemetria ou outros fornecedores exigirá descrição específica e atualização desta política antes de uso. A configuração de uma URL ou campo no CRM não autoriza compartilhamento automático com serviços externos.

## Exportação e remoção

Você pode exportar os registros em JSON ou CSV. Guarde esses arquivos em um local protegido e confira o conteúdo antes de compartilhá-los.

No modo local, a ficha permite excluir um contato e seus vínculos após confirmação. Em Configurações, Apagar dados deste navegador remove contatos, campos, modelos e configurações da extensão após confirmação. A opção exige desconectar o Google antes. Planilhas do Google são preservadas. Desinstalar a extensão também remove seu armazenamento local; exporte um backup antes de remover dados.

No modo Google, exclusão ou edição de registros da planilha depende das ações realizadas na própria planilha ou nas funções disponibilizadas pela extensão. Limpar os dados do navegador, desconectar Google ou desinstalar a extensão não apaga automaticamente a planilha. Excluir uma cópia exportada também não remove o registro de origem.

## Responsabilidades e contato

Você decide quais dados registra e como utiliza o CRM. Antes de cadastrar dados de terceiros, considere sua autorização e as obrigações aplicáveis à sua atividade. A possibilidade de criar campos arbitrários não transforma esta base em uma solução certificada para dados sensíveis ou regulados.

O canal privado de privacidade e a identificação do responsável pela operação comercial estão pendentes. Essa definição é um requisito de lançamento. Para relatar um problema técnico no repositório, descreva o comportamento usando dados fictícios; não publique contatos, conteúdo de conversas, tokens ou exportações pessoais.
