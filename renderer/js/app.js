'use strict'

/* ============================================================
   API BRIDGE (from preload.js via contextBridge)
   ============================================================ */
const api = window.electronAPI

/* ============================================================
   STATE
   ============================================================ */
let todosProdutos   = []
let carrinho        = []
let produtoEditId   = null
let codigoAtual     = ''
let confirmCallback = null
let relMesHoje      = null   // current report data

/* ============================================================
   UTILS
   ============================================================ */
function fmt(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function fmtMoeda(valor) { return `R$ ${fmt(valor)}` }

function fmtData(str) {
  if (!str) return '—'
  const d = new Date(str.replace(' ', 'T'))
  return isNaN(d) ? str : d.toLocaleDateString('pt-BR')
}

function fmtHora(str) {
  if (!str) return '—'
  const d = new Date(str.replace(' ', 'T'))
  return isNaN(d) ? str : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDataHora(str) {
  if (!str) return '—'
  const d = new Date(str.replace(' ', 'T'))
  return isNaN(d) ? str : `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function margem(custo, venda) {
  if (!custo || custo === 0) return '∞'
  return (((venda - custo) / custo) * 100).toFixed(1)
}

function gerarCodigoBarras() {
  const ts = Date.now().toString()
  const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `${ts.slice(-9)}${rnd}`
}

function renderBarcode(selector, codigo, opts = {}) {
  try {
    JsBarcode(selector, String(codigo), {
      format:       'CODE128',
      width:        opts.width   || 1.8,
      height:       opts.height  || 50,
      displayValue: opts.displayValue !== false,
      fontSize:     opts.fontSize || 11,
      margin:       opts.margin  !== undefined ? opts.margin : 6,
      background:   opts.background || '#ffffff',
      lineColor:    opts.lineColor  || '#000000'
    })
  } catch(e) {
    console.warn('Barcode error:', e)
  }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null

function toast(msg, type = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast ${type ? 'toast-' + type : ''}`
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200)
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal(id) {
  document.getElementById(id).classList.add('open')
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open')
}

// Generic close buttons via data-close attribute
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
})

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id)
  })
})

/* ============================================================
   CONFIRM DIALOG
   ============================================================ */
function confirmar(msg, cb) {
  document.getElementById('confirmar-msg').textContent = msg
  confirmCallback = cb
  openModal('modal-confirmar')
}

document.getElementById('btn-confirmar-nao').addEventListener('click', () => closeModal('modal-confirmar'))
document.getElementById('btn-confirmar-sim').addEventListener('click', () => {
  closeModal('modal-confirmar')
  if (confirmCallback) confirmCallback()
})

/* ============================================================
   NAVIGATION
   ============================================================ */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.section))
})

function navigateTo(section) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))

  document.querySelector(`.nav-item[data-section="${section}"]`).classList.add('active')
  document.getElementById(`section-${section}`).classList.add('active')

  if (section === 'produtos')   renderProdutos(todosProdutos)
  if (section === 'etiquetas')  preencherSelectEtiquetas()
  if (section === 'caixa')      focusCaixa()
  if (section === 'relatorios') carregarHoje()
}

/* ============================================================
   CLOCK
   ============================================================ */
function iniciarRelogio() {
  function tick() {
    const d = new Date()
    const txt = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    document.getElementById('clock').textContent = txt
  }
  tick()
  setInterval(tick, 1000)
}

/* ============================================================
   ==================  SEÇÃO: PRODUTOS  ==================
   ============================================================ */
async function carregarProdutos() {
  todosProdutos = await api.listarProdutos()
  renderProdutos(todosProdutos)
}

