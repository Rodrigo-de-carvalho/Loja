'use strict'

const crypto        = require('crypto')
const BetterSqlite3 = require('better-sqlite3')

// Credenciais iniciais do administrador armazenadas como SHA-256 (nunca em texto puro).
// No primeiro login bem-sucedido a senha é migrada para scrypt com salt.
const ADMIN_EMAIL_HASH = '6ff4f69da1225301e0c5d874fbc6e144ccdf38c7b257c88d4446cae6da41aaf1'
const ADMIN_SENHA_HASH = 'c3c8fde393540458b1ba7e2ad8045d42bfcf814aef3a549abbb10973a97ad6eb'

const FORMAS_PAGAMENTO = ['pix', 'debito', 'credito', 'dinheiro']

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const scrypt = (s, salt) => crypto.scryptSync(String(s), salt, 64).toString('hex')
const round2 = v => Math.round((Number(v) || 0) * 100) / 100

function igualSeguro(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

class Database {
  constructor(dbPath) {
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this._initSchema()
    this._migrations()
    this._seedAdmin()
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

      CREATE TABLE IF NOT EXISTS admin_config (
        id         INTEGER PRIMARY KEY,
        email_hash TEXT    NOT NULL,
        senha_hash TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vendas_data    ON vendas(criado_em);
      CREATE INDEX IF NOT EXISTS idx_itens_venda_id ON itens_venda(venda_id);
      CREATE INDEX IF NOT EXISTS idx_prod_codigo    ON produtos(codigo_barras);
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

    // Senha com salt (scrypt)
    this._addColuna('admin_config', 'salt', 'TEXT')
    this._addColuna('admin_config', 'algo', "TEXT NOT NULL DEFAULT 'sha256'")

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(status)')
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
    const codigo = String(codigo_barras || '').trim()
    if (!String(nome || '').trim()) throw new Error('Informe o nome do produto.')
    if (!codigo) throw new Error('Código de barras inválido.')
    if (this.buscarPorCodigo(codigo)) {
      throw new Error(`Já existe um produto com o código ${codigo}.`)
    }
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, codigo_barras, estoque) VALUES (?, 0, ?, ?, ?)'
    ).run(String(nome).trim(), round2(preco_venda), codigo, Math.max(0, parseInt(estoque) || 0))
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(lastInsertRowid)
  }

  atualizarProduto(id, { nome, preco_venda }) {
    this.db.prepare(
      'UPDATE produtos SET nome = ?, preco_venda = ? WHERE id = ?'
    ).run(String(nome).trim(), round2(preco_venda), id)
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
    return this.db.prepare('SELECT * FROM produtos WHERE codigo_barras = ?').get(String(codigo).trim()) || null
  }

  /* -------------------------------------------------------
     VENDAS
     ------------------------------------------------------- */
  proximoNumeroVenda() {
    const row = this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'vendas'").get()
    return (row ? row.seq : 0) + 1
  }

  finalizarVenda({ itens, pagamento, desconto, valor_recebido }) {
    if (!Array.isArray(itens) || !itens.length) throw new Error('A venda não possui itens.')
    if (!FORMAS_PAGAMENTO.includes(pagamento)) throw new Error('Forma de pagamento inválida.')

    // Totais calculados aqui, não confiando no valor enviado pela tela
    const subtotal = round2(itens.reduce((s, i) => s + round2(i.preco_unitario) * (parseInt(i.quantidade) || 0), 0))
    const desc     = Math.min(Math.max(round2(desconto), 0), subtotal)
    const total    = round2(subtotal - desc)

    let recebido = null, troco = null
    if (pagamento === 'dinheiro') {
      recebido = valor_recebido == null || valor_recebido === '' ? total : round2(valor_recebido)
      if (recebido < total) throw new Error('Valor recebido é menor que o total da venda.')
      troco = round2(recebido - total)
    }

    const insertVenda = this.db.prepare(`
      INSERT INTO vendas (subtotal, desconto, total, pagamento, valor_recebido, troco)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertItem = this.db.prepare(`
      INSERT INTO itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const decrEstoque = this.db.prepare(
      'UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE id = ?'
    )

    const transacao = this.db.transaction(() => {
      const { lastInsertRowid: vendaId } = insertVenda.run(subtotal, desc, total, pagamento, recebido, troco)
      for (const item of itens) {
        const qtd = parseInt(item.quantidade) || 0
        if (qtd <= 0) continue
        insertItem.run(vendaId, item.produto_id, item.nome, qtd, round2(item.preco_unitario), round2(item.preco_custo))
        if (item.produto_id) decrEstoque.run(qtd, item.produto_id)
      }
      return vendaId
    })

    const id = transacao()
    return { id, subtotal, desconto: desc, total, valor_recebido: recebido, troco }
  }

  _listarVendas(where, params) {
    return this.db.prepare(`
      SELECT v.id, v.subtotal, v.desconto, v.total, v.pagamento, v.status, v.criado_em,
        (SELECT COALESCE(SUM(quantidade),0) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE ${where}
      ORDER BY v.criado_em DESC, v.id DESC
    `).all(...params)
  }

  _totais(where, params) {
    const totais = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'concluida' THEN total    END), 0) AS total_vendas,
        COALESCE(SUM(CASE WHEN status = 'concluida' THEN desconto END), 0) AS total_descontos,
        COUNT(CASE WHEN status = 'concluida' THEN 1 END)                   AS num_vendas,
        COUNT(CASE WHEN status = 'cancelada' THEN 1 END)                   AS num_canceladas
      FROM vendas WHERE ${where}
    `).get(...params)

    const porPagamento = this.db.prepare(`
      SELECT pagamento, COUNT(*) AS quantidade, COALESCE(SUM(total),0) AS total
      FROM vendas WHERE ${where} AND status = 'concluida'
      GROUP BY pagamento ORDER BY total DESC
    `).all(...params)

    return { totais, porPagamento }
  }

  vendasHoje() {
    const where = "date(criado_em) = date('now','localtime')"
    return { vendas: this._listarVendas(where, []), ...this._totais(where, []) }
  }

  vendasMensais(mes, ano) {
    const where  = "strftime('%m',criado_em) = ? AND strftime('%Y',criado_em) = ?"
    const params = [String(mes).padStart(2, '0'), String(ano)]
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
    `).all(String(mes).padStart(2, '0'), String(ano), limite)
  }

  lucroMensal(mes, ano) {
    const m = String(mes).padStart(2, '0')
    const a = String(ano)
    // fator = total / subtotal distribui o desconto da venda proporcionalmente entre os itens
    // receita: todos os itens (com ou sem custo), já com desconto
    // custo/lucro: apenas itens com preco_custo > 0 (sem custo = ignorado no lucro)
    return this.db.prepare(`
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
    `).get(m, a)
  }

  detalhesVenda(id) {
    const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
    const itens = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ? ORDER BY id').all(id)
    return { venda, itens }
  }

  /** Estorno: mantém o registro (auditoria), marca como cancelada e devolve o estoque. */
  cancelarVenda(id) {
    const restaurarEstoque = this.db.prepare(
      'UPDATE produtos SET estoque = estoque + ? WHERE id = ?'
    )
    const getItens = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ?')
    const marcar   = this.db.prepare(
      "UPDATE vendas SET status = 'cancelada', cancelado_em = datetime('now','localtime') WHERE id = ? AND status = 'concluida'"
    )

    const transacao = this.db.transaction(() => {
      const { changes } = marcar.run(id)
      if (!changes) throw new Error('Venda não encontrada ou já estornada.')
      for (const item of getItens.all(id)) {
        if (item.produto_id) restaurarEstoque.run(item.quantidade, item.produto_id)
      }
      return true
    })

    return transacao()
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
