'use strict'

const BetterSqlite3 = require('better-sqlite3')

// Credenciais do administrador armazenadas como SHA-256 (nunca em texto puro)
const ADMIN_EMAIL_HASH = '6ff4f69da1225301e0c5d874fbc6e144ccdf38c7b257c88d4446cae6da41aaf1'
const ADMIN_SENHA_HASH = 'c3c8fde393540458b1ba7e2ad8045d42bfcf814aef3a549abbb10973a97ad6eb'

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
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        total     REAL    NOT NULL DEFAULT 0,
        pagamento TEXT    NOT NULL DEFAULT 'dinheiro',
        criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
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

  _migrations() {
    const colsProd = this.db.prepare('PRAGMA table_info(produtos)').all()
    if (!colsProd.some(c => c.name === 'estoque')) {
      this.db.exec('ALTER TABLE produtos ADD COLUMN estoque INTEGER NOT NULL DEFAULT 0')
    }

    const colsVenda = this.db.prepare('PRAGMA table_info(vendas)').all()
    if (!colsVenda.some(c => c.name === 'pagamento')) {
      this.db.exec("ALTER TABLE vendas ADD COLUMN pagamento TEXT NOT NULL DEFAULT 'dinheiro'")
    }
  }

  _seedAdmin() {
    const existe = this.db.prepare('SELECT id FROM admin_config LIMIT 1').get()
    if (!existe) {
      this.db.prepare(
        'INSERT INTO admin_config (id, email_hash, senha_hash) VALUES (1, ?, ?)'
      ).run(ADMIN_EMAIL_HASH, ADMIN_SENHA_HASH)
    }
  }

  /* -------------------------------------------------------
     ADMIN AUTH
     ------------------------------------------------------- */
  verificarAdmin(emailHash, senhaHash) {
    const cfg = this.db.prepare('SELECT * FROM admin_config WHERE id = 1').get()
    if (!cfg) return false
    return cfg.email_hash === emailHash && cfg.senha_hash === senhaHash
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
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, codigo_barras, estoque) VALUES (0, ?, ?, ?, ?)'
    ).run(preco_venda, codigo_barras, estoque || 0)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(lastInsertRowid)
  }

  atualizarProduto(id, { nome, preco_venda }) {
    this.db.prepare(
      'UPDATE produtos SET nome = ?, preco_venda = ? WHERE id = ?'
    ).run(nome, preco_venda, id)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
  }

  atualizarCusto(id, preco_custo) {
    this.db.prepare('UPDATE produtos SET preco_custo = ? WHERE id = ?').run(preco_custo, id)
  }

  atualizarEstoque(id, estoque) {
    this.db.prepare('UPDATE produtos SET estoque = ? WHERE id = ?').run(Math.max(0, estoque), id)
  }

  deletarProduto(id) {
    return this.db.prepare('DELETE FROM produtos WHERE id = ?').run(id)
  }

  buscarPorCodigo(codigo) {
    return this.db.prepare('SELECT * FROM produtos WHERE codigo_barras = ?').get(codigo) || null
  }

  /* -------------------------------------------------------
     VENDAS
     ------------------------------------------------------- */
  finalizarVenda({ itens, total, pagamento }) {
    const insertVenda  = this.db.prepare('INSERT INTO vendas (total, pagamento) VALUES (?, ?)')
    const insertItem   = this.db.prepare(`
      INSERT INTO itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const decrEstoque  = this.db.prepare(
      'UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE id = ?'
    )

    const transacao = this.db.transaction(() => {
      const { lastInsertRowid: vendaId } = insertVenda.run(total, pagamento || 'dinheiro')
      for (const item of itens) {
        insertItem.run(vendaId, item.produto_id, item.nome, item.quantidade, item.preco_unitario, item.preco_custo)
        if (item.produto_id) decrEstoque.run(item.quantidade, item.produto_id)
      }
      return vendaId
    })

    return transacao()
  }

  vendasHoje() {
    const vendas = this.db.prepare(`
      SELECT v.id, v.total, v.pagamento, v.criado_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE date(v.criado_em) = date('now','localtime')
      ORDER BY v.criado_em DESC
    `).all()

    const totais = this.db.prepare(`
      SELECT COALESCE(SUM(total),0) AS total_vendas, COUNT(id) AS num_vendas
      FROM vendas WHERE date(criado_em) = date('now','localtime')
    `).get()

    return { vendas, totais }
  }

  vendasMensais(mes, ano) {
    const m = String(mes).padStart(2, '0')
    const a = String(ano)

    const vendas = this.db.prepare(`
      SELECT v.id, v.total, v.pagamento, v.criado_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE strftime('%m',v.criado_em)=? AND strftime('%Y',v.criado_em)=?
      ORDER BY v.criado_em DESC
    `).all(m, a)

    const totais = this.db.prepare(`
      SELECT COALESCE(SUM(total),0) AS total_vendas, COUNT(id) AS num_vendas
      FROM vendas WHERE strftime('%m',criado_em)=? AND strftime('%Y',criado_em)=?
    `).get(m, a)

    return { vendas, totais }
  }

  lucroMensal(mes, ano) {
    const m = String(mes).padStart(2, '0')
    const a = String(ano)
    return this.db.prepare(`
      SELECT
        COALESCE(SUM(iv.preco_unitario * iv.quantidade), 0)                    AS receita,
        COALESCE(SUM(iv.preco_custo    * iv.quantidade), 0)                    AS custo,
        COALESCE(SUM((iv.preco_unitario - iv.preco_custo) * iv.quantidade), 0) AS lucro
      FROM itens_venda iv
      JOIN vendas v ON iv.venda_id = v.id
      WHERE strftime('%m',v.criado_em)=? AND strftime('%Y',v.criado_em)=?
    `).get(m, a)
  }

  detalhesVenda(id) {
    const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
    const itens = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ? ORDER BY id').all(id)
    return { venda, itens }
  }

  fechar() { this.db.close() }
}

module.exports = Database