function renderProdutos(lista) {
  const tbody = document.getElementById('tbody-produtos')
  const count = document.getElementById('contador-produtos')
  count.textContent = `${lista.length} produto${lista.length !== 1 ? 's' : ''}`

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <div class="empty-icon">📦</div>
          <div>Nenhum produto encontrado</div>
          <div class="empty-hint">Clique em "Novo Produto" para começar</div>
        </td>
      </tr>`
    return
  }

  tbody.innerHTML = lista.map(p => {
    const m = margem(p.preco_custo, p.preco_venda)
    const cls = parseFloat(m) >= 0 ? 'positive' : 'negative'
    return `
      <tr>
        <td><code>${p.codigo_barras}</code></td>
        <td><strong>${escHtml(p.nome)}</strong></td>
        <td>${fmtMoeda(p.preco_custo)}</td>
        <td>${fmtMoeda(p.preco_venda)}</td>
        <td class="${cls}">${m}%</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-secondary" onclick="abrirEditarProduto(${p.id})">✏️ Editar</button>
            <button class="btn btn-sm btn-danger"    onclick="deletarProduto(${p.id}, '${escHtml(p.nome).replace(/'/g,"\\'")}')">🗑️</button>
          </div>
        </td>
      </tr>`
  }).join('')
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* Busca */
document.getElementById('input-busca-produto').addEventListener('input', e => {
  const q = e.target.value.toLowerCase()
  const filtrado = todosProdutos.filter(p =>
    p.nome.toLowerCase().includes(q) || p.codigo_barras.includes(q)
  )
  renderProdutos(filtrado)
})

/* Novo produto */
document.getElementById('btn-novo-produto').addEventListener('click', () => {
  produtoEditId = null
  document.getElementById('modal-produto-titulo').textContent = 'Novo Produto'
  document.getElementById('form-produto').reset()
  document.getElementById('grupo-margem-info').style.display = 'none'

  codigoAtual = gerarCodigoBarras()
  renderBarcode('#barcode-preview', codigoAtual, { height: 50, fontSize: 11 })
  document.getElementById('barcode-caption-texto').textContent = `Código: ${codigoAtual}`

  openModal('modal-produto')
  setTimeout(() => document.getElementById('produto-nome').focus(), 80)
})

/* Atualizar pré-visualização de margem */
function atualizarMargemPreview() {
  const custo = parseFloat(document.getElementById('produto-custo').value) || 0
  const venda = parseFloat(document.getElementById('produto-venda').value) || 0

  if (custo > 0 && venda > 0) {
    document.getElementById('grupo-margem-info').style.display = 'block'
    const m = margem(custo, venda)
    const el = document.getElementById('margem-preview-valor')
    el.textContent = `${m}%`
    el.className = parseFloat(m) >= 0 ? 'positive' : 'negative'
  } else {
    document.getElementById('grupo-margem-info').style.display = 'none'
  }
}

document.getElementById('produto-custo').addEventListener('input', atualizarMargemPreview)
document.getElementById('produto-venda').addEventListener('input', atualizarMargemPreview)

/* Abrir modal de edição */
function abrirEditarProduto(id) {
  const p = todosProdutos.find(x => x.id === id)
  if (!p) return

  produtoEditId = id
  document.getElementById('modal-produto-titulo').textContent = 'Editar Produto'
  document.getElementById('produto-nome').value   = p.nome
  document.getElementById('produto-custo').value  = p.preco_custo
  document.getElementById('produto-venda').value  = p.preco_venda

  codigoAtual = p.codigo_barras
  renderBarcode('#barcode-preview', codigoAtual, { height: 50, fontSize: 11 })
  document.getElementById('barcode-caption-texto').textContent = `Código: ${codigoAtual}`
  atualizarMargemPreview()

  openModal('modal-produto')
  setTimeout(() => document.getElementById('produto-nome').focus(), 80)
}

/* Salvar produto */
document.getElementById('form-produto').addEventListener('submit', async e => {
  e.preventDefault()

  const nome       = document.getElementById('produto-nome').value.trim()
  const preco_custo = parseFloat(document.getElementById('produto-custo').value)
  const preco_venda = parseFloat(document.getElementById('produto-venda').value)

  if (!nome) {
    toast('Informe o nome do produto.', 'error')
    document.getElementById('produto-nome').classList.add('input-error')
    return
  }
  if (isNaN(preco_custo) || preco_custo < 0) {
    toast('Preço de custo inválido.', 'error')
    return
  }
  if (isNaN(preco_venda) || preco_venda <= 0) {
    toast('Preço de venda inválido.', 'error')
    return
  }

  document.getElementById('produto-nome').classList.remove('input-error')

  try {
    if (produtoEditId) {
      await api.atualizarProduto(produtoEditId, { nome, preco_custo, preco_venda })
      toast('Produto atualizado com sucesso!', 'success')
    } else {
      await api.criarProduto({ nome, preco_custo, preco_venda, codigo_barras: codigoAtual })
      toast('Produto cadastrado com sucesso!', 'success')
    }
    closeModal('modal-produto')
    await carregarProdutos()
    // atualiza select de etiquetas
    preencherSelectEtiquetas()
  } catch(err) {
    toast(`Erro ao salvar: ${err.message}`, 'error')
  }
})

/* Deletar produto */
async function deletarProduto(id, nome) {
  confirmar(`Excluir o produto "${nome}"? Esta ação não pode ser desfeita.`, async () => {
    try {
      await api.deletarProduto(id)
      toast('Produto excluído.', 'success')
      await carregarProdutos()
    } catch(err) {
      toast(`Erro ao excluir: ${err.message}`, 'error')
    }
  })
}

/* ============================================================
   ==================  SEÇÃO: ETIQUETAS  ==================
   ============================================================ */
let etiquetasSel = []  // { produto, quantidade }

function preencherSelectEtiquetas() {
  const sel = document.getElementById('select-produto-etiqueta')
  const val = sel.value
  sel.innerHTML = '<option value="">— Selecione um produto —</option>' +
    todosProdutos.map(p =>
      `<option value="${p.id}">${escHtml(p.nome)}</option>`
    ).join('')
  if (val) sel.value = val
}

document.getElementById('btn-add-etiqueta').addEventListener('click', () => {
  const prodId = parseInt(document.getElementById('select-produto-etiqueta').value)
  const qtd    = parseInt(document.getElementById('input-qtd-etiqueta').value) || 1

  if (!prodId) { toast('Selecione um produto.', 'warn'); return }

  const prod = todosProdutos.find(p => p.id === prodId)
  if (!prod)  { toast('Produto não encontrado.', 'error'); return }

  const existe = etiquetasSel.find(e => e.produto.id === prodId)
  if (existe) {
    existe.quantidade += qtd
  } else {
    etiquetasSel.push({ produto: prod, quantidade: qtd })
  }

  renderEtiquetasLista()
  renderEtiquetasPreview()
})

document.getElementById('btn-limpar-etiquetas').addEventListener('click', () => {
  etiquetasSel = []
  renderEtiquetasLista()
  renderEtiquetasPreview()
})

function renderEtiquetasLista() {
  const container = document.getElementById('etiquetas-lista-container')
  const tbody     = document.getElementById('tbody-etiquetas-lista')

  if (etiquetasSel.length === 0) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'block'
  tbody.innerHTML = etiquetasSel.map((e, i) => `
    <tr>
      <td>${escHtml(e.produto.nome)}</td>
      <td>${e.quantidade}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="removerEtiqueta(${i})">Remover</button>
      </td>
    </tr>
  `).join('')
}

function removerEtiqueta(idx) {
  etiquetasSel.splice(idx, 1)
  renderEtiquetasLista()
  renderEtiquetasPreview()
}

function renderEtiquetasPreview() {
  const preview   = document.getElementById('etiquetas-preview')
  const printArea = document.getElementById('print-area')
  const infoEl    = document.getElementById('total-etiquetas-info')

  if (etiquetasSel.length === 0) {
    const html = `
      <div class="empty-state" style="padding: 40px 0; width:100%;">
        <div class="empty-icon">🏷️</div>
        <div>Adicione produtos para ver a pré-visualização</div>
      </div>`
    preview.innerHTML = html
    printArea.innerHTML = ''
    infoEl.textContent = ''
    return
  }

  const totalEtqs = etiquetasSel.reduce((s, e) => s + e.quantidade, 0)
  infoEl.textContent = `${totalEtqs} etiqueta${totalEtqs !== 1 ? 's' : ''}`

  let html = ''
  etiquetasSel.forEach(({ produto, quantidade }) => {
    for (let i = 0; i < quantidade; i++) {
      html += `
        <div class="etiqueta">
          <div class="etiqueta-nome">${escHtml(produto.nome)}</div>
          <svg class="etiqueta-barcode" data-codigo="${produto.codigo_barras}"></svg>
          <div class="etiqueta-preco">${fmtMoeda(produto.preco_venda)}</div>
        </div>`
    }
  })

  preview.innerHTML = html
  printArea.innerHTML = html

  // Renderiza código de barras em TODOS os elementos (preview + print area)
  document.querySelectorAll('.etiqueta-barcode').forEach(svg => {
    renderBarcode(svg, svg.dataset.codigo, {
      width: 1.4, height: 36, fontSize: 9, margin: 4
    })
  })
}

document.getElementById('btn-imprimir-etiquetas').addEventListener('click', () => {
  if (etiquetasSel.length === 0) {
    toast('Selecione pelo menos um produto para imprimir etiquetas.', 'warn')
    return
  }
  window.print()
})

/* ============================================================
   ==================  SEÇÃO: CAIXA  ==================
   ============================================================ */
let numVendaAtual = 1

function focusCaixa() {
  document.getElementById('data-hoje').textContent =
    new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  setTimeout(() => document.getElementById('input-barcode').focus(), 80)
}

/* Scanner / input */
document.getElementById('input-barcode').addEventListener('keydown', async e => {
  if (e.key === 'Enter') {
    e.preventDefault()
    await adicionarItem()
  }
})

document.getElementById('btn-add-item').addEventListener('click', adicionarItem)

async function adicionarItem() {
  const input  = document.getElementById('input-barcode')
  const codigo = input.value.trim()
  if (!codigo) return

  try {
    const prod = await api.buscarPorCodigo(codigo)
    if (!prod) {
      input.classList.add('error')
      toast(`Produto não encontrado: ${codigo}`, 'error')
      setTimeout(() => input.classList.remove('error'), 600)
      input.value = ''
      return
    }
    adicionarAoCarrinho(prod)
    input.value = ''
    input.focus()
  } catch(err) {
    toast(`Erro: ${err.message}`, 'error')
  }
}

/* Busca por nome no caixa */
document.getElementById('btn-buscar-produto-nome').addEventListener('click', () => {
  renderBuscaCaixa(todosProdutos)
  openModal('modal-buscar-nome')
  setTimeout(() => document.getElementById('input-busca-caixa').focus(), 80)
})

document.getElementById('input-busca-caixa').addEventListener('input', e => {
  const q = e.target.value.toLowerCase()
  renderBuscaCaixa(todosProdutos.filter(p => p.nome.toLowerCase().includes(q)))
})

function renderBuscaCaixa(lista) {
  const tbody = document.getElementById('tbody-busca-caixa')
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state" style="padding:20px 0;">Nenhum produto encontrado</td></tr>`
    return
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td>${escHtml(p.nome)}</td>
      <td><code>${p.codigo_barras}</code></td>
      <td>${fmtMoeda(p.preco_venda)}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="adicionarDoModal(${p.id})">+ Adicionar</button>
      </td>
    </tr>
  `).join('')
}

function adicionarDoModal(id) {
  const prod = todosProdutos.find(p => p.id === id)
  if (!prod) return
  adicionarAoCarrinho(prod)
  closeModal('modal-buscar-nome')
  document.getElementById('input-barcode').focus()
}

function adicionarAoCarrinho(prod) {
  const existe = carrinho.find(i => i.produto_id === prod.id)
  if (existe) {
    existe.quantidade++
  } else {
    carrinho.push({
      produto_id:     prod.id,
      nome:           prod.nome,
      quantidade:     1,
      preco_unitario: prod.preco_venda,
      preco_custo:    prod.preco_custo
    })
  }
  renderCarrinho()
}

function renderCarrinho() {
  const tbody     = document.getElementById('tbody-carrinho')
  const btnFin    = document.getElementById('btn-finalizar-venda')
  const totalEl   = document.getElementById('total-venda')
  const countEl   = document.getElementById('carrinho-count')
  const subEl     = document.getElementById('resumo-subtotal')
  const itensEl   = document.getElementById('resumo-itens')

  if (carrinho.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5" class="empty-state" style="padding: 48px 0;">
          <div class="empty-icon">🛒</div>
          <div>Carrinho vazio</div>
          <div class="empty-hint">Escaneie ou busque um produto</div>
        </td>
      </tr>`
    btnFin.disabled = true
    totalEl.textContent = 'R$ 0,00'
    countEl.textContent = '0 itens'
    subEl.textContent   = 'R$ 0,00'
    itensEl.textContent = '0'
    return
  }

  let total   = 0
  let numItens = 0
  tbody.innerHTML = carrinho.map((item, idx) => {
    const sub = item.quantidade * item.preco_unitario
    total    += sub
    numItens += item.quantidade
    return `
      <tr>
        <td><strong>${escHtml(item.nome)}</strong></td>
        <td>
          <div class="qty-control">
            <button class="btn-xs" onclick="alterarQtd(${idx}, -1)">−</button>
            <span class="qty-num">${item.quantidade}</span>
            <button class="btn-xs" onclick="alterarQtd(${idx}, +1)">+</button>
          </div>
        </td>
        <td>${fmtMoeda(item.preco_unitario)}</td>
        <td><strong>${fmtMoeda(sub)}</strong></td>
        <td>
          <button class="btn-xs" title="Remover" style="color:var(--danger);" onclick="removerDoCarrinho(${idx})">✕</button>
        </td>
      </tr>`
  }).join('')

  totalEl.textContent = fmtMoeda(total)
  subEl.textContent   = fmtMoeda(total)
  countEl.textContent = `${numItens} ${numItens !== 1 ? 'itens' : 'item'}`
  itensEl.textContent = numItens
  btnFin.disabled     = false
}

