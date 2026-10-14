# Estoque - Quentinha da Guerreira

Painel de estoque da Quentinha da Guerreira, com identidade em preto e vermelho, adaptado a celulares, tablets e computadores.

## Compras, receitas e edições

- **Produtos:** estoque mínimo, estoque ideal, marca preferida e alternativa, preço estimado por unidade de medida, fornecedor e validade mais próxima. Sem ideal definido, a lista sugere manter duas vezes o mínimo.
- **Lista de compras:** adicionar produtos manualmente, ajustar quantidade, marca, fornecedor e orçamento; copiar a lista completa para o WhatsApp.
- **Compra recebida:** quantidade recebida, preço pago por kg/unidade/etc., data, marca e fornecedor. O total é calculado em centavos. Confirmar dá entrada no estoque e registra o gasto; uma compra parcial mantém o restante planejado na lista.
- **Compras e gastos:** semana, mês, todo o período ou datas escolhidas; valor pago, diferença para valores previstos e custo estimado de descartes. Compras estornadas não entram nos totais. Exportação CSV de compras.
- **Validade:** alerta para datas vencidas ou nos próximos três dias, e filtro no estoque. É uma data de referência por produto, **não um controle de lotes**. Informe a menor data e ajuste quando aquela embalagem/lote acabar. Uma nova entrada preserva a menor validade conhecida enquanto ainda houver saldo.
- **Perdas:** saídas podem ser identificadas como vencimento, dano ou descarte. O custo da perda usa o preço do produto e fica separado do total de compras.
- **Receitas:** informe produto final em `un`, rendimento, ingredientes e embalagens, cada um na sua própria unidade. O custo inclui ingredientes e embalagens; não inclui mão de obra, gás, entrega ou margem. Preços ausentes tornam o custo parcial.
- **Produção:** confere ingredientes, dá baixa em todos e registra a entrada de quentinhas numa única gravação. Consumos proporcionais são arredondados para cima na precisão de 0,001 da unidade. Se a receita mudou em outro aparelho depois de abrir a conferência, a produção é recusada até revisar.
- **Categorias personalizadas:** ficam disponíveis no cadastro e nos filtros.
- **Desfazer/refazer edições:** funciona em edições de produtos, listas, categorias e receitas. O histórico é compartilhado entre aparelhos. A operação compara o estado atual antes de reverter e recusa sobrescrever mudanças posteriores. Uma nova edição descarta a pilha de refazer. Criação/arquivamento de produto e movimentações não entram nessa pilha; as movimentações têm estorno próprio no Histórico.
- **Estorno de produção:** devolve todos os ingredientes e retira as quentinhas juntas. Se o saldo de quentinhas não permitir a reversão, o sistema recusa o estorno. Não é permitido estornar só um ingrediente da produção.

Os novos dados são registrados como eventos adicionais no histórico do mesmo banco. O formato básico de produtos e movimentos é preservado, assim como as regras já publicadas. A atualização não apaga ou reinicializa o estoque existente. Esta ampliação está disponível na versão **Firebase / GitHub Pages**; a versão Python abaixo conserva o controle básico.

## Opção principal: GitHub Pages + Firebase separado

O frontend está preparado para GitHub Pages, com Firebase Authentication e Realtime Database em um projeto exclusivo deste estoque. Nenhum projeto do Central Free Fire é utilizado.

**Situação atual:** código e workflow prontos; app Web, endereço do Realtime Database e UID de acesso registrados. GitHub Pages configurado e a primeira publicação concluída; as regras e os usuários do Firebase são administrados pelo proprietário. O frontend é publicado automaticamente após mudanças no repositório e testes aprovados. É necessário concluir a configuração abaixo. O endereço final será informado pelo próprio workflow após uma publicação bem-sucedida.

### Criar o Firebase

1. Abra https://console.firebase.google.com/ e crie um projeto novo, por exemplo `estoque-quentinhas`. Analytics não é necessário para o painel.
2. Cadastre um aplicativo **Web** nas configurações do projeto. Guarde o objeto público `firebaseConfig`.
3. Crie um **Realtime Database** em modo bloqueado. Copie a `databaseURL` dele para o objeto `firebaseConfig`; esta URL não é do Firestore.
4. Em **Authentication**, habilite **E-mail/senha** e crie uma conta para acessar o estoque. Você pode criar contas separadas para familiares: todos os usuários autorizados veem o mesmo estoque.
5. Em Realtime Database > Regras, publique o conteúdo de `firebase/database.rules.json`.
6. O UID inicial informado pelo proprietário já está autorizado no arquivo de regras. Para autorizar outras contas, copie seus UIDs em Authentication > Users e, na aba Dados do Realtime Database, crie `members/<UID>` com valor booleano `true`. Somente contas autorizadas conseguem ler e escrever o estoque.
7. Em Authentication > Settings > Authorized domains, adicione `nakataff.github.io`.

