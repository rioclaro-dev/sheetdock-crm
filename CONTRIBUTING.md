# Contribuir

Use Node.js 22 ou superior. Instale dependências com `npm install` e o navegador de teste com `npx playwright install chromium`.

Execute `npm test`, `npm run test:browser` e `npm run check` antes de propor uma mudança. Testes usam apenas contatos fictícios e não acessam WhatsApp ou planilhas reais.

O produto usa JavaScript e CSS locais, Manifest V3 e API Google Sheets direta. Não há backend obrigatório no modo local. Preserve chaves estáveis de campo, IDs únicos e gravação RAW. Configurações e clientes reais não devem ser adicionados ao repositório.

Mudanças de comportamento, permissões e tratamento de dados devem atualizar a documentação e a política de privacidade. Validação em fixtures não substitui uma validação com contas externas antes do lançamento.