function alterarQtd(idx, delta) {
  carrinho[idx].quantidade += delta
  if (carrinho[idx].quantidade <= 0) carrinho.splice(idx, 1)
  renderCarrinho()
}

function removerDoCarrinho(idx) {
  carrinho.splice(idx, 1)
  renderCarrinho()
}

/* Finalizar venda */
document.getElementById('btn-finalizar-venda').addEventListener('click', async () => {
  if (carrinho.length === 0) return

  const total = carrinho.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0)

  try {
    await api.finalizarVenda({ itens: carrinho, total })
    document.getElementById('venda-ok-total').textContent = fmtMoeda(total)
    carrinho = []
    renderCarrinho()
    openModal('modal-venda-ok')
    numVendaAtual++
    document.getElementById('num-venda-atual').textContent = `#${numVendaAtual}`
  } catch(err) {
    toast(`Erro ao finalizar venda: ${err.message}`, 'error')
  }
})

document.getElementById('btn-nova-venda').addEventListener('click', () => {
  closeModal('modal-venda-ok')
  document.getElementById('input-barcode').focus()
})

/* Cancelar venda */
document.getElementById('btn-cancelar-venda').addEventListener('click', () => {
  if (carrinho.length === 0) { toast('Carrinho já está vazio.'); return }
  confirmar('Deseja cancelar a venda atual? Todos os itens serão removidos.', () => {
    carrinho = []
    renderCarrinho()
    toast('Venda cancelada.')
    document.getElementById('input-barcode').focus()
  })
})

