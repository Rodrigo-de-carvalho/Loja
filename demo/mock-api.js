/*
 * DEMO — substitui o backend Electron (preload/main/database) por um banco
 * em memória persistido no localStorage do navegador. Replica as mesmas
 * regras do database.js real: estoque validado, total recalculado, desconto,
 * troca com crédito, estorno com auditoria e consultas por período.
 */
;(function () {
  'use strict'

  var STORAGE_KEY = 'cantinho-pdv-demo-v1'

  // admin@teste.com / 1234 (SHA-256)
  var DEMO_EMAIL_HASH = '46d71e4a49138a53f85177f14135172d122f844919d05bf84c6e1858bc6dd3ca'
  var DEMO_SENHA_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'

  var FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'troca']
  var adminLogado = false
  var db = null

  /* ---------- utilidades ---------- */
  function r2(v) { return Math.round(v * 100) / 100 }
  function pad(n) { return String(n).padStart(2, '0') }
  function ymdLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
  function dhLocal(d) { return ymdLocal(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) }
  function agora() { return dhLocal(new Date()) }
  function hojeYmd() { return ymdLocal(new Date()) }
  function salvar() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)) } catch (e) {} }
  function falha(msg) { return Promise.reject(new Error(msg)) }
  function okAsync(v) { return Promise.resolve(v) }

  /* ---------- seed de demonstração ---------- */
  function seed() {
    var d = { seqProduto: 0, seqVenda: 0, seqItem: 0, produtos: [], vendas: [], itens: [] }

    function prod(nome, custo, venda, estoque) {
      d.seqProduto++
      d.produtos.push({
        id: d.seqProduto, nome: nome, preco_custo: custo, preco_venda: venda,
        codigo_barras: String(789100000000 + d.seqProduto * 137), estoque: estoque,
        criado_em: agora()
      })
      return d.produtos[d.produtos.length - 1]
    }

    var p1 = prod('Body Manga Curta Azul P',   12.5, 34.9, 14)
    var p2 = prod('Body Manga Longa Rosa M',   13.0, 36.9, 9)
    var p3 = prod('Macacão Soft Estrelinhas',  28.0, 69.9, 6)
    var p4 = prod('Vestido Florido 1 Ano',     31.0, 89.9, 4)
    var p5 = prod('Conjunto短 Dino 2 Anos',    24.0, 64.9, 7)
    p5.nome = 'Conjunto Short Dino 2 Anos'
    var p6 = prod('Meia Kit 3 Pares RN',        6.5, 19.9, 20)
    var p7 = prod('Manta Tricô Bege',          22.0, 59.9, 3)
    var p8 = prod('Babador Impermeável',        0,   14.9, 15)   // sem custo cadastrado (para o aviso do lucro)

    function venda(diasAtras, hora, itensVenda, pagamento, desconto, recebido) {
      d.seqVenda++
      var dt = new Date()
      dt.setDate(dt.getDate() - diasAtras)
      var criado = ymdLocal(dt) + ' ' + hora + ':00'
      var total = 0
      itensVenda.forEach(function (iv) {
        d.seqItem++
        total += iv.p.preco_venda * iv.q
        d.itens.push({
          id: d.seqItem, venda_id: d.seqVenda, produto_id: iv.p.id, nome_produto: iv.p.nome,
          quantidade: iv.q, preco_unitario: iv.p.preco_venda, preco_custo: iv.p.preco_custo,
          ref_item_id: null
        })
      })
      total = r2(total - (desconto || 0))
      var troco = (pagamento === 'dinheiro' && recebido) ? r2(recebido - total) : null
      d.vendas.push({
        id: d.seqVenda, total: total, pagamento: pagamento, status: 'concluida', tipo: 'venda',
        desconto: desconto || 0, venda_ref: null,
        valor_recebido: recebido || null, troco: troco, estornada_em: null, criado_em: criado
      })
    }

    // hoje
    venda(0, '09:12', [{ p: p1, q: 2 }, { p: p6, q: 1 }], 'pix', 0)
    venda(0, '10:40', [{ p: p4, q: 1 }], 'credito', 0)
    venda(0, '11:05', [{ p: p3, q: 1 }, { p: p8, q: 2 }], 'dinheiro', 5, 100)
    // ontem e semana passada
    venda(1, '15:20', [{ p: p2, q: 1 }, { p: p6, q: 2 }], 'debito', 0)
    venda(3, '16:45', [{ p: p7, q: 1 }], 'pix', 0)
    venda(6, '10:10', [{ p: p5, q: 2 }], 'dinheiro', 0, 150)
    // mês passado e trimestre anterior
    venda(28, '14:00', [{ p: p4, q: 1 }, { p: p1, q: 1 }], 'credito', 10)
    venda(45, '11:30', [{ p: p3, q: 2 }], 'pix', 0)
    venda(100, '09:50', [{ p: p2, q: 3 }], 'dinheiro', 0, 120)

    return d
  }

  function carregar() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) { db = JSON.parse(raw); return }
    } catch (e) {}
    db = seed()
    salvar()
  }
  carregar()

  /* ---------- consultas auxiliares ---------- */
  function getProduto(id) { return db.produtos.find(function (p) { return p.id === id }) || null }
  function getVenda(id) { return db.vendas.find(function (v) { return v.id === Number(id) }) || null }
  function itensDe(vendaId) { return db.itens.filter(function (i) { return i.venda_id === Number(vendaId) }) }
  function numItens(vendaId) { return itensDe(vendaId).length }

  function jaDevolvido(itemId) {
    return db.itens.reduce(function (s, i) {
      if (i.ref_item_id !== itemId || i.quantidade >= 0) return s
      var v = getVenda(i.venda_id)
      return (v && v.status === 'concluida') ? s + (-i.quantidade) : s
    }, 0)
  }

  function resumoVendas(lista) {
    return lista.map(function (v) {
      return {
        id: v.id, total: v.total, pagamento: v.pagamento, tipo: v.tipo,
        desconto: v.desconto, criado_em: v.criado_em, estornada_em: v.estornada_em,
        num_itens: numItens(v.id)
      }
    })
  }
  function totais(lista) {
    return {
      total_vendas: r2(lista.reduce(function (s, v) { return s + v.total }, 0)),
      num_vendas: lista.length
    }
  }
  function concluidas() { return db.vendas.filter(function (v) { return v.status === 'concluida' }) }
  function mesAno(v, m, a) {
    return v.criado_em.slice(0, 4) === String(a) && v.criado_em.slice(5, 7) === pad(m)
  }

  /* ---------- API exposta (mesma assinatura do preload real) ---------- */
  window.electronAPI = {
    listarProdutos: function () {
      var lista = db.produtos.slice().sort(function (a, b) {
        return a.nome.toLowerCase().localeCompare(b.nome.toLowerCase())
      })
      return okAsync(JSON.parse(JSON.stringify(lista)))
    },

    criarProduto: function (dados) {
      var preco = r2(Number(dados.preco_venda))
      if (!dados.nome || !String(dados.nome).trim()) return falha('Nome do produto é obrigatório.')
      if (!isFinite(preco) || preco <= 0) return falha('Preço de venda inválido.')
      if (db.produtos.some(function (p) { return p.codigo_barras === dados.codigo_barras })) {
        return falha('Já existe um produto com este código de barras.')
      }
      db.seqProduto++
      var p = {
        id: db.seqProduto, nome: String(dados.nome).trim(), preco_custo: 0, preco_venda: preco,
        codigo_barras: dados.codigo_barras,
        estoque: adminLogado ? Math.max(0, Math.floor(Number(dados.estoque) || 0)) : 0,
        criado_em: agora()
      }
      db.produtos.push(p); salvar()
      return okAsync(JSON.parse(JSON.stringify(p)))
    },

    atualizarProduto: function (id, dados) {
      var p = getProduto(id)
      if (!p) return falha('Produto não encontrado.')
      var preco = r2(Number(dados.preco_venda))
      if (!dados.nome || !String(dados.nome).trim()) return falha('Nome do produto é obrigatório.')
      if (!isFinite(preco) || preco <= 0) return falha('Preço de venda inválido.')
      p.nome = String(dados.nome).trim(); p.preco_venda = preco; salvar()
      return okAsync(JSON.parse(JSON.stringify(p)))
    },

    deletarProduto: function (id) {
      db.produtos = db.produtos.filter(function (p) { return p.id !== id }); salvar()
      return okAsync({ changes: 1 })
    },

    buscarPorCodigo: function (codigo) {
      var p = db.produtos.find(function (x) { return x.codigo_barras === String(codigo) })
      return okAsync(p ? JSON.parse(JSON.stringify(p)) : null)
    },

    adminLogin: function (eH, sH) {
      if (eH === DEMO_EMAIL_HASH && sH === DEMO_SENHA_HASH) {
        adminLogado = true
        return okAsync({ ok: true })
      }
      return okAsync({ ok: false, error: 'E-mail ou senha incorretos. (Demo: admin@teste.com / 1234)' })
    },
    adminLogout: function () { adminLogado = false; return okAsync({ ok: true }) },

    adminAtualizarCusto: function (id, v) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      var p = getProduto(id); if (!p) return falha('Produto não encontrado.')
      var c = r2(Number(v)); if (!isFinite(c) || c < 0) return falha('Preço de custo inválido.')
      p.preco_custo = c; salvar()
      return okAsync(true)
    },

    adminAtualizarEstoque: function (id, v) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      var p = getProduto(id); if (!p) return falha('Produto não encontrado.')
      var e = Math.floor(Number(v)); if (!isFinite(e) || e < 0) return falha('Quantidade de estoque inválida.')
      p.estoque = e; salvar()
      return okAsync(true)
    },

    finalizarVenda: function (dados) {
      var novos = Array.isArray(dados.itens) ? dados.itens : []
      var devs = Array.isArray(dados.devolvidos) ? dados.devolvidos : []
      if (!novos.length && !devs.length) return falha('A venda não possui itens.')
      if (devs.length && !dados.venda_ref) return falha('Troca sem venda de origem.')
      var pag = FORMAS.indexOf(dados.pagamento) >= 0 ? dados.pagamento : 'dinheiro'

      var subtotal = 0, linhasNovas = []
      for (var i = 0; i < novos.length; i++) {
        var qtd = Math.floor(Number(novos[i].quantidade))
        if (!isFinite(qtd) || qtd <= 0) return falha('Quantidade inválida em um dos itens.')
        var prod = getProduto(novos[i].produto_id)
        if (!prod) return falha('Produto não encontrado no cadastro. Atualize a tela e tente novamente.')
        if (prod.estoque < qtd) {
          return falha('Estoque insuficiente para "' + prod.nome + '": disponível ' + prod.estoque + ', solicitado ' + qtd + '.')
        }
        subtotal += prod.preco_venda * qtd
        linhasNovas.push({ prod: prod, qtd: qtd })
      }
      subtotal = r2(subtotal)

      var desc = r2(Number(dados.desconto || 0))
      if (!isFinite(desc) || desc < 0) return falha('Desconto inválido.')
      if (desc > subtotal) return falha('O desconto não pode ser maior que o valor dos produtos.')

      var credito = 0, linhasDev = []
      if (devs.length) {
        var orig = getVenda(dados.venda_ref)
        if (!orig) return falha('Venda #' + dados.venda_ref + ' não encontrada para a troca.')
        if (orig.status !== 'concluida') return falha('Venda #' + dados.venda_ref + ' foi estornada e não permite troca.')
        for (var j = 0; j < devs.length; j++) {
          var q = Math.floor(Number(devs[j].quantidade))
          if (!isFinite(q) || q <= 0) return falha('Quantidade de devolução inválida.')
          var itemOrig = db.itens.find(function (x) { return x.id === devs[j].item_id })
          if (!itemOrig || itemOrig.venda_id !== Number(dados.venda_ref) || itemOrig.quantidade <= 0) {
            return falha('Item de devolução não pertence à venda informada.')
          }
          var restante = itemOrig.quantidade - jaDevolvido(itemOrig.id)
          if (q > restante) {
            return falha('"' + itemOrig.nome_produto + '": só ' + restante + ' unidade(s) disponível(is) para devolução.')
          }
          credito += itemOrig.preco_unitario * q
          linhasDev.push({ itemOrig: itemOrig, qtd: q })
        }
      }
      credito = r2(credito)

      var total = r2(subtotal - desc - credito)
      var recebido = null, troco = null
      if (pag === 'dinheiro' && total > 0 && dados.valor_recebido != null && dados.valor_recebido !== '') {
        recebido = r2(Number(dados.valor_recebido))
        if (!isFinite(recebido)) return falha('Valor recebido inválido.')
        if (recebido < total) return falha('Valor recebido é menor que o total da venda.')
        troco = r2(recebido - total)
      }
      if (total < 0) troco = r2(-total)

      var tipo = devs.length ? 'troca' : 'venda'
      db.seqVenda++
      db.vendas.push({
        id: db.seqVenda, total: total, pagamento: pag, status: 'concluida', tipo: tipo,
        desconto: desc, venda_ref: devs.length ? Number(dados.venda_ref) : null,
        valor_recebido: recebido, troco: troco, estornada_em: null, criado_em: agora()
      })
      linhasNovas.forEach(function (l) {
        db.seqItem++
        db.itens.push({
          id: db.seqItem, venda_id: db.seqVenda, produto_id: l.prod.id, nome_produto: l.prod.nome,
          quantidade: l.qtd, preco_unitario: l.prod.preco_venda, preco_custo: l.prod.preco_custo, ref_item_id: null
        })
        l.prod.estoque -= l.qtd
      })
      linhasDev.forEach(function (l) {
        db.seqItem++
        db.itens.push({
          id: db.seqItem, venda_id: db.seqVenda, produto_id: l.itemOrig.produto_id, nome_produto: l.itemOrig.nome_produto,
          quantidade: -l.qtd, preco_unitario: l.itemOrig.preco_unitario, preco_custo: l.itemOrig.preco_custo,
          ref_item_id: l.itemOrig.id
        })
        var p = l.itemOrig.produto_id ? getProduto(l.itemOrig.produto_id) : null
        if (p) p.estoque += l.qtd
      })
      salvar()
      return okAsync({ vendaId: db.seqVenda, total: total, subtotal: subtotal, desconto: desc, credito: credito, troco: troco, tipo: tipo })
    },

    trocaInfo: function (vendaId) {
      var venda = getVenda(vendaId)
      if (!venda) return falha('Venda #' + vendaId + ' não encontrada.')
      if (venda.status !== 'concluida') return falha('Venda #' + vendaId + ' foi estornada e não permite troca.')
      var itens = itensDe(vendaId)
        .filter(function (i) { return i.quantidade > 0 })
        .map(function (i) {
          var o = JSON.parse(JSON.stringify(i))
          o.disponivel = i.quantidade - jaDevolvido(i.id)
          return o
        })
        .filter(function (i) { return i.disponivel > 0 })
      return okAsync({ venda: JSON.parse(JSON.stringify(venda)), itens: itens })
    },

    cancelarVenda: function (id) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      var venda = getVenda(id)
      if (!venda) return falha('Venda #' + id + ' não encontrada.')
      if (venda.status === 'estornada') return falha('Venda #' + id + ' já foi estornada.')
      var temTroca = db.vendas.some(function (v) { return v.venda_ref === Number(id) && v.status === 'concluida' })
      if (temTroca) return falha('Venda #' + id + ' possui troca(s) vinculada(s) e não pode ser estornada. Estorne as trocas primeiro.')
      itensDe(id).forEach(function (item) {
        var p = item.produto_id ? getProduto(item.produto_id) : null
        if (p) p.estoque += item.quantidade
      })
      venda.status = 'estornada'
      venda.estornada_em = agora()
      salvar()
      return okAsync({ ok: true })
    },

    vendasHoje: function () {
      var hoje = hojeYmd()
      var lista = concluidas().filter(function (v) { return v.criado_em.slice(0, 10) === hoje })
        .sort(function (a, b) { return b.criado_em.localeCompare(a.criado_em) })
      return okAsync({ vendas: resumoVendas(lista), totais: totais(lista) })
    },

    vendasMensais: function (m, a) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      var lista = concluidas().filter(function (v) { return mesAno(v, m, a) })
        .sort(function (x, y) { return y.criado_em.localeCompare(x.criado_em) })
      return okAsync({ vendas: resumoVendas(lista), totais: totais(lista) })
    },

    vendasPeriodo: function (ini, fim) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ini)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(fim))) {
        return falha('Período inválido.')
      }
      if (ini > fim) return falha('A data inicial é maior que a data final.')
      var lista = concluidas().filter(function (v) {
        var d = v.criado_em.slice(0, 10)
        return d >= ini && d <= fim
      }).sort(function (x, y) { return y.criado_em.localeCompare(x.criado_em) })
      return okAsync({ vendas: resumoVendas(lista), totais: totais(lista) })
    },

    estornadasMensais: function (m, a) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      var lista = db.vendas.filter(function (v) {
        return v.status === 'estornada' && v.estornada_em &&
          v.estornada_em.slice(0, 4) === String(a) && v.estornada_em.slice(5, 7) === pad(m)
      }).sort(function (x, y) { return y.estornada_em.localeCompare(x.estornada_em) })
      return okAsync(resumoVendas(lista))
    },

    lucroMensal: function (m, a) {
      if (!adminLogado) return falha('Acesso negado: faça login como administrador.')
      var receita = 0, custo = 0, lucro = 0, receitaSem = 0, itensSem = 0
      db.itens.forEach(function (iv) {
        var v = getVenda(iv.venda_id)
        if (!v || v.status !== 'concluida' || !mesAno(v, m, a)) return
        receita += iv.preco_unitario * iv.quantidade
        if (iv.preco_custo > 0) {
          custo += iv.preco_custo * iv.quantidade
          lucro += (iv.preco_unitario - iv.preco_custo) * iv.quantidade
        } else {
          receitaSem += iv.preco_unitario * iv.quantidade
          itensSem += iv.quantidade
        }
      })
      return okAsync({
        receita: r2(receita), custo: r2(custo), lucro: r2(lucro),
        receita_sem_custo: r2(receitaSem), itens_sem_custo: itensSem
      })
    },

    detalhesVenda: function (id) {
      var venda = getVenda(id)
      var itens = itensDe(id)
      return okAsync({
        venda: venda ? JSON.parse(JSON.stringify(venda)) : null,
        itens: JSON.parse(JSON.stringify(itens))
      })
    }
  }

  /* ---------- interface da demo (selo + credenciais + reset) ---------- */
  function montarDemoUI() {
    var badge = document.createElement('div')
    badge.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;background:#1e293b;color:#e2e8f0;' +
      'padding:10px 14px;border-radius:10px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.25);' +
      'display:flex;align-items:center;gap:10px;font-family:inherit;'
    badge.innerHTML = '<span>🧪 <strong>VERSÃO DEMO</strong> — dados fictícios, salvos só neste navegador</span>'
    var btn = document.createElement('button')
    btn.textContent = 'Resetar dados'
    btn.style.cssText = 'background:#7c3aed;color:#fff;border:0;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:12px;'
    btn.addEventListener('click', function () {
      if (confirm('Resetar os dados da demonstração? Tudo volta ao estado inicial.')) {
        localStorage.removeItem(STORAGE_KEY)
        location.reload()
      }
    })
    badge.appendChild(btn)
    document.body.appendChild(badge)

    var card = document.querySelector('.admin-login-card')
    if (card) {
      var hint = document.createElement('p')
      hint.style.cssText = 'margin-top:14px;font-size:12px;color:#64748b;background:#f1f5f9;padding:8px 10px;border-radius:8px;'
      hint.innerHTML = 'Acesso de teste: <strong>admin@teste.com</strong> — senha <strong>1234</strong>'
      card.appendChild(hint)
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montarDemoUI)
  } else {
    montarDemoUI()
  }
})()
