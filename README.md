# 🍼 Cantinho do Bebê — Sistema PDV

Sistema de Ponto de Venda (PDV) completo para loja de roupas de bebê, desenvolvido com **Electron** e **SQLite**.

---

## Funcionalidades

| Módulo | Descrição |
|---|---|
| **Caixa** | Tela de PDV com leitor USB, atalhos de teclado, multiplicador de quantidade (`3*código`), aviso de estoque, desconto (R$ ou %), troco no dinheiro e comprovante térmico 80mm |
| **Produtos** | Cadastro com código de barras gerado automaticamente ou lido da etiqueta do fornecedor (EAN), filtros de estoque baixo/zerado |
| **Etiquetas** | Impressão de etiquetas com código de barras e preço, inclusive uma por peça em estoque |
| **Relatórios** | Vendas do dia, histórico mensal, conferência por forma de pagamento, produtos mais vendidos, exportação em PDF |
| **Administrador** | Preço de custo, ajuste de estoque, lucro mensal, estorno de vendas (o registro é mantido), troca de senha e backup |

### Atalhos do caixa

| Tecla | Ação |
|---|---|
| `F1` | Ir para o caixa |
| `F2` | Buscar produto por nome |
| `F4` | Desconto na venda |
| `Del` | Tirar o último item lançado |
| `F8` | Cancelar a venda atual |
| `F10` | Finalizar (abre o pagamento; `1`–`4` escolhem a forma) |
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
