# Análise Completa — Cantinho do Bebê PDV

**Data:** 12/07/2026 · **Escopo:** todo o código do repositório (`main.js`, `database.js`, `preload.js`, `renderer/`)

## Visão geral

O sistema é um PDV desktop em Electron + SQLite (better-sqlite3), com boa base arquitetural:
`contextIsolation` ativado, `nodeIntegration` desligado, comunicação via `contextBridge`/IPC,
queries sempre parametrizadas (sem SQL injection), transações nas operações de venda e WAL ativado.
A UI é organizada, o fluxo de caixa é funcional e os relatórios em PDF são bem cuidados.

Abaixo, os pontos que precisam melhorar, ordenados por gravidade.

---

## 🔴 Críticos (segurança e integridade de dados)

### 1. As funções de admin NÃO são protegidas no backend
O comentário em `main.js:47` diz "protegido no nível do banco", mas isso não acontece.
`verificarAdmin` apenas retorna `true/false`, e a variável `isAdmin` vive **só no renderer**
(`app.js:13`). Os handlers IPC `admin:atualizarCusto`, `admin:atualizarEstoque`,
`vendas:cancelar` e `vendas:lucro` executam **sem nenhuma verificação de sessão** no processo main.
Qualquer código no renderer pode chamá-los direto (ex.: `electronAPI.lucroMensal(7, 2026)`)
sem nunca ter feito login.

**Correção:** manter o estado de sessão admin no processo **main** (ex.: `verificarAdmin` seta um
flag/token no main; os handlers sensíveis checam esse flag antes de executar; logout limpa o flag).

### 2. A regra "estoque só pelo admin" é burlada pela tela de edição de produto
Em `app.js:231`, o formulário comum de "Editar Produto" (acessível a qualquer operador) chama
`api.adminAtualizarEstoque(...)`. Ou seja, qualquer operador altera estoque livremente —
a restrição de admin é só aparência. Combina com o item 1: decidir se estoque é ou não
privilégio de admin e aplicar a regra no main.

### 3. Venda sem validação de estoque + estorno infla o estoque
- `finalizarVenda` (`database.js:132`) não verifica estoque disponível: vende com estoque 0 e o
  `MAX(0, estoque - ?)` **cala o problema silenciosamente** (o débito que não coube some sem registro).
- `cancelarVenda` (`database.js:213`) devolve a quantidade **integral** dos itens. Se na venda o
  estoque foi truncado em 0 (deduziu menos do que vendeu), o estorno devolve mais do que saiu →
  **estoque inflado e divergente do físico**.

**Correção:** dentro da transação de venda, checar `estoque >= quantidade` (bloquear ou exigir
confirmação); no estorno, devolver apenas o que foi de fato deduzido.

### 4. Estorno apaga a venda — sem trilha de auditoria
`cancelarVenda` faz `DELETE`. Depois do estorno não existe registro nenhum: não dá para saber
quem estornou, quando, nem quanto. Numa loja isso é a porta clássica para fraude de caixa
(vender em dinheiro → estornar → embolsar).

**Correção:** trocar `DELETE` por um campo `status` (`concluida`/`estornada`) + `estornada_em`,
filtrar vendas estornadas dos relatórios de receita e criar um relatório de estornos real
(hoje a aba "Estornos" lista vendas ativas, não estornos já feitos).

### 5. Total da venda é calculado no renderer e aceito sem conferência
`finalizarVenda` grava o `total` que o renderer mandar. Qualquer bug (ou adulteração) faz o total
divergir da soma dos itens, corrompendo todos os relatórios. O mesmo vale para `preco_unitario`
e `preco_custo` dos itens, que vêm do carrinho.

**Correção:** no main/DB, recalcular preços e total a partir dos produtos no banco no momento da
venda, ignorando os valores enviados (ou pelo menos validando-os).

### 6. Credenciais de admin: SHA-256 puro, sem salt, hardcoded no repositório
`database.js:6-7` tem os hashes de e-mail e senha commitados no Git. SHA-256 sem salt é
quebrável por força bruta/dicionário offline (GPU faz bilhões de tentativas/s) — e o repositório
expõe os hashes a qualquer pessoa com acesso. Também não há limite de tentativas de login.

**Correção:** usar um KDF lento com salt (scrypt está no `crypto` do Node, sem dependência nova),
armazenar somente no banco (com fluxo de "definir senha no primeiro uso" + troca de senha), tirar
os hashes do código-fonte e adicionar um pequeno rate-limit/atraso nas tentativas.

### 7. Nenhum backup do banco
Todo o negócio vive num único arquivo SQLite em `userData`. Um HD que morre = perda total de
produtos, vendas e histórico. **Correção mínima:** backup automático diário
(`db.backup()` do better-sqlite3 para uma segunda pasta/pen drive) + botão "Exportar backup".

---

## 🟠 Importantes (bugs e lacunas funcionais)

