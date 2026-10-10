# 🍼 Cantinho do Bebê — Sistema PDV

Sistema de Ponto de Venda (PDV) completo para loja de roupas de bebê, desenvolvido com **Electron** e **SQLite**.

---

## Funcionalidades

| Módulo | Descrição |
|---|---|
| **Caixa** | Tela de PDV com leitor USB, atalhos de teclado, multiplicador de quantidade (`3*código`), aviso de estoque, desconto (R$ ou %) e comprovante térmico 80mm |
| **Abertura e fechamento** | O caixa precisa ser aberto com o troco inicial. Sangria (retirada, ex.: depósito) e suprimento (reforço) com comprovante. No fechamento o sistema mostra quanto deve ter na gaveta, a diferença contada e os totais de PIX/débito/crédito para conferir com a maquininha |
| **Pagamento** | Dinheiro (com troco), PIX, débito, crédito (parcelas e código de autorização), fiado e vale-troca. Uma venda pode ser paga com mais de uma forma |
| **Clientes e fiado** | Cadastro de clientes, ficha com extrato, recebimento de pagamentos e comprovante para o cliente |
| **Trocas** | Devolução com ou sem o número da venda. Gera vale-troca (com código de barras) ou devolve em dinheiro/PIX. As peças voltam ao estoque |
| **Queima de estoque** | Preço especial para um número limitado de peças; quando acabam, volta ao preço normal |
| **Mercadorias** | Entrada de mercadoria por fornecedor, atualizando estoque e preço de custo, com etiquetas prontas para imprimir |
| **Produtos** | Cadastro com código de barras gerado ou lido da etiqueta do fornecedor (EAN), filtros de estoque |
| **Etiquetas** | Impressão de etiquetas com código de barras e preço ("de/por" na queima) |
| **Relatórios** | Vendas do dia, histórico mensal, fechamentos de caixa, conferência por forma de pagamento, mais vendidos, PDF |
| **Administrador** | Preço de custo, estoque, lucro mensal (já descontando trocas), estorno, troca de senha e backup |

### Maquininha de cartão

A maquininha da loja (SumUp Smart) não tem integração pública com sistemas externos. O caixa mostra o valor a passar na maquininha e registra a forma, as parcelas e o código de autorização; no fechamento os totais por forma ficam separados para conferir com o relatório da própria maquininha. A SumUp oferece integração automática (Cloud API) para a maquininha **SumUp Solo**.

### Atalhos do caixa

| Tecla | Ação |
|---|---|
| `F1` | Ir para o caixa |
| `F2` | Buscar produto por nome |
| `F4` | Desconto na venda |
| `Del` | Tirar o último item lançado |
| `F8` | Cancelar a venda atual |
| `F10` | Finalizar (abre o pagamento; `1`–`6` escolhem a forma) |
| `F11` | Tela cheia |

### Backup

O sistema guarda automaticamente uma cópia do banco por dia (últimos 30 dias) na pasta `backups`, dentro da pasta de dados indicada abaixo. Pelo painel do administrador também é possível salvar uma cópia em qualquer lugar (pendrive, nuvem).

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) v18 ou superior
- npm v9 ou superior
- Python 3 e compilador C++ (necessário para `better-sqlite3`)
  - **Windows:** `npm install -g windows-build-tools`
  - **Linux:** `sudo apt install build-essential python3`
  - **macOS:** Xcode Command Line Tools

---

## Instalação

```bash
# Clone o repositório
git clone https://github.com/rodrigo-de-carvalho/loja.git
cd loja

# Instale as dependências (o postinstall reconstrói o SQLite para Electron)
npm install
```

> O script `postinstall` executa automaticamente `electron-rebuild` para compilar o `better-sqlite3` para a versão correta do Electron.

---

## Executar

```bash
npm start
```

O aplicativo abre como janela desktop sem barra de navegador. O banco de dados SQLite é criado automaticamente na pasta de dados do usuário:
- **Windows:** `%APPDATA%\loja-bebe-pdv\loja-bebe.db`
- **Linux:** `~/.config/loja-bebe-pdv/loja-bebe.db`
- **macOS:** `~/Library/Application Support/loja-bebe-pdv/loja-bebe.db`

---

## Gerar instalador

```bash
npm run build
```

Gera o instalador na pasta `dist/`.

---

## Tecnologias

- [Electron](https://electronjs.org/) — framework desktop
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — banco de dados local
- [JsBarcode](https://github.com/lindell/JsBarcode) — geração de códigos de barras
- [jsPDF](https://github.com/parallax/jsPDF) — exportação em PDF

---

## Uso do Leitor de Código de Barras

Qualquer leitor USB HID (plug-and-play) funciona na tela de Caixa. O leitor envia o código e pressiona Enter automaticamente. Nenhuma configuração adicional é necessária.

---

## Licença

MIT
