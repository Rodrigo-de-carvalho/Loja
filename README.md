# 🍼 Cantinho do Bebê — Sistema PDV

Sistema de Ponto de Venda (PDV) completo para loja de roupas de bebê, desenvolvido com **Electron** e **SQLite**.

---

## 📥 Baixar o aplicativo (Windows)

O instalador é gerado automaticamente a cada atualização e fica disponível na página de **Releases**:

👉 **[Baixar a versão mais recente](https://github.com/Rodrigo-de-carvalho/Loja/releases/latest)**

1. Baixe o arquivo `Cantinho-do-Bebe-PDV-Instalador.exe`
2. Execute e siga o assistente (pode escolher a pasta de instalação)
3. Um atalho é criado na Área de Trabalho e no Menu Iniciar

> Os dados ficam salvos localmente e um **backup automático diário** é mantido em
> `%APPDATA%\cantinho-do-bebe-pdv\backups` (últimos 14 dias).

---

## Funcionalidades

| Módulo | Descrição |
|---|---|
| **Produtos** | Cadastro com nome, preço de custo, preço de venda e geração automática de código de barras |
| **Etiquetas** | Impressão de etiquetas com código de barras e preço em papel adesivo |
| **Caixa** | Leitura via leitor USB ou digitação manual, carrinho com controle de quantidade, finalização de venda |
| **Relatórios** | Vendas do dia, histórico mensal, lucro mensal com exportação em PDF |

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