### 8. Pagamento em dinheiro sem cálculo de troco
O modal de pagamento só registra a forma. Para "dinheiro", não pergunta o valor recebido nem
calcula troco — funcionalidade básica de qualquer PDV de balcão.

### 9. Não existe abertura/fechamento de caixa
Sem sessão de caixa (fundo de troco, sangria, conferência no fim do dia), não há como bater o
dinheiro físico com o sistema. Relacionado ao item 4 (fraude/erro passa despercebido).

### 10. Sem desconto
Nem por item, nem no total da venda. Em loja de roupa infantil (promoções, peças com defeito,
negociação) isso aparece no primeiro dia de uso real.

### 11. Relatório de lucro pode enganar
`lucroMensal` (`database.js:191`) soma a **receita de todos** os itens, mas custo/lucro só dos
itens com `preco_custo > 0`. Se metade dos produtos está sem custo cadastrado, a "margem" exibida
mistura bases diferentes e superestima o lucro. Sugestão: mostrar no relatório quantos itens/R$
ficaram fora do cálculo por falta de custo (o rodapé "CONFIDENCIAL" já existe, falta esse aviso).

### 12. Produtos sem variação de tamanho/cor e sem categoria
Para roupas de bebê, tamanho (RN, P, M, G, 1-2 anos...) é essencial. Hoje cada tamanho vira um
produto solto com código próprio, sem agrupamento, sem categoria e sem relatório por categoria.

### 13. Não dá para cadastrar código de barras do fabricante
`gerarCodigoBarras()` sempre gera um código interno. Produtos industrializados já vêm com EAN-13;
o campo deveria aceitar leitura/digitação do código existente (com validação de duplicidade).

### 14. Aba "Lucro" do admin não carrega ao abrir
As abas `custos`, `estoque` e `estornos` carregam ao clicar (`app.js:1116-1118`), mas a de lucro
só popula depois de apertar "Buscar". Detalhe de UX, fácil de corrigir.

### 15. Mensagem de confirmação de estorno perde as quebras de linha
`confirmar()` usa `textContent` num elemento sem `white-space: pre-line`; a lista de itens
montada com `\n` em `estornarVenda` (`app.js:1374`) vira uma linha só.

---

## 🟡 Melhorias recomendadas (qualidade e manutenção)

16. **Sem CSP** no `index.html` — adicionar `<meta http-equiv="Content-Security-Policy" ...>`
    restritiva (o Electron até loga warning sobre isso em dev).
17. **Electron 29 desatualizado** (início de 2024) — atualizar para a linha atual para receber
    patches de segurança do Chromium; junto, revisar `better-sqlite3`.
18. **`onclick` inline + funções globais** (`renderProdutos`, carrinho etc.) — migrar para
    `addEventListener`/delegação de eventos. Além de organização, elimina o escape frágil de
    aspas em `onclick="deletarProduto(1,'${nome}')"` (nomes com `\` ainda quebram).
19. **`app.js` com 1400 linhas** — separar em módulos (caixa, produtos, relatórios, admin, pdf).
20. **Zero testes** — a lógica de `database.js` é pura e fácil de testar; começar por
    venda/estorno/estoque, que é onde estão os bugs de dinheiro.
21. **Datas em texto localtime** — `datetime('now','localtime')` + comparações por string
    funcionam, mas mudanças de fuso/horário do Windows bagunçam relatórios. Padrão mais seguro:
    gravar UTC (ou epoch) e converter na exibição.
22. **Relatórios que faltam:** ranking de produtos mais vendidos, vendas por forma de pagamento,
    alerta/lista de estoque baixo (o badge ≤3 existe na tabela, mas não há visão consolidada),
    lucro por dia.
23. **Multiusuário:** um único admin e operadores anônimos. Registrar ao menos "quem operou a
    venda" prepara o terreno para caixa por funcionário.
24. **Emissão fiscal:** o comprovante térmico não é documento fiscal. Se a loja precisar de
    NFC-e/SAT, isso é integração grande — vale decidir cedo se entra no roadmap.

---

## Prioridade sugerida

| Ordem | Item | Esforço |
|---|---|---|
| 1 | Autorização real de admin no main (itens 1 e 2) | Baixo |
| 2 | Validação de estoque na venda + estorno correto (item 3) | Baixo |
| 3 | Estorno com status em vez de DELETE (item 4) | Médio |
| 4 | Recalcular total no backend (item 5) | Baixo |
| 5 | Backup automático (item 7) | Baixo |
| 6 | Troco no pagamento em dinheiro (item 8) | Baixo |
| 7 | Senha admin com scrypt + primeiro uso (item 6) | Médio |
| 8 | Descontos e fechamento de caixa (itens 9 e 10) | Médio |
| 9 | Variações/categorias de produto (item 12) | Alto |

Os itens 1–6 dessa tabela fecham os riscos de dinheiro/estoque com pouco código e deveriam vir
antes de qualquer funcionalidade nova.