/* ============================================================
   ==================  SEÇÃO: RELATÓRIOS  ==================
   ============================================================ */

/* Tabs */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active')

    if (btn.dataset.tab === 'hoje')   carregarHoje()
    if (btn.dataset.tab === 'mensal') carregarMensal()
    if (btn.dataset.tab === 'lucro')  carregarLucro()
  })
})

/* Inicializar seletores de data */
function initDateSelectors() {
  const MESES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ]
  const now  = new Date()
  const mesA  = now.getMonth() + 1
  const anoA  = now.getFullYear()
  const anos  = Array.from({ length: 5 }, (_, i) => anoA - i)

  ;['sel-mes-mensal','sel-mes-lucro'].forEach(id => {
    document.getElementById(id).innerHTML = MESES.map((m, i) =>
      `<option value="${i+1}" ${i+1===mesA?'selected':''}>${m}</option>`
    ).join('')
  })

  ;['sel-ano-mensal','sel-ano-lucro'].forEach(id => {
    document.getElementById(id).innerHTML = anos.map(a =>
      `<option value="${a}" ${a===anoA?'selected':''}>${a}</option>`
    ).join('')
  })
}

/* ------- HOJE ------- */
async function carregarHoje() {
  try {
    const dados = await api.vendasHoje()
    relMesHoje  = dados
    renderStatsHoje(dados)
    renderTabelaHoje(dados.vendas)
  } catch(err) {
    toast(`Erro ao carregar relatório: ${err.message}`, 'error')
  }
}

