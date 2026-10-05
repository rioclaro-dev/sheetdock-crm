# Validação do beta 0.1.0

Verificado em 05/10/2026. Resultado: **45 testes passaram**.

| Camada | Resultado | Evidência |
|---|---|---|
| Modelo e serviço | 33/33 | `node --test tests/core.test.js` |
| Painel WhatsApp em fixtures | 7/7 | `node tests/browser.test.cjs` |
| Central com serviço real em memória | 4/4 | `node tests/dashboard.test.cjs` |
| Extensão MV3 carregada no Chromium | 1/1 | `node tests/extension.test.cjs` |
| Auditoria de fonte | Passou | `node scripts/check.mjs` |
| ZIP local beta | Passou | CRC, 19 arquivos autorizados e conteúdo comparado com fonte |

O teste MV3 usa perfil temporário separado: carrega o service worker e o content script reais, cria e edita contato, confirma um telefone internacional e reinicia o navegador para verificar persistência. A página no endereço de WhatsApp é interceptada por uma fixture fictícia; não houve login em WhatsApp ou Google reais. Modo local não chamou serviços de dados externos nessa verificação.

Os testes de núcleo cobrem dados vazios, schema, IDs únicos, duplicidade de telefone, nomes apenas sugeridos, tipos, fórmulas, células protegidas, validações nativas, reidentificação após mover linhas, conflitos, troca de base, importação atômica, falha de persistência, limpeza explícita e preparação de IDs. As chamadas Sheets usam respostas fictícias controladas.

O ZIP contém somente manifest, fontes da extensão e ícones novos. Tem política de privacidade acessível dentro do pacote. Foi verificado que arquivos obsoletos no staging não entram em uma nova geração e que uma chave privada DER é rejeitada. Duas gerações com a mesma fonte produziram bytes idênticos.

SHA256 do ZIP `sheetdock-crm-0.1.0-local-beta.zip`:

```
5d3380048fa47e3e4285435112063f4ad871f838cf4e3dc48b86d965c3995097
```

O projeto de origem foi preservado: os hashes de 53 arquivos da extensão permaneceram idênticos e o estado Git anterior permaneceu igual. O novo repositório possui histórico independente e não inclui dados, demonstrativos, integração empresarial ou credenciais do projeto de origem.

## Pendências externas

OAuth público novo, autorização Google e gravação em planilha real; WhatsApp autenticado; teste com pessoa nova; identidade comercial e canais de suporte/privacidade; checkout e licenciamento; revisão e instalação pela Chrome Web Store. Nenhuma dessas etapas é comprovada pelos testes locais. Veja [plano de lançamento](LAUNCH.md).

Conflitos Sheets são verificados antes de gravar, mas a API não oferece CAS atômico nesse fluxo. Exclusão de linhas Google deve ser feita diretamente na planilha. Validações que dependem de fórmulas ou intervalos externos podem impedir alterações daquele campo pelo CRM.