Use somente a configuração pública do app Web. Não coloque senha, chave privada ou credenciais de conta de serviço no repositório. Um exemplo está em `firebase/firebase-config.example.json`.

### Conectar ao GitHub Pages

1. No repositório, abra Settings > Secrets and variables > Actions > **Variables**.
2. A configuração pública está em `firebase/firebase-config.json`. Depois de criar o banco, adicione a `databaseURL` a esse arquivo. Opcionalmente, a variável `FIREBASE_CONFIG` com o JSON completo pode substituir o arquivo.
3. Abra Settings > Pages e selecione **GitHub Actions** como fonte de publicação.
4. Abra Actions > **Publicar no GitHub Pages** > Run workflow.
5. Após o workflow concluir, use o link publicado no ambiente `github-pages`.

O workflow publica apenas a pasta `static`, gera a configuração a partir do arquivo público ou da variável e falha com uma mensagem clara se ela estiver incompleta. Mudanças no código, testes ou configuração pública disparam a publicação automaticamente. O botão Run workflow continua disponível para publicar novamente.

GitHub Pages de repositórios privados depende do plano da conta. Se a página de configuração exigir upgrade, você pode optar por tornar o repositório público ou usar Firebase Hosting. O código público não dá acesso aos dados: o banco exige login e autorização por UID. A mudança de visibilidade não é feita automaticamente.

### Como funciona a sincronização

O Firebase é o único banco da versão Pages. A tela consulta o estoque a cada 10 segundos e ao voltar para a página. Cada gravação usa a versão do banco (ETag / If-Match): caso outro aparelho altere o saldo, a operação lê o estoque atualizado e tenta novamente. Reenvios usam o mesmo código da movimentação para evitar duplicação.

As sessões do Firebase ficam no navegador, com renovação do token. O botão **Sair** remove a sessão daquele aparelho. O código de acesso nunca é embutido no HTML; cada pessoa entra com e-mail e senha. Contas autorizadas têm permissão para administrar o estoque da família.

Esta versão lê e grava o estoque inteiro de forma atômica. É adequada para uma pequena cozinha; um histórico muito grande aumenta o tráfego. Consulte os limites do plano contratado e faça backups periódicos exportando o JSON pelo console do Realtime Database. O CSV serve para consulta e não restaura sozinho todo o banco.

As operações de estoque são testadas localmente e a concorrência HTTP é simulada. A integração real com Firebase e as regras precisam ser verificadas após conectar um projeto. Nenhuma afirmação de publicação ou banco ativo é feita antes disso.

### Testes

```bash
node --test tests/*.test.cjs
node --check static/app.js
node --check static/cloud.js
```

---

# Versão Python / SQLite

Painel em português para administrar ingredientes, embalagens e quentinhas prontas. Layout adaptado a celulares, tablets e computadores, com botões grandes e foco no uso diário.

## O que já funciona

- Cadastro e edição de produtos, categorias, unidades e estoque mínimo.
- Registro de entradas e saídas, com observação opcional.
- Quantidades com até três casas decimais, armazenadas como inteiros para evitar erros de arredondamento.
- Avisos de estoque baixo e produtos em falta.
- Lista de compras que pode ser copiada para o WhatsApp.
- Histórico, estornos e exportação CSV do estoque e do histórico completo.
- Arquivamento de produtos sem saldo, preservando o histórico.
- Login por senha compartilhada da cozinha, sessão por aparelho e botão de sair.
- Atualização a cada 10 segundos, também ao voltar para a página.
- Banco SQLite central com transações, impedindo saídas acima do saldo e erros de concorrência entre dispositivos.
- Reenvio da mesma movimentação não duplica a saída nem a entrada.

## Importante: repositório não é hospedagem

Este repositório guarda o código. **Para acessar o mesmo estoque em vários dispositivos, execute uma única instância do sistema em um servidor com HTTPS e armazenamento persistente.** Todos os aparelhos devem abrir o mesmo endereço. GitHub Pages não executa este backend.

Não existe banco ou endereço de produção provisionado por este repositório. Nenhum dado de exemplo é cadastrado automaticamente.

## Testar no computador

Requer Python 3.12 ou superior. No PowerShell, na pasta do projeto:

```powershell
$env:APP_PASSWORD = Read-Host 'Defina uma senha (12 caracteres ou mais)'
$env:COOKIE_SECURE = 'false'
python app.py
```