document.getElementById('btn-refresh-hoje').addEventListener('click', carregarHoje)

function renderStatsHoje({ totais }) {
  const d = new Date()
  const dStr = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  document.getElementById('titulo-hoje').textContent = `Vendas — ${dStr}`

  document.getElementById('stats-hoje').innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Vendas realizadas</span>
      <span class="stat-value">${totais.num_vendas}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total arrecadado</span>
      <span class="stat-value green">${fmtMoeda(totais.total_vendas)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Ticket médio</span>
      <span class="stat-value purple">${totais.num_vendas > 0 ? fmtMoeda(totais.total_vendas / totais.num_vendas) : 'R$ 0,00'}</span>
    </div>`
}

function renderTabelaHoje(vendas) {
  const tbody = document.getElementById('tbody-hoje')
  if (!vendas || vendas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:32px 0;">Nenhuma venda registrada hoje</td></tr>`
    return
  }
  tbody.innerHTML = vendas.map(v => `
    <tr>
      <td><code>#${v.id}</code></td>
      <td>${fmtHora(v.criado_em)}</td>
      <td>${v.num_itens} ${v.num_itens === 1 ? 'item' : 'itens'}</td>
      <td><strong>${fmtMoeda(v.total)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="verDetalhesVenda(${v.id})">Ver</button>
      </td>
    </tr>`
  ).join('')
}

