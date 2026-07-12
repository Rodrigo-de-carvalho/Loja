'use strict'

const BetterSqlite3 = require('better-sqlite3')

// Credenciais do administrador armazenadas como SHA-256 (nunca em texto puro)
const ADMIN_EMAIL_HASH = '6ff4f69da1225301e0c5d874fbc6e144ccdf38c7b257c88d4446cae6da41aaf1'
const ADMIN_SENHA_HASH = 'c3c8fde393540458b1ba7e2ad8045d42bfcf814aef3a549abbb10973a97ad6eb'

const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'debito', 'credito', 'troca']

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
        total          REAL    NOT NULL DEFAULT 0,
        pagamento      TEXT    NOT NULL DEFAULT 'dinheiro',
        status         TEXT    NOT NULL DEFAULT 'concluida',
        tipo           TEXT    NOT NULL DEFAULT 'venda',
        desconto       REAL    NOT NULL DEFAULT 0,
        venda_ref      INTEGER,
        valor_recebido REAL,
        troco          REAL,
        estornada_em   TEXT,
        criado_em      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS itens_venda (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
        produto_id     INTEGER,
        nome_produto   TEXT    NOT NULL,
        quantidade     INTEGER NOT NULL DEFAULT 1,
        preco_unitario REAL    NOT NULL DEFAULT 0,
        preco_custo    REAL    NOT NULL DEFAULT 0,
        ref_item_id    INTEGER
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
    const temCol = (nome) => colsVenda.some(c => c.name === nome)
    if (!temCol('pagamento')) {
      this.db.exec("ALTER TABLE vendas ADD COLUMN pagamento TEXT NOT NULL DEFAULT 'dinheiro'")
    }
    if (!temCol('status')) {
      this.db.exec("ALTER TABLE vendas ADD COLUMN status TEXT NOT NULL DEFAULT 'concluida'")
    }
    if (!temCol('valor_recebido')) {
      this.db.exec('ALTER TABLE vendas ADD COLUMN valor_recebido REAL')
    }
    if (!temCol('troco')) {
      this.db.exec('ALTER TABLE vendas ADD COLUMN troco REAL')
    }
    if (!temCol('estornada_em')) {
      this.db.exec('ALTER TABLE vendas ADD COLUMN estornada_em TEXT')
    }
    if (!temCol('tipo')) {
      this.db.exec("ALTER TABLE vendas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'venda'")
    }
    if (!temCol('desconto')) {
      this.db.exec('ALTER TABLE vendas ADD COLUMN desconto REAL NOT NULL DEFAULT 0')
    }
    if (!temCol('venda_ref')) {
      this.db.exec('ALTER TABLE vendas ADD COLUMN venda_ref INTEGER')
    }

    const colsItem = this.db.prepare('PRAGMA table_info(itens_venda)').all()
    if (!colsItem.some(c => c.name === 'ref_item_id')) {
      this.db.exec('ALTER TABLE itens_venda ADD COLUMN ref_item_id INTEGER')
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
    const preco = Math.round(Number(preco_venda) * 100) / 100
    if (!nome || typeof nome !== 'string' || !nome.trim()) throw new Error('Nome do produto é obrigatório.')
    if (!Number.isFinite(preco) || preco <= 0) throw new Error('Preço de venda inválido.')
    const est = Math.max(0, Math.floor(Number(estoque) || 0))
    const { lastInsertRowid } = this.db.prepare(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, codigo_barras, estoque) VALUES (?, 0, ?, ?, ?)'
    ).run(nome.trim(), preco, codigo_barras, est)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(lastInsertRowid)
  }

  atualizarProduto(id, { nome, preco_venda }) {
    const preco = Math.round(Number(preco_venda) * 100) / 100
    if (!nome || typeof nome !== 'string' || !nome.trim()) throw new Error('Nome do produto é obrigatório.')
    if (!Number.isFinite(preco) || preco <= 0) throw new Error('Preço de venda inválido.')
    this.db.prepare(
      'UPDATE produtos SET nome = ?, preco_venda = ? WHERE id = ?'
    ).run(nome.trim(), preco, id)
    return this.db.prepare('SELECT * FROM produtos WHERE id = ?').get(id)
  }

  atualizarCusto(id, preco_custo) {
    const v = Math.round(Number(preco_custo) * 100) / 100
    if (!Number.isFinite(v) || v < 0) throw new Error('Preço de custo inválido.')
    this.db.prepare('UPDATE produtos SET preco_custo = ? WHERE id = ?').run(v, id)
  }

  atualizarEstoque(id, estoque) {
    const v = Math.floor(Number(estoque))
    if (!Number.isFinite(v) || v < 0) throw new Error('Quantidade de estoque inválida.')
    this.db.prepare('UPDATE produtos SET estoque = ? WHERE id = ?').run(v, id)
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
  /*
   * Preços, custos e total são SEMPRE recalculados a partir do banco —
   * o renderer envia apenas produto_id + quantidade. Estoque é validado
   * antes de deduzir, para que o estorno possa devolver a quantidade
   * integral sem inflar o estoque.
   *
   * Troca: `devolvidos` referencia itens da venda original (venda_ref);
   * eles entram como quantidade NEGATIVA (crédito com o preço pago na
   * época) e voltam ao estoque. O total pode ficar negativo — nesse caso
   * `troco` guarda o valor a devolver ao cliente.
   *
   * Desconto: aplicado sobre os produtos novos, gravado em vendas.desconto.
   */
  finalizarVenda({ itens, pagamento, valor_recebido, desconto, venda_ref, devolvidos }) {
    const novos = Array.isArray(itens) ? itens : []
    const devs  = Array.isArray(devolvidos) ? devolvidos : []
    if (!novos.length && !devs.length) throw new Error('A venda não possui itens.')
    if (devs.length && !venda_ref) throw new Error('Troca sem venda de origem.')
    const pag = FORMAS_PAGAMENTO.includes(pagamento) ? pagamento : 'dinheiro'

    const getProduto  = this.db.prepare('SELECT * FROM produtos WHERE id = ?')
    const getVenda    = this.db.prepare('SELECT * FROM vendas WHERE id = ?')
    const getItem     = this.db.prepare('SELECT * FROM itens_venda WHERE id = ?')
    const jaDevolvido = this.db.prepare(`
      SELECT COALESCE(SUM(-iv.quantidade), 0) AS q
      FROM itens_venda iv JOIN vendas v ON iv.venda_id = v.id
      WHERE iv.ref_item_id = ? AND iv.quantidade < 0 AND v.status = 'concluida'
    `)
    const insertVenda = this.db.prepare(`
      INSERT INTO vendas (total, pagamento, valor_recebido, troco, desconto, tipo, venda_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const insertItem = this.db.prepare(`
      INSERT INTO itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo, ref_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const decrEstoque = this.db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?')
    const incrEstoque = this.db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?')

    const transacao = this.db.transaction(() => {
      /* Produtos novos (levados) */
      let subtotal = 0
      const linhasNovas = []
      for (const item of novos) {
        const qtd = Math.floor(Number(item.quantidade))
        if (!Number.isFinite(qtd) || qtd <= 0) throw new Error('Quantidade inválida em um dos itens.')
        const prod = getProduto.get(item.produto_id)
        if (!prod) throw new Error('Produto não encontrado no cadastro. Atualize a tela e tente novamente.')
        if (prod.estoque < qtd) {
          throw new Error(`Estoque insuficiente para "${prod.nome}": disponível ${prod.estoque}, solicitado ${qtd}.`)
        }
        subtotal += prod.preco_venda * qtd
        linhasNovas.push({ prod, qtd })
      }
      subtotal = Math.round(subtotal * 100) / 100

      /* Desconto sobre os produtos novos */
      let desc = Math.round(Number(desconto || 0) * 100) / 100
      if (!Number.isFinite(desc) || desc < 0) throw new Error('Desconto inválido.')
      if (desc > subtotal) throw new Error('O desconto não pode ser maior que o valor dos produtos.')

      /* Itens devolvidos (troca) — crédito com o preço pago na venda original */
      let credito = 0
      const linhasDev = []
      if (devs.length) {
        const orig = getVenda.get(venda_ref)
        if (!orig) throw new Error(`Venda #${venda_ref} não encontrada para a troca.`)
        if (orig.status !== 'concluida') throw new Error(`Venda #${venda_ref} foi estornada e não permite troca.`)
        for (const dev of devs) {
          const qtd = Math.floor(Number(dev.quantidade))
          if (!Number.isFinite(qtd) || qtd <= 0) throw new Error('Quantidade de devolução inválida.')
          const itemOrig = getItem.get(dev.item_id)
          if (!itemOrig || itemOrig.venda_id !== Number(venda_ref) || itemOrig.quantidade <= 0) {
            throw new Error('Item de devolução não pertence à venda informada.')
          }
          const restante = itemOrig.quantidade - jaDevolvido.get(itemOrig.id).q
          if (qtd > restante) {
            throw new Error(`"${itemOrig.nome_produto}": só ${restante} unidade(s) disponível(is) para devolução.`)
          }
          credito += itemOrig.preco_unitario * qtd
          linhasDev.push({ itemOrig, qtd })
        }
      }
      credito = Math.round(credito * 100) / 100

      const total = Math.round((subtotal - desc - credito) * 100) / 100

      let recebido = null
      let troco    = null
      if (pag === 'dinheiro' && total > 0 &&
          valor_recebido !== null && valor_recebido !== undefined && valor_recebido !== '') {
        recebido = Math.round(Number(valor_recebido) * 100) / 100
        if (!Number.isFinite(recebido)) throw new Error('Valor recebido inválido.')
        if (recebido < total) throw new Error('Valor recebido é menor que o total da venda.')
        troco = Math.round((recebido - total) * 100) / 100
      }
      // Total negativo em troca: valor a devolver ao cliente
      if (total < 0) troco = Math.round(-total * 100) / 100

      const tipo = devs.length ? 'troca' : 'venda'
      const { lastInsertRowid: vendaId } = insertVenda.run(
        total, pag, recebido, troco, desc, tipo, devs.length ? venda_ref : null
      )
      for (const { prod, qtd } of linhasNovas) {
        insertItem.run(vendaId, prod.id, prod.nome, qtd, prod.preco_venda, prod.preco_custo, null)
        decrEstoque.run(qtd, prod.id)
      }
      for (const { itemOrig, qtd } of linhasDev) {
        insertItem.run(vendaId, itemOrig.produto_id, itemOrig.nome_produto, -qtd,
                       itemOrig.preco_unitario, itemOrig.preco_custo, itemOrig.id)
        if (itemOrig.produto_id) incrEstoque.run(qtd, itemOrig.produto_id)
      }
      return { vendaId, total, subtotal, desconto: desc, credito, troco, tipo }
    })

    return transacao()
  }

  /*
   * Dados para montar uma troca: itens da venda original com a quantidade
   * ainda disponível para devolução (desconta devoluções anteriores).
   */
  trocaInfo(vendaId) {
    const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId)
    if (!venda) throw new Error(`Venda #${vendaId} não encontrada.`)
    if (venda.status !== 'concluida') throw new Error(`Venda #${vendaId} foi estornada e não permite troca.`)

    const jaDevolvido = this.db.prepare(`
      SELECT COALESCE(SUM(-iv.quantidade), 0) AS q
      FROM itens_venda iv JOIN vendas v ON iv.venda_id = v.id
      WHERE iv.ref_item_id = ? AND iv.quantidade < 0 AND v.status = 'concluida'
    `)
    const itens = this.db
      .prepare('SELECT * FROM itens_venda WHERE venda_id = ? AND quantidade > 0 ORDER BY id')
      .all(vendaId)
      .map(i => ({ ...i, disponivel: i.quantidade - jaDevolvido.get(i.id).q }))
      .filter(i => i.disponivel > 0)

    return { venda, itens }
  }

  vendasHoje() {
    const vendas = this.db.prepare(`
      SELECT v.id, v.total, v.pagamento, v.tipo, v.desconto, v.criado_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE date(v.criado_em) = date('now','localtime') AND v.status = 'concluida'
      ORDER BY v.criado_em DESC
    `).all()

    const totais = this.db.prepare(`
      SELECT COALESCE(SUM(total),0) AS total_vendas, COUNT(id) AS num_vendas
      FROM vendas
      WHERE date(criado_em) = date('now','localtime') AND status = 'concluida'
    `).get()

    return { vendas, totais }
  }

  vendasMensais(mes, ano) {
    const m = String(mes).padStart(2, '0')
    const a = String(ano)

    const vendas = this.db.prepare(`
      SELECT v.id, v.total, v.pagamento, v.tipo, v.desconto, v.criado_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE strftime('%m',v.criado_em)=? AND strftime('%Y',v.criado_em)=? AND v.status = 'concluida'
      ORDER BY v.criado_em DESC
    `).all(m, a)

    const totais = this.db.prepare(`
      SELECT COALESCE(SUM(total),0) AS total_vendas, COUNT(id) AS num_vendas
      FROM vendas
      WHERE strftime('%m',criado_em)=? AND strftime('%Y',criado_em)=? AND status = 'concluida'
    `).get(m, a)

    return { vendas, totais }
  }

  estornadasMensais(mes, ano) {
    const m = String(mes).padStart(2, '0')
    const a = String(ano)
    return this.db.prepare(`
      SELECT v.id, v.total, v.pagamento, v.criado_em, v.estornada_em,
        (SELECT COUNT(*) FROM itens_venda WHERE venda_id = v.id) AS num_itens
      FROM vendas v
      WHERE v.status = 'estornada'
        AND strftime('%m', v.estornada_em)=? AND strftime('%Y', v.estornada_em)=?
      ORDER BY v.estornada_em DESC
    `).all(m, a)
  }

  lucroMensal(mes, ano) {
    const m = String(mes).padStart(2, '0')
    const a = String(ano)
    // receita: todos os itens de vendas concluídas
    // custo/lucro: apenas itens com preco_custo > 0
    // receita_sem_custo / itens_sem_custo: alertam quanto ficou fora do cálculo de lucro
    return this.db.prepare(`
      SELECT
        COALESCE(SUM(iv.preco_unitario * iv.quantidade), 0) AS receita,
        COALESCE(SUM(CASE WHEN iv.preco_custo > 0 THEN iv.preco_custo * iv.quantidade ELSE 0 END), 0) AS custo,
        COALESCE(SUM(CASE WHEN iv.preco_custo > 0 THEN (iv.preco_unitario - iv.preco_custo) * iv.quantidade ELSE 0 END), 0) AS lucro,
        COALESCE(SUM(CASE WHEN iv.preco_custo <= 0 THEN iv.preco_unitario * iv.quantidade ELSE 0 END), 0) AS receita_sem_custo,
        COALESCE(SUM(CASE WHEN iv.preco_custo <= 0 THEN iv.quantidade ELSE 0 END), 0) AS itens_sem_custo
      FROM itens_venda iv
      JOIN vendas v ON iv.venda_id = v.id
      WHERE strftime('%m',v.criado_em)=? AND strftime('%Y',v.criado_em)=? AND v.status = 'concluida'
    `).get(m, a)
  }

  detalhesVenda(id) {
    const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
    const itens = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ? ORDER BY id').all(id)
    return { venda, itens }
  }

  /*
   * Estorno mantém o registro da venda (trilha de auditoria): marca como
   * 'estornada' em vez de apagar, e devolve os itens ao estoque.
   */
  cancelarVenda(id) {
    const restaurarEstoque = this.db.prepare(
      'UPDATE produtos SET estoque = estoque + ? WHERE id = ?'
    )
    const getItens = this.db.prepare('SELECT * FROM itens_venda WHERE venda_id = ?')

    const transacao = this.db.transaction(() => {
      const venda = this.db.prepare('SELECT * FROM vendas WHERE id = ?').get(id)
      if (!venda) throw new Error(`Venda #${id} não encontrada.`)
      if (venda.status === 'estornada') throw new Error(`Venda #${id} já foi estornada.`)

      const trocas = this.db.prepare(
        "SELECT COUNT(*) AS n FROM vendas WHERE venda_ref = ? AND status = 'concluida'"
      ).get(id).n
      if (trocas > 0) {
        throw new Error(`Venda #${id} possui troca(s) vinculada(s) e não pode ser estornada. Estorne as trocas primeiro.`)
      }

      for (const item of getItens.all(id)) {
        if (item.produto_id) restaurarEstoque.run(item.quantidade, item.produto_id)
      }
      this.db.prepare(
        "UPDATE vendas SET status = 'estornada', estornada_em = datetime('now','localtime') WHERE id = ?"
      ).run(id)
      return { ok: true }
    })

    return transacao()
  }

  /* -------------------------------------------------------
     BACKUP
     ------------------------------------------------------- */
  backup(destino) { return this.db.backup(destino) }

  fechar() { this.db.close() }
}

module.exports = Database