Abra `http://127.0.0.1:8000` e use a senha definida. O servidor deste comando é apenas para desenvolvimento. Por padrão ele escuta somente no próprio computador.

No Linux/macOS:

```bash
read -rs APP_PASSWORD
export APP_PASSWORD
export COOKIE_SECURE=false
python app.py
```

A variável `.env` não é lida automaticamente pelo comando `python app.py`; configure as variáveis do ambiente conforme acima.

## Publicar para uso da família

O backend é WSGI e inclui um Dockerfile. A hospedagem precisa fornecer:

1. Um endereço HTTPS acessível pela família.
2. Uma única instância/contêiner com volume de disco persistente em `/data`. Vários processos Gunicorn na mesma instância são suportados; réplicas em servidores diferentes não compartilham SQLite.
3. `APP_PASSWORD`: senha forte, de pelo menos 12 caracteres, definida nas variáveis secretas da hospedagem.
4. `DATABASE_PATH=/data/estoque.sqlite3` e `COOKIE_SECURE=true`.
5. Porta HTTP definida em `PORT`, caso o provedor exija uma porta específica.

Com Docker Compose em um servidor próprio:

```bash
cp .env.example .env
# Preencha APP_PASSWORD no .env sem adicioná-lo ao Git.
docker compose up -d --build
```

O Compose expõe a porta apenas em `127.0.0.1`. Configure um proxy HTTPS no servidor para encaminhar para `127.0.0.1:8000`. Para testes locais por HTTP, configure `COOKIE_SECURE=false` no `.env`.

Sem Docker:

```bash
python -m pip install -r requirements.txt
# Configure APP_PASSWORD e DATABASE_PATH em um diretório persistente.
gunicorn --bind 0.0.0.0:8000 --workers 2 --threads 4 'app:create_app()'
```

Não use disco temporário de hospedagem: os dados sumiriam ao reiniciar ou publicar novamente. Não remova o volume `estoque_data`. O endpoint `/health` permite verificar o serviço sem expor os dados.

## Como sua mãe usa

1. Abra o endereço do sistema e entre com a senha da cozinha.
2. Toque em **Cadastrar produto**. Informe nome, categoria, unidade, quantidade atual e mínimo.
3. Ao comprar um item, toque em **Entrou**. Ao usar, vender ou descartar, toque em **Saiu**.
4. Confira a **Lista de compras** para repor o que chegou ao mínimo.
5. Se errar uma movimentação, abra o **Histórico** e toque em **Desfazer**. O sistema registra um estorno sem apagar o lançamento original.

A unidade de um produto não pode mudar após o cadastro, para preservar os saldos e o histórico. Cadastre outro produto se precisar usar outra unidade. O sistema não converte kg/g automaticamente, não calcula receitas nem dá baixa de ingredientes automaticamente ao vender uma quentinha.

O navegador precisa de internet. Ao perder conexão, mostra um aviso; não salva lançamentos offline. Se uma resposta falhar após o servidor registrar uma movimentação, tente novamente na mesma janela: o código da operação evita duplicação. Verifique o histórico antes de abrir outro lançamento.

Você pode usar “Adicionar à tela inicial” no navegador. Não há cache offline dos dados.

## Segurança e backup

A senha fica na configuração do servidor e nunca é enviada no código do navegador. A sessão usa cookie HttpOnly e SameSite, e as alterações exigem token CSRF. Há limite global de 12 tentativas de login a cada 5 minutos. A senha é compartilhada; o histórico não identifica pessoas individualmente. Alterar `APP_PASSWORD` e reiniciar o serviço invalida as sessões anteriores.

Exportações CSV ajudam na consulta, mas não substituem backup restaurável. Faça backup periódico do banco com a API SQLite, que preserva uma cópia consistente mesmo com o app em uso:

```bash
python -c "import sqlite3; source=sqlite3.connect('/data/estoque.sqlite3'); backup=sqlite3.connect('/data/backup.sqlite3'); source.backup(backup); backup.close(); source.close()"
```

Guarde uma cópia desse backup fora do servidor. Para restaurar, pare o serviço, preserve uma cópia do banco atual e seus arquivos WAL/SHM, coloque o backup no caminho `DATABASE_PATH`, ajuste o proprietário do arquivo e reinicie.

## Verificação

```bash
python -m unittest discover -s tests -v
node --check static/app.js
```

Os testes cobrem login, CSRF, persistência entre sessões, concorrência, idempotência, estornos, valores inválidos e exportação. O GitHub Actions executa as verificações a cada push e pull request.