/* ------- MENSAL ------- */
async function carregarMensal() {
  const mes = parseInt(document.getElementById('sel-mes-mensal').value)
  const ano = parseInt(document.getElementById('sel-ano-mensal').value)
  try {
    const dados = await api.vendasMensais(mes, ano)
    renderStatsMensal(dados, mes, ano)
    renderTabelaMensal(dados.vendas)
  } catch(err) {
    toast(`Erro ao carregar relatório: ${err.message}`, 'error')
  }
}

document.getElementById('btn-buscar-mensal').addEventListener('click', carregarMensal)

const MESES_PT = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function renderStatsMensal({ totais }, mes, ano) {
  document.getElementById('stats-mensal').innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Mês</span>
      <span class="stat-value" style="font-size:20px;">${MESES_PT[mes]} ${ano}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Vendas realizadas</span>
      <span class="stat-value">${totais.num_vendas}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Total arrecadado</span>
      <span class="stat-value green">${fmtMoeda(totais.total_vendas)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Ticket médio</span>
      <span class="stat-value purple">${totais.num_vendas > 0 ? fmtMoeda(totais.total_vendas / totais.num_vendas) : 'R$ 0,00'}</span>
    </div>`
}

function renderTabelaMensal(vendas) {
  const tbody = document.getElementById('tbody-mensal')
  if (!vendas || vendas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:32px 0;">Nenhuma venda neste período</td></tr>`
    return
  }
  tbody.innerHTML = vendas.map(v => `
    <tr>
      <td><code>#${v.id}</code></td>
      <td>${fmtDataHora(v.criado_em)}</td>
      <td>${v.num_itens} ${v.num_itens === 1 ? 'item' : 'itens'}</td>
      <td><strong>${fmtMoeda(v.total)}</strong></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="verDetalhesVenda(${v.id})">Ver</button>
      </td>
    </tr>`
  ).join('')
}

/* ------- LUCRO ------- */
async function carregarLucro() {
  const mes = parseInt(document.getElementById('sel-mes-lucro').value)
  const ano = parseInt(document.getElementById('sel-ano-lucro').value)
  try {
    const dados = await api.lucroMensal(mes, ano)
    renderStatsLucro(dados, mes, ano)
  } catch(err) {
    toast(`Erro ao carregar lucro: ${err.message}`, 'error')
  }
}

document.getElementById('btn-buscar-lucro').addEventListener('click', carregarLucro)

function renderStatsLucro(dados, mes, ano) {
  const { receita, custo, lucro } = dados
  const lucroPct = receita > 0 ? ((lucro / receita) * 100).toFixed(1) : '0'

  document.getElementById('stats-lucro').innerHTML = `
    <div class="stat-card">
      <span class="stat-label">Mês</span>
      <span class="stat-value" style="font-size:20px;">${MESES_PT[mes]} ${ano}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Receita total</span>
      <span class="stat-value green">${fmtMoeda(receita)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Custo total</span>
      <span class="stat-value red">${fmtMoeda(custo)}</span>
    </div>
    <div class="stat-card highlight">
      <span class="stat-label">Lucro líquido</span>
      <span class="stat-value ${lucro >= 0 ? 'green' : 'red'}">${fmtMoeda(lucro)}</span>
    </div>
    <div class="stat-card">
      <span class="stat-label">Margem de lucro</span>
      <span class="stat-value ${parseFloat(lucroPct) >= 0 ? 'purple' : 'red'}">${lucroPct}%</span>
    </div>`

  // Barra visual de composição
  const chartArea = document.getElementById('lucro-chart-area')
  if (receita > 0) {
    chartArea.style.display = 'block'
    const custoW  = ((custo / receita) * 100).toFixed(1)
    const lucroW  = ((Math.max(lucro, 0) / receita) * 100).toFixed(1)
    document.getElementById('lucro-bar-visual').innerHTML = `
      <div class="lucro-bar-wrap">
        <div class="lucro-bar-custo"  style="width:${custoW}%"></div>
        <div class="lucro-bar-lucro"  style="width:${lucroW}%"></div>
      </div>
      <div class="lucro-legend">
        <div class="legend-item">
          <div class="legend-dot" style="background:#ef4444;"></div>
          <span>Custo: ${fmtMoeda(custo)} (${custoW}%)</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background:#10b981;"></div>
          <span>Lucro: ${fmtMoeda(lucro)} (${lucroW}%)</span>
        </div>
      </div>`
  } else {
    chartArea.style.display = 'none'
  }
}

