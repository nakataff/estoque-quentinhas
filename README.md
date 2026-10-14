# Estoque da Cozinha

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
