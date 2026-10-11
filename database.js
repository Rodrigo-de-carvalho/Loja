'use strict'

const crypto        = require('crypto')
const BetterSqlite3 = require('better-sqlite3')

// Credenciais iniciais do administrador armazenadas como SHA-256 (nunca em texto puro).
// No primeiro login bem-sucedido a senha é migrada para scrypt com salt.
const ADMIN_EMAIL_HASH = '6ff4f69da1225301e0c5d874fbc6e144ccdf38c7b257c88d4446cae6da41aaf1'
const ADMIN_SENHA_HASH = 'c3c8fde393540458b1ba7e2ad8045d42bfcf814aef3a549abbb10973a97ad6eb'

const FORMAS_PAGAMENTO   = ['dinheiro', 'pix', 'debito', 'credito', 'fiado', 'vale']
const FORMAS_RECEBIMENTO = ['dinheiro', 'pix', 'debito', 'credito']
const ACERTOS_TROCA      = ['vale', 'dinheiro', 'pix']

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const scrypt = (s, salt) => crypto.scryptSync(String(s), salt, 64).toString('hex')
const round2 = v => Math.round((Number(v) || 0) * 100) / 100
const texto  = v => (v == null ? '' : String(v)).trim()

function igualSeguro(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

function periodoMes(mes, ano) {
  return [String(mes).padStart(2, '0'), String(ano)]
}

class Database {
  constructor(dbPath) {
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    const tinhaPagamentos = this._tabelaExiste('venda_pagamentos')
    this._initSchema()
    this._migrations()
    if (!tinhaPagamentos) this._preencherPagamentosAntigos()
    this._seedAdmin()
  }

  _tabelaExiste(nome) {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome)
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS produtos (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        nome           TEXT    NOT NULL,
        preco_custo    REAL    NOT NULL DEFAULT 0,
        preco_venda    REAL    NOT NULL DEFAULT 0,
        codigo_barras  TEXT    NOT NULL UNIQUE,
        estoque        INTEGER NOT NULL DEFAULT 0,
        criado_em      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS vendas (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        subtotal       REAL    NOT NULL DEFAULT 0,
        desconto       REAL    NOT NULL DEFAULT 0,
        total          REAL    NOT NULL DEFAULT 0,
        pagamento      TEXT    NOT NULL DEFAULT 'dinheiro',
        valor_recebido REAL,
        troco          REAL,
        status         TEXT    NOT NULL DEFAULT 'concluida',
        cancelado_em   TEXT,
        caixa_id       INTEGER,
        cliente_id     INTEGER,
        criado_em      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS itens_venda (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
        produto_id     INTEGER,
        nome_produto   TEXT    NOT NULL,
        quantidade     INTEGER NOT NULL DEFAULT 1,
        preco_unitario REAL    NOT NULL DEFAULT 0,
        preco_custo    REAL    NOT NULL DEFAULT 0
      );

      -- Uma venda pode ser paga com mais de uma forma (ex.: parte vale-troca, parte cartão)
      CREATE TABLE IF NOT EXISTS venda_pagamentos (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id  INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
        forma     TEXT    NOT NULL,
        valor     REAL    NOT NULL,
        detalhe   TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_config (
        id         INTEGER PRIMARY KEY,
        email_hash TEXT    NOT NULL,
        senha_hash TEXT    NOT NULL
      );

      /* ---------- Caixa ---------- */
      CREATE TABLE IF NOT EXISTS caixas (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        aberto_em       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
        valor_abertura  REAL    NOT NULL DEFAULT 0,
        fechado_em      TEXT,
        valor_esperado  REAL,
        valor_contado   REAL,
        diferenca       REAL,
        obs_fechamento  TEXT
      );

      -- sangria (retirada), suprimento (reforço) e estorno em dinheiro de venda de outro dia
      CREATE TABLE IF NOT EXISTS caixa_movimentos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        caixa_id   INTEGER NOT NULL REFERENCES caixas(id),
        tipo       TEXT    NOT NULL,
        valor      REAL    NOT NULL,
        motivo     TEXT,
        criado_em  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      /* ---------- Clientes e fiado ---------- */
      CREATE TABLE IF NOT EXISTS clientes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nome       TEXT    NOT NULL,
        telefone   TEXT,
        cpf        TEXT,
        endereco   TEXT,
        obs        TEXT,
        criado_em  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS cliente_pagamentos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id),
        valor      REAL    NOT NULL,
        forma      TEXT    NOT NULL,
        caixa_id   INTEGER,
        obs        TEXT,
        criado_em  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      /* ---------- Trocas e vale-troca ---------- */
      CREATE TABLE IF NOT EXISTS trocas (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id    INTEGER,
        cliente_id  INTEGER,
        valor_total REAL    NOT NULL,
        acerto      TEXT    NOT NULL,
        vale_id     INTEGER,
        caixa_id    INTEGER,
        obs         TEXT,
        criado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS troca_itens (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        troca_id       INTEGER NOT NULL REFERENCES trocas(id) ON DELETE CASCADE,
        produto_id     INTEGER,
        nome_produto   TEXT    NOT NULL,
        quantidade     INTEGER NOT NULL,
        preco_unitario REAL    NOT NULL,
        preco_custo    REAL    NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS vales (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo     TEXT    NOT NULL UNIQUE,
        valor      REAL    NOT NULL,
        saldo      REAL    NOT NULL,
        cliente_id INTEGER,
        troca_id   INTEGER,
        criado_em  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      /* ---------- Fornecedores e entrada de mercadoria ---------- */
      CREATE TABLE IF NOT EXISTS fornecedores (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nome       TEXT    NOT NULL,
        telefone   TEXT,
        cnpj       TEXT,
        obs        TEXT,
        criado_em  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS entradas (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        fornecedor_id INTEGER REFERENCES fornecedores(id),
        documento     TEXT,
        total         REAL    NOT NULL DEFAULT 0,
        obs           TEXT,
        criado_em     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS entrada_itens (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        entrada_id     INTEGER NOT NULL REFERENCES entradas(id) ON DELETE CASCADE,
        produto_id     INTEGER,
        nome_produto   TEXT    NOT NULL,
        quantidade     INTEGER NOT NULL,
        custo_unitario REAL    NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_vendas_data      ON vendas(criado_em);
      CREATE INDEX IF NOT EXISTS idx_itens_venda_id   ON itens_venda(venda_id);
      CREATE INDEX IF NOT EXISTS idx_prod_codigo      ON produtos(codigo_barras);
      CREATE INDEX IF NOT EXISTS idx_vpag_venda       ON venda_pagamentos(venda_id);
      CREATE INDEX IF NOT EXISTS idx_mov_caixa        ON caixa_movimentos(caixa_id);
      CREATE INDEX IF NOT EXISTS idx_clipag_cliente   ON cliente_pagamentos(cliente_id);
      CREATE INDEX IF NOT EXISTS idx_troca_itens      ON troca_itens(troca_id);
      CREATE INDEX IF NOT EXISTS idx_entrada_itens    ON entrada_itens(entrada_id);
    `)
  }

  _addColuna(tabela, coluna, definicao) {
    const cols = this.db.prepare(`PRAGMA table_info(${tabela})`).all()
    if (!cols.some(c => c.name === coluna)) {
      this.db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`)
      return true
    }
    return false
  }

  _migrations() {
    this._addColuna('produtos', 'estoque', 'INTEGER NOT NULL DEFAULT 0')
    // Queima de estoque: preço especial para um número limitado de peças
    this._addColuna('produtos', 'preco_promo', 'REAL')
    this._addColuna('produtos', 'promo_qtd',   'INTEGER NOT NULL DEFAULT 0')
    this._addColuna('produtos', 'promo_ate',   'TEXT')
    this._addColuna('itens_venda', 'promo',    'INTEGER NOT NULL DEFAULT 0')
    this._addColuna('vendas', 'pagamento', "TEXT NOT NULL DEFAULT 'dinheiro'")

    // Desconto, troco e estorno sem apagar o registro
    if (this._addColuna('vendas', 'subtotal', 'REAL NOT NULL DEFAULT 0')) {
      this.db.exec('UPDATE vendas SET subtotal = total')
    }
    this._addColuna('vendas', 'desconto',       'REAL NOT NULL DEFAULT 0')
    this._addColuna('vendas', 'valor_recebido', 'REAL')
    this._addColuna('vendas', 'troco',          'REAL')
    this._addColuna('vendas', 'status',         "TEXT NOT NULL DEFAULT 'concluida'")
    this._addColuna('vendas', 'cancelado_em',   'TEXT')
    this._addColuna('vendas', 'caixa_id',       'INTEGER')
    this._addColuna('vendas', 'cliente_id',     'INTEGER')

    // LGPD: quando o cliente concordou e quando os dados pessoais foram apagados
    this._addColuna('clientes', 'consentimento_em', 'TEXT')
    this._addColuna('clientes', 'anonimizado_em',   'TEXT')

    // Senha com salt (scrypt)
    this._addColuna('admin_config', 'salt', 'TEXT')
    this._addColuna('admin_config', 'algo', "TEXT NOT NULL DEFAULT 'sha256'")

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vendas_status  ON vendas(status);
      CREATE INDEX IF NOT EXISTS idx_vendas_caixa   ON vendas(caixa_id);
      CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas(cliente_id);
    `)
  }

  /** Vendas feitas antes do pagamento dividido ganham uma linha de pagamento equivalente. */
  _preencherPagamentosAntigos() {
    this.db.exec(`
      INSERT INTO venda_pagamentos (venda_id, forma, valor)
      SELECT id, pagamento, total FROM vendas WHERE total > 0
    `)
  }

  _seedAdmin() {
    const existe = this.db.prepare('SELECT id FROM admin_config LIMIT 1').get()
    if (!existe) {
      this.db.prepare(
        "INSERT INTO admin_config (id, email_hash, senha_hash, algo) VALUES (1, ?, ?, 'sha256')"
      ).run(ADMIN_EMAIL_HASH, ADMIN_SENHA_HASH)
    }
  }

  /* -------------------------------------------------------
     ADMIN AUTH
     ------------------------------------------------------- */
  _salvarSenha(senha) {
    const salt = crypto.randomBytes(16).toString('hex')
    this.db.prepare(
      "UPDATE admin_config SET senha_hash = ?, salt = ?, algo = 'scrypt' WHERE id = 1"
    ).run(scrypt(senha, salt), salt)
  }

  verificarAdmin(email, senha) {
    const cfg = this.db.prepare('SELECT * FROM admin_config WHERE id = 1').get()
    if (!cfg || !email || !senha) return false
    if (!igualSeguro(sha256(String(email).trim()), cfg.email_hash)) return false

    if (cfg.algo === 'scrypt' && cfg.salt) {
      return igualSeguro(scrypt(senha, cfg.salt), cfg.senha_hash)
    }

    // Formato antigo (SHA-256 sem salt): valida e migra para scrypt
    if (!igualSeguro(sha256(senha), cfg.senha_hash)) return false
    this._salvarSenha(senha)
    return true
  }

  alterarSenha(senhaAtual, novaSenha) {
    const cfg = this.db.prepare('SELECT * FROM admin_config WHERE id = 1').get()
    const atualOk = cfg.algo === 'scrypt' && cfg.salt
      ? igualSeguro(scrypt(senhaAtual, cfg.salt), cfg.senha_hash)
      : igualSeguro(sha256(senhaAtual), cfg.senha_hash)
    if (!atualOk) throw new Error('Senha atual incorreta.')
    if (!novaSenha || String(novaSenha).length < 6) {
      throw new Error('A nova senha deve ter pelo menos 6 caracteres.')
    }
    this._salvarSenha(novaSenha)
    return true
  }

  /* -------------------------------------------------------
     PRODUTOS
     ------------------------------------------------------- */
  listarProdutos() {
    return this.db
      .prepare('SELECT * FROM produtos ORDER BY nome COLLATE NOCASE')
      .all()
  }

  criarProduto({ nome, preco_venda, codigo_barras, estoque }) {
    const codigo = texto(codigo_barras)
    if (!texto(nome)) throw new Error('Informe o nome do produto.')
    if (!codigo) throw new Error('Código de barras inválido.')
    if (this.buscarPorCodigo(codigo)) {
      throw new Error(`Já existe um produto com o código ${codigo}.`)
    }
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, codigo_barras, estoque) VALUES (?, 0, ?, ?, ?)'
    ).run(texto(nome), round2(preco_venda), codigo, Math.max(0, parseInt(estoque) || 0))
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(lastInsertRowid)
  }

  atualizarProduto(id, { nome, preco_venda }) {
    this.db.prepare(
      'UPDATE produtos SET nome = ?, preco_venda = ? WHERE id = ?'
    ).run(texto(nome), round2(preco_venda), id)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
  }

  /** promo: { preco, quantidade, ate } ou null para encerrar a queima */
  definirPromocao(id, promo) {
    const prod = this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
    if (!prod) throw new Error('Produto não encontrado.')
    if (!promo) {
      this.db.prepare('UPDATE produtos SET preco_promo = NULL, promo_qtd = 0, promo_ate = NULL WHERE id = ?').run(id)
      return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
    }
    const preco = round2(promo.preco)
    const qtd   = parseInt(promo.quantidade) || 0
    if (preco <= 0) throw new Error('Informe o preço da queima.')
    if (preco >= prod.preco_venda) throw new Error('O preço da queima deve ser menor que o preço normal.')
    if (qtd <= 0) throw new Error('Informe quantas peças entram na queima.')
    const ate = texto(promo.ate) || null
    if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new Error('Data final inválida.')
    this.db.prepare('UPDATE produtos SET preco_promo = ?, promo_qtd = ?, promo_ate = ? WHERE id = ?').run(preco, qtd, ate, id)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
  }

  atualizarCusto(id, preco_custo) {
    this.db.prepare('UPDATE produtos SET preco_custo = ? WHERE id = ?').run(round2(preco_custo), id)
  }

  atualizarEstoque(id, estoque) {
    this.db.prepare('UPDATE produtos SET estoque = ? WHERE id = ?').run(Math.max(0, parseInt(estoque) || 0), id)
  }

  deletarProduto(id) {
    return this.db.prepare('DELETE FROM produtos WHERE id = ?').run(id)
  }

  buscarPorCodigo(codigo) {
    return this.db.prepare('SELECT * FROM produtos WHERE codigo_barras = ?').get(texto(codigo)) || null
  }

  /* -------------------------------------------------------
     CAIXA (abertura, sangria, suprimento, fechamento)
     ------------------------------------------------------- */
  _caixaAberto() {
    return this.db.prepare('SELECT * FROM caixas WHERE fechado_em IS NULL ORDER BY id DESC LIMIT 1').get() || null
  }

  _exigirCaixaAberto() {
    const caixa = this._caixaAberto()
    if (!caixa) throw new Error('O caixa está fechado. Abra o caixa antes de continuar.')
    return caixa
  }

  caixaAtual() {
    const caixa = this._caixaAberto()
    const ultimo = this.db.prepare(
      'SELECT * FROM caixas WHERE fechado_em IS NOT NULL ORDER BY id DESC LIMIT 1'
    ).get() || null
    return { caixa, resumo: caixa ? this.resumoCaixa(caixa.id) : null, ultimoFechado: ultimo }
  }

  abrirCaixa(valorAbertura) {
    if (this._caixaAberto()) throw new Error('Já existe um caixa aberto.')
    const valor = round2(valorAbertura)
    if (valor < 0) throw new Error('Valor de abertura inválido.')
    const { lastInsertRowid } = this.db.prepare('INSERT INTO caixas (valor_abertura) VALUES (?)').run(valor)
    return this.db.prepare('SELECT * FROM caixas WHERE id = ?').get(lastInsertRowid)
  }

  /** Dinheiro que deveria estar na gaveta agora. */
  _dinheiroEsperado(caixaId) {
    return this.resumoCaixa(caixaId).esperado
  }

  movimentarCaixa(tipo, valor, motivo) {
    if (!['sangria', 'suprimento'].includes(tipo)) throw new Error('Movimento inválido.')
    const caixa = this._exigirCaixaAberto()
    const v = round2(valor)
    if (v <= 0) throw new Error('Informe um valor maior que zero.')
    if (tipo === 'sangria') {
      const disponivel = this._dinheiroEsperado(caixa.id)
      if (v > disponivel + 0.001) {
        throw new Error(`Não há esse valor no caixa. Dinheiro esperado na gaveta: R$ ${disponivel.toFixed(2).replace('.', ',')}.`)
      }
    }
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO caixa_movimentos (caixa_id, tipo, valor, motivo) VALUES (?, ?, ?, ?)'
    ).run(caixa.id, tipo, v, texto(motivo) || null)
    return this.db.prepare('SELECT * FROM caixa_movimentos WHERE id = ?').get(lastInsertRowid)
  }

  resumoCaixa(caixaId) {
    const caixa = this.db.prepare('SELECT * FROM caixas WHERE id = ?').get(caixaId)
    if (!caixa) throw new Error('Caixa não encontrado.')

    const vendas = this.db.prepare(`
      SELECT COUNT(*) AS num_vendas, COALESCE(SUM(total),0) AS total_vendas,
        COALESCE(SUM(desconto),0) AS total_descontos
      FROM vendas WHERE caixa_id = ? AND status = 'concluida'
    `).get(caixaId)

    const porForma = this.db.prepare(`
      SELECT p.forma, COUNT(DISTINCT p.venda_id) AS quantidade, COALESCE(SUM(p.valor),0) AS total
      FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
      WHERE v.caixa_id = ? AND v.status = 'concluida'
      GROUP BY p.forma ORDER BY total DESC
    `).all(caixaId)

    const recebimentos = this.db.prepare(`
      SELECT forma, COUNT(*) AS quantidade, COALESCE(SUM(valor),0) AS total
      FROM cliente_pagamentos WHERE caixa_id = ? GROUP BY forma ORDER BY total DESC
    `).all(caixaId)

    const devolucoes = this.db.prepare(`
      SELECT acerto, COUNT(*) AS quantidade, COALESCE(SUM(valor_total),0) AS total
      FROM trocas WHERE caixa_id = ? GROUP BY acerto
    `).all(caixaId)

    const movimentos = this.db.prepare(
      'SELECT * FROM caixa_movimentos WHERE caixa_id = ? ORDER BY id'
    ).all(caixaId)

    const somaMov = t => round2(movimentos.filter(m => m.tipo === t).reduce((s, m) => s + m.valor, 0))
    const formaVenda  = f => round2((porForma.find(p => p.forma === f) || {}).total)
    const formaReceb  = f => round2((recebimentos.find(p => p.forma === f) || {}).total)
    const acertoTroca = a => round2((devolucoes.find(d => d.acerto === a) || {}).total)

    const dinheiro = {
      abertura:     round2(caixa.valor_abertura),
      vendas:       formaVenda('dinheiro'),
      recebimentos: formaReceb('dinheiro'),
      suprimentos:  somaMov('suprimento'),
      sangrias:     somaMov('sangria'),
      devolucoes:   acertoTroca('dinheiro'),
      estornos:     somaMov('estorno')
    }
    const esperado = round2(dinheiro.abertura + dinheiro.vendas + dinheiro.recebimentos +
      dinheiro.suprimentos - dinheiro.sangrias - dinheiro.devolucoes - dinheiro.estornos)

    return { caixa, vendas, porForma, recebimentos, devolucoes, movimentos, dinheiro, esperado }
  }

  fecharCaixa(valorContado, obs) {
    const caixa = this._exigirCaixaAberto()
    const contado = round2(valorContado)
    if (valorContado === '' || valorContado == null || contado < 0) throw new Error('Informe o valor contado na gaveta.')
    const esperado = this._dinheiroEsperado(caixa.id)
    this.db.prepare(`
      UPDATE caixas SET fechado_em = datetime('now','localtime'),
        valor_esperado = ?, valor_contado = ?, diferenca = ?, obs_fechamento = ?
      WHERE id = ?
    `).run(esperado, contado, round2(contado - esperado), texto(obs) || null, caixa.id)
    return this.resumoCaixa(caixa.id)
  }

  listarCaixas(mes, ano) {
    return this.db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM vendas v WHERE v.caixa_id = c.id AND v.status = 'concluida') AS num_vendas,
        (SELECT COALESCE(SUM(total),0) FROM vendas v WHERE v.caixa_id = c.id AND v.status = 'concluida') AS total_vendas,
        (SELECT COALESCE(SUM(valor),0) FROM caixa_movimentos m WHERE m.caixa_id = c.id AND m.tipo = 'sangria') AS total_sangrias
      FROM caixas c
      WHERE strftime('%m', c.aberto_em) = ? AND strftime('%Y', c.aberto_em) = ?
      ORDER BY c.id DESC
    `).all(...periodoMes(mes, ano))
  }

  /* -------------------------------------------------------
     VENDAS
     ------------------------------------------------------- */
  proximoNumeroVenda() {
    const row = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'vendas'").get()
    return (row ? row.seq : 0) + 1
  }

  /**
   * pagamentos: [{ forma, valor, detalhe, recebido? }]
   * - dinheiro: `valor` é o que fica na venda; `recebido` é o que o cliente entregou (gera troco)
   * - fiado: exige cliente_id
   * - vale: `detalhe` é o código do vale-troca
   */
  finalizarVenda({ itens, desconto, pagamentos, cliente_id }) {
    if (!Array.isArray(itens) || !itens.length) throw new Error('A venda não possui itens.')
    const caixa = this._exigirCaixaAberto()

    // Totais calculados aqui, não confiando no valor enviado pela tela
    const subtotal = round2(itens.reduce((s, i) => s + round2(i.preco_unitario) * (parseInt(i.quantidade) || 0), 0))
    const desc     = Math.min(Math.max(round2(desconto), 0), subtotal)
    const total    = round2(subtotal - desc)

    const pags = (pagamentos || [])
      .map(p => ({ forma: p.forma, valor: round2(p.valor), detalhe: texto(p.detalhe) || null, recebido: p.recebido }))
      .filter(p => p.valor > 0)
    for (const p of pags) {
      if (!FORMAS_PAGAMENTO.includes(p.forma)) throw new Error('Forma de pagamento inválida.')
    }
    const pago = round2(pags.reduce((s, p) => s + p.valor, 0))
    if (Math.abs(pago - total) > 0.009) {
      throw new Error(`Pagamentos (R$ ${pago.toFixed(2)}) não fecham com o total (R$ ${total.toFixed(2)}).`)
    }

    const dinheiro = pags.filter(p => p.forma === 'dinheiro')
    if (dinheiro.length > 1) throw new Error('Lance o dinheiro em um único pagamento.')
    let recebido = null, troco = null
    if (dinheiro.length) {
      const d = dinheiro[0]
      recebido = d.recebido == null || d.recebido === '' ? d.valor : round2(d.recebido)
      if (recebido < d.valor) throw new Error('Valor recebido em dinheiro é menor que o valor lançado.')
      troco = round2(recebido - d.valor)
    }

    let clienteId = cliente_id ? Number(cliente_id) : null
    if (clienteId && !this.db.prepare('SELECT id FROM clientes WHERE id = ?').get(clienteId)) {
      throw new Error('Cliente não encontrado.')
    }
    if (pags.some(p => p.forma === 'fiado') && !clienteId) {
      throw new Error('Para vender fiado, escolha o cliente.')
    }

    const formaPrincipal = !pags.length ? 'dinheiro'
      : new Set(pags.map(p => p.forma)).size === 1 ? pags[0].forma : 'multiplo'

    const insertVenda = this.db.prepare(`
      INSERT INTO vendas (subtotal, desconto, total, pagamento, valor_recebido, troco, caixa_id, cliente_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertItem = this.db.prepare(`
      INSERT INTO itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo, promo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const usarPromo = this.db.prepare(`
      UPDATE produtos SET promo_qtd = MAX(0, promo_qtd - ?) WHERE id = ?
    `)
    const insertPag = this.db.prepare(
      'INSERT INTO venda_pagamentos (venda_id, forma, valor, detalhe) VALUES (?, ?, ?, ?)'
    )
    const decrEstoque = this.db.prepare(
      'UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE id = ?'
    )
    const usarVale = this.db.prepare('UPDATE vales SET saldo = ROUND(saldo - ?, 2) WHERE codigo = ?')

    const transacao = this.db.transaction(() => {
      // Vale-troca: confere o saldo dentro da transação
      for (const p of pags.filter(p => p.forma === 'vale')) {
        const vale = this.buscarVale(p.detalhe)
        if (!vale) throw new Error(`Vale-troca ${p.detalhe || ''} não encontrado.`)
        if (p.valor > vale.saldo + 0.001) {
          throw new Error(`Vale-troca ${vale.codigo} tem só R$ ${vale.saldo.toFixed(2).replace('.', ',')} de saldo.`)
        }
        usarVale.run(p.valor, vale.codigo)
        if (!clienteId && vale.cliente_id) clienteId = vale.cliente_id
      }

      const { lastInsertRowid: vendaId } = insertVenda.run(
        subtotal, desc, total, formaPrincipal, recebido, troco, caixa.id, clienteId
      )
      for (const item of itens) {
        const qtd = parseInt(item.quantidade) || 0
        if (qtd <= 0) continue
        const promo = item.promo ? 1 : 0
        insertItem.run(vendaId, item.produto_id, item.nome, qtd, round2(item.preco_unitario), round2(item.preco_custo), promo)
        if (item.produto_id) decrEstoque.run(qtd, item.produto_id)
        if (promo && item.produto_id) usarPromo.run(qtd, item.produto_id)
      }
      for (const p of pags) insertPag.run(vendaId, p.forma, p.valor, p.forma === 'vale' ? p.detalhe.toUpperCase() : p.detalhe)
      return vendaId
    })

    const id = transacao()
    return { id, subtotal, desconto: desc, total, valor_recebido: recebido, troco, pagamentos: pags }
  }

  _listarVendas(where, params) {
    return this.db.prepare(`
      SELECT v.id, v.subtotal, v.desconto, v.total, v.pagamento, v.status, v.criado_em, v.cliente_id,
        c.nome AS cliente_nome,
        (SELECT COALESCE(SUM(quantidade),0) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE ${where}
      ORDER BY v.criado_em DESC, v.id DESC
    `).all(...params)
  }

  _totais(where, params) {
    const totais = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN v.status = 'concluida' THEN v.total    END), 0) AS total_vendas,
        COALESCE(SUM(CASE WHEN v.status = 'concluida' THEN v.desconto END), 0) AS total_descontos,
        COUNT(CASE WHEN v.status = 'concluida' THEN 1 END)                     AS num_vendas,
        COUNT(CASE WHEN v.status = 'cancelada' THEN 1 END)                     AS num_canceladas
      FROM vendas v WHERE ${where}
    `).get(...params)

    const porPagamento = this.db.prepare(`
      SELECT p.forma AS pagamento, COUNT(DISTINCT p.venda_id) AS quantidade, COALESCE(SUM(p.valor),0) AS total
      FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
      WHERE ${where} AND v.status = 'concluida'
      GROUP BY p.forma ORDER BY total DESC
    `).all(...params)

    return { totais, porPagamento }
  }

  vendasHoje() {
    const where = "date(v.criado_em) = date('now','localtime')"
    return { vendas: this._listarVendas(where, []), ...this._totais(where, []) }
  }

  vendasMensais(mes, ano) {
    const where  = "strftime('%m',v.criado_em) = ? AND strftime('%Y',v.criado_em) = ?"
    const params = periodoMes(mes, ano)
    return { vendas: this._listarVendas(where, params), ...this._totais(where, params) }
  }

  maisVendidos(mes, ano, limite = 10) {
    return this.db.prepare(`
      SELECT iv.nome_produto, SUM(iv.quantidade) AS quantidade,
        SUM(iv.preco_unitario * iv.quantidade *
          CASE WHEN v.subtotal > 0 THEN v.total / v.subtotal ELSE 1 END) AS total
      FROM itens_venda iv
      JOIN vendas v ON iv.venda_id = v.id
      WHERE v.status = 'concluida'
        AND strftime('%m',v.criado_em) = ? AND strftime('%Y',v.criado_em) = ?
      GROUP BY COALESCE(iv.produto_id, iv.nome_produto)
      ORDER BY quantidade DESC, total DESC
      LIMIT ?
    `).all(...periodoMes(mes, ano), limite)
  }

  /** Faturamento do ano para o MEI: vendas concluídas menos as devoluções das trocas, mês a mês. */
  faturamentoAnual(ano) {
    const a = String(ano)
    const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, vendas: 0, devolucoes: 0 }))
    this.db.prepare(`
      SELECT CAST(strftime('%m', criado_em) AS INTEGER) AS mes, COALESCE(SUM(total),0) AS v
      FROM vendas WHERE status = 'concluida' AND strftime('%Y', criado_em) = ? GROUP BY mes
    `).all(a).forEach(r => { meses[r.mes - 1].vendas = round2(r.v) })
    this.db.prepare(`
      SELECT CAST(strftime('%m', criado_em) AS INTEGER) AS mes, COALESCE(SUM(valor_total),0) AS v
      FROM trocas WHERE strftime('%Y', criado_em) = ? GROUP BY mes
    `).all(a).forEach(r => { meses[r.mes - 1].devolucoes = round2(r.v) })
    meses.forEach(m => { m.total = round2(m.vendas - m.devolucoes) })
    return { ano: Number(ano), meses, total: round2(meses.reduce((s, m) => s + m.total, 0)) }
  }

  lucroMensal(mes, ano) {
    const params = periodoMes(mes, ano)
    // fator = total / subtotal distribui o desconto da venda proporcionalmente entre os itens
    // receita: todos os itens (com ou sem custo), já com desconto
    // custo/lucro: apenas itens com preco_custo > 0 (sem custo = ignorado no lucro)
    const vendas = this.db.prepare(`
      WITH itens AS (
        SELECT iv.quantidade, iv.preco_unitario, iv.preco_custo,
          CASE WHEN v.subtotal > 0 THEN v.total / v.subtotal ELSE 1 END AS fator
        FROM itens_venda iv
        JOIN vendas v ON iv.venda_id = v.id
        WHERE v.status = 'concluida'
          AND strftime('%m',v.criado_em) = ? AND strftime('%Y',v.criado_em) = ?
      )
      SELECT
        COALESCE(SUM(preco_unitario * quantidade * fator), 0) AS receita,
        COALESCE(SUM(CASE WHEN preco_custo > 0 THEN preco_custo * quantidade ELSE 0 END), 0) AS custo,
        COALESCE(SUM(CASE WHEN preco_custo > 0 THEN (preco_unitario * fator - preco_custo) * quantidade ELSE 0 END), 0) AS lucro,
        COALESCE(SUM(CASE WHEN preco_custo > 0 THEN 0 ELSE preco_unitario * quantidade * fator END), 0) AS receita_sem_custo
      FROM itens
    `).get(...params)

    // Peças devolvidas em trocas saem da receita e voltam para o estoque (o custo também volta)
    const dev = this.db.prepare(`
      SELECT
        COALESCE(SUM(ti.preco_unitario * ti.quantidade), 0) AS receita,
        COALESCE(SUM(CASE WHEN ti.preco_custo > 0 THEN ti.preco_custo * ti.quantidade ELSE 0 END), 0) AS custo,
        COALESCE(SUM(CASE WHEN ti.preco_custo > 0 THEN (ti.preco_unitario - ti.preco_custo) * ti.quantidade ELSE 0 END), 0) AS lucro,
        COALESCE(SUM(CASE WHEN ti.preco_custo > 0 THEN 0 ELSE ti.preco_unitario * ti.quantidade END), 0) AS receita_sem_custo
      FROM troca_itens ti JOIN trocas t ON t.id = ti.troca_id
      WHERE strftime('%m',t.criado_em) = ? AND strftime('%Y',t.criado_em) = ?
    `).get(...params)

    return {
      receita:           vendas.receita - dev.receita,
      custo:             vendas.custo - dev.custo,
      lucro:             vendas.lucro - dev.lucro,
      receita_sem_custo: vendas.receita_sem_custo - dev.receita_sem_custo,
      devolucoes:        dev.receita
    }
  }

  detalhesVenda(id) {
    const venda = this.db.prepare(`
      SELECT v.*, c.nome AS cliente_nome FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?
    `).get(id)
    if (!venda) throw new Error(`Venda nº ${id} não encontrada.`)
    const itens      = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ? ORDER BY id').all(id)
    const pagamentos = this.db.prepare('SELECT * FROM venda_pagamentos WHERE venda_id = ? ORDER BY id').all(id)
    const saldoCliente = venda.cliente_id ? this._saldoCliente(venda.cliente_id) : null
    return { venda, itens, pagamentos, saldoCliente }
  }

  /** Estorno: mantém o registro (auditoria), marca como cancelada e devolve o estoque. */
  cancelarVenda(id) {
    const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
    if (!venda || venda.status !== 'concluida') throw new Error('Venda não encontrada ou já estornada.')
    if (this.db.prepare('SELECT 1 FROM trocas WHERE venda_id = ?').get(id)) {
      throw new Error('Esta venda já teve peças trocadas e não pode ser estornada.')
    }

    const pagamentos = this.db.prepare('SELECT * FROM venda_pagamentos WHERE venda_id = ?').all(id)
    const caixa = this._caixaAberto()
    const dinheiro = round2(pagamentos.filter(p => p.forma === 'dinheiro').reduce((s, p) => s + p.valor, 0))

    const transacao = this.db.transaction(() => {
      this.db.prepare(
        "UPDATE vendas SET status = 'cancelada', cancelado_em = datetime('now','localtime') WHERE id = ?"
      ).run(id)
      const restaurar = this.db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?')
      // Peças vendidas na queima voltam para a queima (se ela ainda estiver ativa)
      const voltarPromo = this.db.prepare('UPDATE produtos SET promo_qtd = promo_qtd + ? WHERE id = ? AND preco_promo IS NOT NULL')
      for (const item of this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ?').all(id)) {
        if (item.produto_id) restaurar.run(item.quantidade, item.produto_id)
        if (item.promo && item.produto_id) voltarPromo.run(item.quantidade, item.produto_id)
      }
      // Devolve o saldo do vale-troca usado
      const devolverVale = this.db.prepare('UPDATE vales SET saldo = ROUND(saldo + ?, 2) WHERE codigo = ?')
      for (const p of pagamentos.filter(p => p.forma === 'vale')) devolverVale.run(p.valor, p.detalhe)
      // Venda de um caixa já fechado: o dinheiro devolvido sai da gaveta de hoje
      if (dinheiro > 0 && caixa && venda.caixa_id !== caixa.id) {
        this.db.prepare(
          "INSERT INTO caixa_movimentos (caixa_id, tipo, valor, motivo) VALUES (?, 'estorno', ?, ?)"
        ).run(caixa.id, dinheiro, `Estorno da venda nº ${String(id).padStart(6, '0')}`)
      }
      return true
    })

    return transacao()
  }

  /* -------------------------------------------------------
     CLIENTES E FIADO
     ------------------------------------------------------- */
  _saldoCliente(clienteId) {
    const compras = this.db.prepare(`
      SELECT COALESCE(SUM(p.valor),0) AS v FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
      WHERE v.cliente_id = ? AND v.status = 'concluida' AND p.forma = 'fiado'
    `).get(clienteId).v
    const pagos = this.db.prepare(
      'SELECT COALESCE(SUM(valor),0) AS v FROM cliente_pagamentos WHERE cliente_id = ?'
    ).get(clienteId).v
    return round2(compras - pagos)
  }

  listarClientes() {
    return this.db.prepare(`
      SELECT c.*,
        ROUND(
          (SELECT COALESCE(SUM(p.valor),0) FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
            WHERE v.cliente_id = c.id AND v.status = 'concluida' AND p.forma = 'fiado')
          - (SELECT COALESCE(SUM(valor),0) FROM cliente_pagamentos WHERE cliente_id = c.id), 2) AS saldo,
        (SELECT MAX(criado_em) FROM vendas v WHERE v.cliente_id = c.id AND v.status = 'concluida') AS ultima_compra
      FROM clientes c
      WHERE c.anonimizado_em IS NULL
      ORDER BY c.nome COLLATE NOCASE
    `).all()
  }

  salvarCliente(d) {
    const nome = texto(d.nome)
    if (!nome) throw new Error('Informe o nome do cliente.')
    const campos = [nome, texto(d.telefone) || null, texto(d.cpf) || null, texto(d.endereco) || null, texto(d.obs) || null]
    if (d.id) {
      this.db.prepare('UPDATE clientes SET nome = ?, telefone = ?, cpf = ?, endereco = ?, obs = ? WHERE id = ?').run(...campos, d.id)
      if (d.consentimento) {
        this.db.prepare("UPDATE clientes SET consentimento_em = datetime('now','localtime') WHERE id = ? AND consentimento_em IS NULL").run(d.id)
      }
      return this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(d.id)
    }
    if (!d.consentimento) throw new Error('Confirme que o cliente foi informado e concorda com o cadastro.')
    const { lastInsertRowid } = this.db.prepare(
      "INSERT INTO clientes (nome, telefone, cpf, endereco, obs, consentimento_em) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))"
    ).run(...campos)
    return this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(lastInsertRowid)
  }

  excluirCliente(id) {
    const temHistorico = this.db.prepare('SELECT 1 FROM vendas WHERE cliente_id = ? LIMIT 1').get(id)
      || this.db.prepare('SELECT 1 FROM cliente_pagamentos WHERE cliente_id = ? LIMIT 1').get(id)
    if (temHistorico) throw new Error('Este cliente tem compras registradas. Para atender um pedido de exclusão, use "Apagar dados pessoais" na ficha do cliente.')
    return this.db.prepare('DELETE FROM clientes WHERE id = ?').run(id)
  }

  /**
   * LGPD — direito de eliminação: apaga nome, telefone, CPF, endereço e observação,
   * mantendo as vendas (obrigação fiscal e contábil) ligadas a um cliente sem identificação.
   */
  anonimizarCliente(id) {
    const cliente = this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(id)
    if (!cliente || cliente.anonimizado_em) throw new Error('Cliente não encontrado.')
    const saldo = this._saldoCliente(id)
    if (saldo > 0.001) throw new Error(`O cliente ainda deve R$ ${saldo.toFixed(2).replace('.', ',')}. Receba o saldo antes de apagar os dados.`)
    const vale = this.db.prepare('SELECT codigo FROM vales WHERE cliente_id = ? AND saldo > 0 LIMIT 1').get(id)
    if (vale) throw new Error(`O cliente tem o vale-troca ${vale.codigo} com saldo. Use o vale antes de apagar os dados.`)
    this.db.prepare(`
      UPDATE clientes SET nome = ?, telefone = NULL, cpf = NULL, endereco = NULL, obs = NULL,
        anonimizado_em = datetime('now','localtime') WHERE id = ?
    `).run(`Cliente removido nº ${id}`, id)
    return true
  }

  extratoCliente(id) {
    const cliente = this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(id)
    if (!cliente) throw new Error('Cliente não encontrado.')
    const compras = this.db.prepare(`
      SELECT v.id AS venda_id, v.criado_em, v.total, p.valor
      FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id
      WHERE v.cliente_id = ? AND v.status = 'concluida' AND p.forma = 'fiado'
    `).all(id).map(c => ({ tipo: 'compra', data: c.criado_em, venda_id: c.venda_id, valor: c.valor, total_venda: c.total }))
    const pagamentos = this.db.prepare(
      'SELECT * FROM cliente_pagamentos WHERE cliente_id = ?'
    ).all(id).map(p => ({ tipo: 'pagamento', data: p.criado_em, id: p.id, valor: p.valor, forma: p.forma, obs: p.obs }))

    const movimentos = [...compras, ...pagamentos].sort((a, b) => a.data.localeCompare(b.data))
    let saldo = 0
    for (const m of movimentos) { saldo = round2(saldo + (m.tipo === 'compra' ? m.valor : -m.valor)); m.saldo = saldo }
    const vales = this.db.prepare('SELECT * FROM vales WHERE cliente_id = ? AND saldo > 0 ORDER BY id DESC').all(id)
    return { cliente, movimentos: movimentos.reverse(), saldo: this._saldoCliente(id), vales }
  }

  receberPagamentoCliente({ cliente_id, valor, forma, obs }) {
    const caixa = this._exigirCaixaAberto()
    if (!FORMAS_RECEBIMENTO.includes(forma)) throw new Error('Forma de pagamento inválida.')
    const v = round2(valor)
    if (v <= 0) throw new Error('Informe um valor maior que zero.')
    const saldo = this._saldoCliente(cliente_id)
    if (v > saldo + 0.001) throw new Error(`O cliente deve R$ ${saldo.toFixed(2).replace('.', ',')}. O valor recebido não pode ser maior.`)
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO cliente_pagamentos (cliente_id, valor, forma, caixa_id, obs) VALUES (?, ?, ?, ?, ?)'
    ).run(cliente_id, v, forma, caixa.id, texto(obs) || null)
    const pagamento = this.db.prepare('SELECT * FROM cliente_pagamentos WHERE id = ?').get(lastInsertRowid)
    const cliente   = this.db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id)
    return { pagamento, cliente, saldo: this._saldoCliente(cliente_id) }
  }

  /* -------------------------------------------------------
     TROCAS E VALE-TROCA
     ------------------------------------------------------- */
  buscarVale(codigo) {
    const c = texto(codigo).toUpperCase()
    if (!c) return null
    return this.db.prepare(`
      SELECT v.*, c.nome AS cliente_nome FROM vales v
      LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.codigo = ?
    `).get(c) || null
  }

  listarVales(somenteComSaldo = true) {
    return this.db.prepare(`
      SELECT v.*, c.nome AS cliente_nome FROM vales v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      ${somenteComSaldo ? 'WHERE v.saldo > 0' : ''}
      ORDER BY v.id DESC
    `).all()
  }

  _novoCodigoVale() {
    for (;;) {
      const codigo = 'VT' + String(crypto.randomInt(0, 1e6)).padStart(6, '0')
      if (!this.buscarVale(codigo)) return codigo
    }
  }

  /** Peças de uma venda que ainda podem ser devolvidas, com o preço efetivamente pago. */
  itensParaTroca(vendaId) {
    const { venda, itens } = this.detalhesVenda(vendaId)
    if (venda.status !== 'concluida') throw new Error('Esta venda foi estornada.')
    const fator = venda.subtotal > 0 ? venda.total / venda.subtotal : 1
    const devolvidos = this.db.prepare(`
      SELECT ti.produto_id, ti.nome_produto, SUM(ti.quantidade) AS qtd
      FROM troca_itens ti JOIN trocas t ON t.id = ti.troca_id
      WHERE t.venda_id = ? GROUP BY COALESCE(ti.produto_id, ti.nome_produto)
    `).all(vendaId)
    const jaDevolvido = i => {
      const d = devolvidos.find(x => i.produto_id ? x.produto_id === i.produto_id : x.nome_produto === i.nome_produto)
      return d ? d.qtd : 0
    }
    // Agrupa por produto (a mesma peça pode estar em mais de uma linha)
    const mapa = new Map()
    for (const i of itens) {
      const chave = i.produto_id || i.nome_produto
      const atual = mapa.get(chave)
      const preco = round2(i.preco_unitario * fator)
      if (atual) {
        // Mesma peça vendida por preços diferentes (ex.: parte na queima): vale o menor preço pago
        atual.vendida += i.quantidade
        atual.preco_unitario = Math.min(atual.preco_unitario, preco)
      } else mapa.set(chave, {
        produto_id: i.produto_id, nome: i.nome_produto, vendida: i.quantidade,
        preco_unitario: preco, preco_custo: i.preco_custo
      })
    }
    const lista = [...mapa.values()].map(i => ({ ...i, disponivel: i.vendida - jaDevolvido({ produto_id: i.produto_id, nome_produto: i.nome }) }))
    return { venda, itens: lista }
  }

  /**
   * itens: [{ produto_id, nome, quantidade, preco_unitario, preco_custo }]
   * acerto: 'vale' (gera vale-troca) | 'dinheiro' | 'pix' (devolve o valor ao cliente)
   */
  registrarTroca({ venda_id, cliente_id, itens, acerto, obs }) {
    if (!ACERTOS_TROCA.includes(acerto)) throw new Error('Forma de acerto inválida.')
    if (!Array.isArray(itens) || !itens.length) throw new Error('Informe as peças devolvidas.')
    const caixa = this._exigirCaixaAberto()

    let precos = null
    if (venda_id) {
      const { itens: daVenda } = this.itensParaTroca(venda_id)
      precos = daVenda
      for (const it of itens) {
        const ref = daVenda.find(d => it.produto_id ? d.produto_id === it.produto_id : d.nome === it.nome)
        if (!ref) throw new Error(`"${it.nome}" não faz parte da venda nº ${venda_id}.`)
        if (it.quantidade > ref.disponivel) {
          throw new Error(`Só ${ref.disponivel} unidade(s) de "${ref.nome}" podem ser devolvidas desta venda.`)
        }
      }
    }

    const linhas = itens.map(it => {
      const qtd = parseInt(it.quantidade) || 0
      if (qtd <= 0) throw new Error('Quantidade inválida.')
      const ref = precos && precos.find(d => it.produto_id ? d.produto_id === it.produto_id : d.nome === it.nome)
      return {
        produto_id: it.produto_id || null, nome: texto(it.nome), quantidade: qtd,
        // Com a venda informada vale o preço pago; sem ela, o preço atual do produto
        preco_unitario: ref ? ref.preco_unitario : round2(it.preco_unitario),
        preco_custo: ref ? round2(ref.preco_custo) : round2(it.preco_custo)
      }
    })
    const valorTotal = round2(linhas.reduce((s, l) => s + l.preco_unitario * l.quantidade, 0))
    if (valorTotal <= 0) throw new Error('O valor da troca deve ser maior que zero.')

    if (acerto === 'dinheiro') {
      const disponivel = this._dinheiroEsperado(caixa.id)
      if (valorTotal > disponivel + 0.001) throw new Error('Não há dinheiro suficiente no caixa para devolver.')
    }

    let clienteId = cliente_id ? Number(cliente_id) : null
    if (!clienteId && venda_id) {
      const v = this.db.prepare('SELECT cliente_id FROM vendas WHERE id = ?').get(venda_id)
      clienteId = v && v.cliente_id
    }

    const transacao = this.db.transaction(() => {
      const { lastInsertRowid: trocaId } = this.db.prepare(`
        INSERT INTO trocas (venda_id, cliente_id, valor_total, acerto, caixa_id, obs) VALUES (?, ?, ?, ?, ?, ?)
      `).run(venda_id || null, clienteId, valorTotal, acerto, caixa.id, texto(obs) || null)

      const insertItem = this.db.prepare(`
        INSERT INTO troca_itens (troca_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const repor = this.db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?')
      for (const l of linhas) {
        insertItem.run(trocaId, l.produto_id, l.nome, l.quantidade, l.preco_unitario, l.preco_custo)
        if (l.produto_id) repor.run(l.quantidade, l.produto_id)
      }

      let vale = null
      if (acerto === 'vale') {
        const codigo = this._novoCodigoVale()
        const { lastInsertRowid: valeId } = this.db.prepare(
          'INSERT INTO vales (codigo, valor, saldo, cliente_id, troca_id) VALUES (?, ?, ?, ?, ?)'
        ).run(codigo, valorTotal, valorTotal, clienteId, trocaId)
        this.db.prepare('UPDATE trocas SET vale_id = ? WHERE id = ?').run(valeId, trocaId)
        vale = this.buscarVale(codigo)
      }
      return { troca: this.db.prepare('SELECT * FROM trocas WHERE id = ?').get(trocaId), vale }
    })

    return transacao()
  }

  listarTrocas(mes, ano) {
    return this.db.prepare(`
      SELECT t.*, c.nome AS cliente_nome, v.codigo AS vale_codigo, v.saldo AS vale_saldo,
        (SELECT COALESCE(SUM(quantidade),0) FROM troca_itens WHERE troca_id = t.id) AS num_itens
      FROM trocas t
      LEFT JOIN clientes c ON c.id = t.cliente_id
      LEFT JOIN vales v ON v.id = t.vale_id
      WHERE strftime('%m', t.criado_em) = ? AND strftime('%Y', t.criado_em) = ?
      ORDER BY t.id DESC
    `).all(...periodoMes(mes, ano))
  }

  detalhesTroca(id) {
    const troca = this.db.prepare(`
      SELECT t.*, c.nome AS cliente_nome, v.codigo AS vale_codigo, v.saldo AS vale_saldo
      FROM trocas t LEFT JOIN clientes c ON c.id = t.cliente_id LEFT JOIN vales v ON v.id = t.vale_id
      WHERE t.id = ?
    `).get(id)
    if (!troca) throw new Error('Troca não encontrada.')
    const itens = this.db.prepare('SELECT * FROM troca_itens WHERE troca_id = ? ORDER BY id').all(id)
    return { troca, itens }
  }

  /* -------------------------------------------------------
     FORNECEDORES E ENTRADA DE MERCADORIA
     ------------------------------------------------------- */
  listarFornecedores() {
    return this.db.prepare(`
      SELECT f.*,
        (SELECT COUNT(*) FROM entradas e WHERE e.fornecedor_id = f.id) AS num_entradas,
        (SELECT COALESCE(SUM(total),0) FROM entradas e WHERE e.fornecedor_id = f.id) AS total_comprado,
        (SELECT MAX(criado_em) FROM entradas e WHERE e.fornecedor_id = f.id) AS ultima_entrada
      FROM fornecedores f ORDER BY f.nome COLLATE NOCASE
    `).all()
  }

  salvarFornecedor(d) {
    const nome = texto(d.nome)
    if (!nome) throw new Error('Informe o nome do fornecedor.')
    const campos = [nome, texto(d.telefone) || null, texto(d.cnpj) || null, texto(d.obs) || null]
    if (d.id) {
      this.db.prepare('UPDATE fornecedores SET nome = ?, telefone = ?, cnpj = ?, obs = ? WHERE id = ?').run(...campos, d.id)
      return this.db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(d.id)
    }
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO fornecedores (nome, telefone, cnpj, obs) VALUES (?, ?, ?, ?)'
    ).run(...campos)
    return this.db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(lastInsertRowid)
  }

  excluirFornecedor(id) {
    if (this.db.prepare('SELECT 1 FROM entradas WHERE fornecedor_id = ? LIMIT 1').get(id)) {
      throw new Error('Este fornecedor tem entradas registradas e não pode ser excluído.')
    }
    return this.db.prepare('DELETE FROM fornecedores WHERE id = ?').run(id)
  }

  /** Soma as peças ao estoque e atualiza o preço de custo com o custo desta nota. */
  registrarEntrada({ fornecedor_id, documento, obs, itens }) {
    if (!Array.isArray(itens) || !itens.length) throw new Error('Adicione os produtos que chegaram.')
    if (fornecedor_id && !this.db.prepare('SELECT 1 FROM fornecedores WHERE id = ?').get(fornecedor_id)) {
      throw new Error('Fornecedor não encontrado.')
    }
    const linhas = itens.map(it => {
      const prod = this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(it.produto_id)
      if (!prod) throw new Error('Produto não encontrado.')
      const qtd = parseInt(it.quantidade) || 0
      if (qtd <= 0) throw new Error(`Quantidade inválida para "${prod.nome}".`)
      const custo = round2(it.custo_unitario)
      if (custo < 0) throw new Error(`Custo inválido para "${prod.nome}".`)
      return { prod, qtd, custo }
    })
    const total = round2(linhas.reduce((s, l) => s + l.qtd * l.custo, 0))

    const transacao = this.db.transaction(() => {
      const { lastInsertRowid: entradaId } = this.db.prepare(
        'INSERT INTO entradas (fornecedor_id, documento, total, obs) VALUES (?, ?, ?, ?)'
      ).run(fornecedor_id || null, texto(documento) || null, total, texto(obs) || null)
      const insertItem = this.db.prepare(
        'INSERT INTO entrada_itens (entrada_id, produto_id, nome_produto, quantidade, custo_unitario) VALUES (?, ?, ?, ?, ?)'
      )
      const somar = this.db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?')
      const custo = this.db.prepare('UPDATE produtos SET preco_custo = ? WHERE id = ?')
      for (const l of linhas) {
        insertItem.run(entradaId, l.prod.id, l.prod.nome, l.qtd, l.custo)
        somar.run(l.qtd, l.prod.id)
        if (l.custo > 0) custo.run(l.custo, l.prod.id)
      }
      return entradaId
    })
    return this.detalhesEntrada(transacao())
  }

  listarEntradas(mes, ano) {
    return this.db.prepare(`
      SELECT e.*, f.nome AS fornecedor_nome,
        (SELECT COALESCE(SUM(quantidade),0) FROM entrada_itens WHERE entrada_id = e.id) AS num_pecas
      FROM entradas e LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
      WHERE strftime('%m', e.criado_em) = ? AND strftime('%Y', e.criado_em) = ?
      ORDER BY e.id DESC
    `).all(...periodoMes(mes, ano))
  }

  detalhesEntrada(id) {
    const entrada = this.db.prepare(`
      SELECT e.*, f.nome AS fornecedor_nome FROM entradas e
      LEFT JOIN fornecedores f ON f.id = e.fornecedor_id WHERE e.id = ?
    `).get(id)
    if (!entrada) throw new Error('Entrada não encontrada.')
    const itens = this.db.prepare('SELECT * FROM entrada_itens WHERE entrada_id = ? ORDER BY id').all(id)
    return { entrada, itens }
  }

  /* -------------------------------------------------------
     BACKUP
     ------------------------------------------------------- */
  backup(destino) {
    return this.db.backup(destino)
  }

  fechar() { if (this.db.open) this.db.close() }
}

module.exports = Database