/* ------- DETALHES DE VENDA ------- */
async function verDetalhesVenda(id) {
  try {
    const { venda, itens } = await api.detalhesVenda(id)
    document.getElementById('detalhes-venda-titulo').textContent = `Venda #${id} — ${fmtDataHora(venda.criado_em)}`

    const tbody = document.getElementById('tbody-detalhes-venda')
    tbody.innerHTML = itens.map(i => `
      <tr>
        <td>${escHtml(i.nome_produto)}</td>
        <td style="text-align:center;">${i.quantidade}</td>
        <td>${fmtMoeda(i.preco_unitario)}</td>
        <td><strong>${fmtMoeda(i.preco_unitario * i.quantidade)}</strong></td>
      </tr>`
    ).join('')

    document.getElementById('detalhes-total-row').innerHTML =
      `Total: ${fmtMoeda(venda.total)}`

    openModal('modal-detalhes-venda')
  } catch(err) {
    toast(`Erro ao carregar detalhes: ${err.message}`, 'error')
  }
}

/* ============================================================
   EXPORTAR PDF
   ============================================================ */
function criarDocPDF(titulo, subtitulo) {
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // Cabeçalho
  doc.setFillColor(124, 58, 237)
  doc.rect(0, 0, 210, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Baby Store — Sistema PDV', 14, 10)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(titulo, 14, 17)

  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9)
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 210 - 14, 17, { align: 'right' })

  if (subtitulo) {
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(subtitulo, 14, 32)
  }

  return { doc, y: subtitulo ? 40 : 32 }
}

function addTabelaPDF(doc, y, headers, rows) {
  const margin  = 14
  const pageW   = 210
  const colW    = (pageW - margin * 2) / headers.length

  // Cabeçalho da tabela
  doc.setFillColor(241, 245, 249)
  doc.rect(margin, y, pageW - margin * 2, 8, 'F')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  headers.forEach((h, i) => doc.text(h, margin + colW * i + 2, y + 5.5))
  y += 9

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  rows.forEach((row, ri) => {
    if (y > 270) { doc.addPage(); y = 20 }
    if (ri % 2 === 0) {
      doc.setFillColor(248, 250, 252)
      doc.rect(margin, y, pageW - margin * 2, 7, 'F')
    }
    doc.setTextColor(30, 41, 59)
    row.forEach((cell, i) => doc.text(String(cell), margin + colW * i + 2, y + 5))
    y += 7
  })

  return y
}

/* Exportar: Hoje */
document.getElementById('btn-export-hoje').addEventListener('click', async () => {
  const dados = await api.vendasHoje()
  const { doc, y: y0 } = criarDocPDF(
    'Relatório de Vendas do Dia',
    `Data: ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
  )

  let y = y0 + 4

  // Cards de resumo
  doc.setFillColor(237, 233, 254)
  doc.roundedRect(14, y, 55, 18, 3, 3, 'F')
  doc.setTextColor(91, 33, 182)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Vendas', 16, y + 6)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(String(dados.totais.num_vendas), 16, y + 14)

  doc.setFillColor(209, 250, 229)
  doc.roundedRect(74, y, 65, 18, 3, 3, 'F')
  doc.setTextColor(5, 150, 105)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Total Arrecadado', 76, y + 6)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(fmtMoeda(dados.totais.total_vendas), 76, y + 14)

  y += 26

  const rows = (dados.vendas || []).map(v => [
    `#${v.id}`,
    fmtHora(v.criado_em),
    `${v.num_itens} ${v.num_itens===1?'item':'itens'}`,
    fmtMoeda(v.total)
  ])
  y = addTabelaPDF(doc, y, ['Nº', 'Hora', 'Itens', 'Total'], rows)

  // Rodapé
  doc.setTextColor(148, 163, 184)
  doc.setFontSize(8)
  doc.text('Baby Store PDV', 14, 290)
  doc.text('Documento gerado automaticamente', 196, 290, { align: 'right' })

  doc.save(`vendas-hoje-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.pdf`)
  toast('PDF exportado com sucesso!', 'success')
})

