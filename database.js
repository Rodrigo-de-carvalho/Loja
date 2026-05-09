'use strict'

const BetterSqlite3 = require('better-sqlite3')

class Database {
  constructor(dbPath) {
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this._initSchema()
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS produtos (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        nome           TEXT    NOT NULL,
        preco_custo    REAL    NOT NULL DEFAULT 0,
        preco_venda    REAL    NOT NULL DEFAULT 0,
        codigo_barras  TEXT    NOT NULL UNIQUE,
        criado_em      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS vendas (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        total     REAL    NOT NULL DEFAULT 0,
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

      CREATE INDEX IF NOT EXISTS idx_vendas_data      ON vendas(criado_em);
      CREATE INDEX IF NOT EXISTS idx_itens_venda_id   ON itens_venda(venda_id);
      CREATE INDEX IF NOT EXISTS idx_prod_codigo      ON produtos(codigo_barras);
    `)
  }

  /* -------------------------------------------------------
     PRODUTOS
     ------------------------------------------------------- */
  listarProdutos() {
    return this.db
      .prepare('SELECT * FROM produtos ORDER BY nome COLLATE NOCASE')
      .all()
  }

  criarProduto({ nome, preco_custo, preco_venda, codigo_barras }) {
    const stmt = this.db.prepare(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, codigo_barras) VALUES (?, ?, ?, ?)'
    )
    const { lastInsertRowid } = stmt.run(nome, preco_custo, preco_venda, codigo_barras)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(lastInsertRowid)
  }

  atualizarProduto(id, { nome, preco_custo, preco_venda }) {
    this.db.prepare(
      'UPDATE produtos SET nome = ?, preco_custo = ?, preco_venda = ? WHERE id = ?'
    ).run(nome, preco_custo, preco_venda, id)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
  }

  deletarProduto(id) {
    return this.db.prepare('DELETE FROM produtos WHERE id = ?').run(id)
  }

  buscarPorCodigo(codigo) {
    return this.db
      .prepare('SELECT * FROM produtos WHERE codigo_barras = ?')
      .get(codigo) || null
  }

  /* -------------------------------------------------------
     VENDAS
     ------------------------------------------------------- */
  finalizarVenda({ itens, total }) {
    const insertVenda = this.db.prepare(
      'INSERT INTO vendas (total) VALUES (?)'
    )
    const insertItem = this.db.prepare(`
      INSERT INTO itens_venda
        (venda_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const transacao = this.db.transaction(() => {
      const { lastInsertRowid: vendaId } = insertVenda.run(total)
      for (const item of itens) {
        insertItem.run(
          vendaId,
          item.produto_id,
          item.nome,
          item.quantidade,
          item.preco_unitario,
          item.preco_custo
        )
      }
      return vendaId
    })

    return transacao()
  }

  vendasHoje() {
    const vendas = this.db.prepare(`
      SELECT
        v.id,
        v.total,
        v.criado_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE date(v.criado_em) = date('now', 'localtime')
      ORDER BY v.criado_em DESC
    `).all()

    const totais = this.db.prepare(`
      SELECT
        COALESCE(SUM(v.total), 0)  AS total_vendas,
        COUNT(v.id)                AS num_vendas
      FROM vendas v
      WHERE date(v.criado_em) = date('now', 'localtime')
    `).get()

    return { vendas, totais }
  }

  vendasMensais(mes, ano) {
    const mesStr = String(mes).padStart(2, '0')
    const anoStr = String(ano)

    const vendas = this.db.prepare(`
      SELECT
        v.id,
        v.total,
        v.criado_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE strftime('%m', v.criado_em) = ?
        AND strftime('%Y', v.criado_em) = ?
      ORDER BY v.criado_em DESC
    `).all(mesStr, anoStr)

    const totais = this.db.prepare(`
      SELECT
        COALESCE(SUM(v.total), 0) AS total_vendas,
        COUNT(v.id)               AS num_vendas
      FROM vendas v
      WHERE strftime('%m', v.criado_em) = ?
        AND strftime('%Y', v.criado_em) = ?
    `).get(mesStr, anoStr)

    return { vendas, totais }
  }

  lucroMensal(mes, ano) {
    const mesStr = String(mes).padStart(2, '0')
    const anoStr = String(ano)

    return this.db.prepare(`
      SELECT
        COALESCE(SUM(iv.preco_unitario * iv.quantidade), 0)                       AS receita,
        COALESCE(SUM(iv.preco_custo    * iv.quantidade), 0)                       AS custo,
        COALESCE(SUM((iv.preco_unitario - iv.preco_custo) * iv.quantidade), 0)    AS lucro
      FROM itens_venda iv
      JOIN vendas v ON iv.venda_id = v.id
      WHERE strftime('%m', v.criado_em) = ?
        AND strftime('%Y', v.criado_em) = ?
    `).get(mesStr, anoStr)
  }

  detalhesVenda(id) {
    const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
    const itens = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ? ORDER BY id').all(id)
    return { venda, itens }
  }

  fechar() {
    this.db.close()
  }
}

module.exports = Database