/* Exportar: Mensal */
document.getElementById('btn-export-mensal').addEventListener('click', async () => {
  const mes  = parseInt(document.getElementById('sel-mes-mensal').value)
  const ano  = parseInt(document.getElementById('sel-ano-mensal').value)
  const dados = await api.vendasMensais(mes, ano)

  const { doc, y: y0 } = criarDocPDF(
    'Histórico Mensal de Vendas',
    `Período: ${MESES_PT[mes]} de ${ano}`
  )

  let y = y0 + 4

  doc.setFillColor(237, 233, 254)
  doc.roundedRect(14, y, 55, 18, 3, 3, 'F')
  doc.setTextColor(91, 33, 182)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Vendas', 16, y + 6)
  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.text(String(dados.totais.num_vendas), 16, y + 14)

  doc.setFillColor(209, 250, 229)
  doc.roundedRect(74, y, 65, 18, 3, 3, 'F')
  doc.setTextColor(5, 150, 105)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Total Arrecadado', 76, y + 6)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text(fmtMoeda(dados.totais.total_vendas), 76, y + 14)

  const ticketMedio = dados.totais.num_vendas > 0
    ? dados.totais.total_vendas / dados.totais.num_vendas : 0
  doc.setFillColor(254, 243, 199)
  doc.roundedRect(144, y, 52, 18, 3, 3, 'F')
  doc.setTextColor(180, 83, 9)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Ticket Médio', 146, y + 6)
  doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text(fmtMoeda(ticketMedio), 146, y + 14)

  y += 26

  const rows = (dados.vendas || []).map(v => [
    `#${v.id}`,
    fmtDataHora(v.criado_em),
    `${v.num_itens}`,
    fmtMoeda(v.total)
  ])
  y = addTabelaPDF(doc, y, ['Nº', 'Data/Hora', 'Itens', 'Total'], rows)

  doc.setTextColor(148, 163, 184)
  doc.setFontSize(8)
  doc.text('Baby Store PDV', 14, 290)
  doc.text('Documento gerado automaticamente', 196, 290, { align: 'right' })

  doc.save(`vendas-${MESES_PT[mes].toLowerCase()}-${ano}.pdf`)
  toast('PDF exportado com sucesso!', 'success')
})

/* Exportar: Lucro */
document.getElementById('btn-export-lucro').addEventListener('click', async () => {
  const mes  = parseInt(document.getElementById('sel-mes-lucro').value)
  const ano  = parseInt(document.getElementById('sel-ano-lucro').value)
  const dados = await api.lucroMensal(mes, ano)
  const { receita, custo, lucro } = dados

  const { doc, y: y0 } = criarDocPDF(
    'Relatório de Lucratividade',
    `Período: ${MESES_PT[mes]} de ${ano}`
  )

  let y = y0 + 6

  const cards = [
    { label: 'Receita Total',  val: fmtMoeda(receita), fill: [209,250,229], text: [5,150,105] },
    { label: 'Custo Total',    val: fmtMoeda(custo),   fill: [254,226,226], text: [185,28,28] },
    { label: 'Lucro Líquido',  val: fmtMoeda(lucro),   fill: [237,233,254], text: [91,33,182] }
  ]

  cards.forEach((c, i) => {
    const x = 14 + i * 66
    doc.setFillColor(...c.fill)
    doc.roundedRect(x, y, 62, 22, 3, 3, 'F')
    doc.setTextColor(...c.text)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(c.label, x + 3, y + 8)
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text(c.val, x + 3, y + 18)
  })

  y += 32

  const lucroPct = receita > 0 ? ((lucro / receita) * 100).toFixed(1) : '0'
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text(`Margem de lucro: ${lucroPct}%`, 14, y)

  y += 14

  // Linha divisória
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.5)
  doc.line(14, y, 196, y)
  y += 10

  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text('O lucro líquido é calculado pela diferença entre o preço de venda e o preço de custo', 14, y)
  doc.text('de cada produto vendido no período selecionado.', 14, y + 6)

  doc.setTextColor(148, 163, 184)
  doc.setFontSize(8)
  doc.text('Baby Store PDV', 14, 290)
  doc.text('Documento gerado automaticamente', 196, 290, { align: 'right' })

  doc.save(`lucro-${MESES_PT[mes].toLowerCase()}-${ano}.pdf`)
  toast('PDF exportado com sucesso!', 'success')
})

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function init() {
  iniciarRelogio()
  initDateSelectors()

  try {
    await carregarProdutos()
  } catch(err) {
    toast(`Erro ao iniciar: ${err.message}`, 'error')
  }

  // Número de venda (começa pelo total + 1)
  try {
    const hoje = await api.vendasHoje()
    numVendaAtual = (hoje.totais.num_vendas || 0) + 1
    document.getElementById('num-venda-atual').textContent = `#${numVendaAtual}`
  } catch(_) {}

  // Pré-carrega data de hoje na caixa
  document.getElementById('data-hoje').textContent =
    new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // Começa focado na caixa se não há produtos
  if (todosProdutos.length === 0) {
    navigateTo('produtos')
  }
}

init()
