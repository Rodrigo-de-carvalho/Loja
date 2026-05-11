'use strict'

const api = window.electronAPI

/* ============================================================
   ESTADO
   ============================================================ */
let todosProdutos   = []
let carrinho        = []
let produtoEditId   = null
let codigoAtual     = ''
let confirmCallback = null
let isAdmin         = false
let adminEditCustoId= null

/* ============================================================
   UTILS
   ============================================================ */
function fmt(v)       { return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) }
function fmtMoeda(v)  { return `R$ ${fmt(v)}` }
function fmtHora(s)   { if(!s)return'—'; const d=new Date(s.replace(' ','T')); return isNaN(d)?s:d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) }
function fmtDH(s)     { if(!s)return'—'; const d=new Date(s.replace(' ','T')); return isNaN(d)?s:`${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` }
function margem(c,v)  { if(!c||c===0)return'—'; return (((v-c)/c)*100).toFixed(1)+'%' }
function escHtml(s)   { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

function gerarCodigoBarras() {
  return `${Date.now().toString().slice(-9)}${Math.floor(Math.random()*10000).toString().padStart(4,'0')}`
}

function renderBarcode(selector, codigo, opts={}) {
  try {
    JsBarcode(selector, String(codigo), {
      format:'CODE128', width:opts.width||1.8, height:opts.height||50,
      displayValue:opts.displayValue!==false, fontSize:opts.fontSize||11,
      margin:opts.margin!==undefined?opts.margin:6,
      background:'#ffffff', lineColor:'#000000'
    })
  } catch(e) { console.warn('Barcode:', e) }
}

const PAGAMENTO_LABEL = {
  pix:      '📱 PIX',
  debito:   '💳 Débito',
  credito:  '💳 Crédito',
  dinheiro: '💵 Dinheiro'
}

const MESES_PT = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

/* ============================================================
   CRYPTO — hash SHA-256 usando Web Crypto API (Electron/Chromium)
   ============================================================ */
async function hashStr(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null
function toast(msg, type='') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast${type?' toast-'+type:''}`
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(()=>el.classList.remove('show'), 3200)
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal(id)  { document.getElementById(id).classList.add('open') }
function closeModal(id) { document.getElementById(id).classList.remove('open') }

document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
)
document.querySelectorAll('.modal-overlay').forEach(overlay =>
  overlay.addEventListener('click', e => { if(e.target===overlay) closeModal(overlay.id) })
)

/* ============================================================
   CONFIRMAR
   ============================================================ */
function confirmar(msg, cb) {
  document.getElementById('confirmar-msg').textContent = msg
  confirmCallback = cb
  openModal('modal-confirmar')
}
document.getElementById('btn-confirmar-nao').addEventListener('click', ()=>closeModal('modal-confirmar'))
document.getElementById('btn-confirmar-sim').addEventListener('click', ()=>{
  closeModal('modal-confirmar')
  if(confirmCallback) confirmCallback()
})

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
document.querySelectorAll('.nav-item').forEach(item =>
  item.addEventListener('click', ()=>navigateTo(item.dataset.section))
)

function navigateTo(section) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.querySelector(`.nav-item[data-section="${section}"]`).classList.add('active')
  document.getElementById(`section-${section}`).classList.add('active')

  if (section === 'produtos')   renderProdutos(todosProdutos)
  if (section === 'etiquetas')  preencherSelectEtiquetas()
  if (section === 'caixa')      focusCaixa()
  if (section === 'relatorios') carregarHoje()
  if (section === 'admin')      renderAdminState()
}

/* ============================================================
   RELÓGIO
   ============================================================ */
function iniciarRelogio() {
  const tick = () => {
    document.getElementById('clock').textContent =
      new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
  }
  tick(); setInterval(tick, 1000)
}

/* ============================================================
   PRODUTOS
   ============================================================ */
async function carregarProdutos() {
  todosProdutos = await api.listarProdutos()
  renderProdutos(todosProdutos)
}

function renderProdutos(lista) {
  document.getElementById('contador-produtos').textContent =
    `${lista.length} produto${lista.length!==1?'s':''}`

  const tbody = document.getElementById('tbody-produtos')
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">
      <div class="empty-icon">📦</div>
      <div>Nenhum produto encontrado</div>
      <div class="empty-hint">Clique em "Novo Produto" para começar</div>
    </td></tr>`
    return
  }

  tbody.innerHTML = lista.map(p => {
    const estBadge = p.estoque <= 0
      ? `<span class="badge-estoque-baixo">0</span>`
      : p.estoque <= 3
        ? `<span class="badge-estoque-aviso">${p.estoque}</span>`
        : `<span class="badge-estoque-ok">${p.estoque}</span>`

    return `
      <tr>
        <td><code>${p.codigo_barras}</code></td>
        <td><strong>${escHtml(p.nome)}</strong></td>
        <td>${fmtMoeda(p.preco_venda)}</td>
        <td>${estBadge}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-secondary" onclick="abrirEditarProduto(${p.id})">✏️ Editar</button>
            <button class="btn btn-sm btn-danger"    onclick="deletarProduto(${p.id},'${escHtml(p.nome).replace(/'/g,"\\'")}')">🗑️</button>
          </div>
        </td>
      </tr>`
  }).join('')
}

document.getElementById('input-busca-produto').addEventListener('input', e => {
  const q = e.target.value.toLowerCase()
  renderProdutos(todosProdutos.filter(p =>
    p.nome.toLowerCase().includes(q) || p.codigo_barras.includes(q)
  ))
})

/* Novo produto */
document.getElementById('btn-novo-produto').addEventListener('click', () => {
  produtoEditId = null
  document.getElementById('modal-produto-titulo').textContent = 'Novo Produto'
  document.getElementById('form-produto').reset()
  codigoAtual = gerarCodigoBarras()
  renderBarcode('#barcode-preview', codigoAtual, {height:50,fontSize:11})
  document.getElementById('barcode-caption-texto').textContent = `Código: ${codigoAtual}`
  openModal('modal-produto')
  setTimeout(()=>document.getElementById('produto-nome').focus(), 80)
})

function abrirEditarProduto(id) {
  const p = todosProdutos.find(x=>x.id===id); if(!p) return
  produtoEditId = id
  document.getElementById('modal-produto-titulo').textContent = 'Editar Produto'
  document.getElementById('produto-nome').value    = p.nome
  document.getElementById('produto-venda').value   = p.preco_venda
  document.getElementById('produto-estoque').value = p.estoque
  codigoAtual = p.codigo_barras
  renderBarcode('#barcode-preview', codigoAtual, {height:50,fontSize:11})
  document.getElementById('barcode-caption-texto').textContent = `Código: ${codigoAtual}`
  openModal('modal-produto')
  setTimeout(()=>document.getElementById('produto-nome').focus(), 80)
}

document.getElementById('form-produto').addEventListener('submit', async e => {
  e.preventDefault()
  const nome      = document.getElementById('produto-nome').value.trim()
  const preco_venda = parseFloat(document.getElementById('produto-venda').value)
  const estoque   = parseInt(document.getElementById('produto-estoque').value) || 0

  if (!nome)                        { toast('Informe o nome do produto.','error'); return }
  if (isNaN(preco_venda)||preco_venda<=0) { toast('Preço de venda inválido.','error'); return }

  try {
    if (produtoEditId) {
      await api.atualizarProduto(produtoEditId, { nome, preco_venda })
      // Atualiza estoque via admin handler para manter a regra
      await api.adminAtualizarEstoque(produtoEditId, estoque)
      toast('Produto atualizado!', 'success')
    } else {
      await api.criarProduto({ nome, preco_venda, codigo_barras: codigoAtual, estoque })
      toast('Produto cadastrado!', 'success')
    }
    closeModal('modal-produto')
    await carregarProdutos()
    preencherSelectEtiquetas()
  } catch(err) { toast(`Erro: ${err.message}`, 'error') }
})

async function deletarProduto(id, nome) {
  confirmar(`Excluir o produto "${nome}"? Esta ação não pode ser desfeita.`, async () => {
    try {
      await api.deletarProduto(id)
      toast('Produto excluído.', 'success')
      await carregarProdutos()
    } catch(err) { toast(`Erro: ${err.message}`, 'error') }
  })
}

/* ============================================================
   ETIQUETAS
   ============================================================ */
let etiquetasSel = []

function preencherSelectEtiquetas() {
  const sel = document.getElementById('select-produto-etiqueta')
  const val = sel.value
  sel.innerHTML = '<option value="">— Selecione —</option>' +
    todosProdutos.map(p=>`<option value="${p.id}">${escHtml(p.nome)}</option>`).join('')
  if (val) sel.value = val
}

document.getElementById('btn-add-etiqueta').addEventListener('click', () => {
  const prodId = parseInt(document.getElementById('select-produto-etiqueta').value)
  const qtd    = parseInt(document.getElementById('input-qtd-etiqueta').value) || 1
  if (!prodId) { toast('Selecione um produto.','warn'); return }
  const prod = todosProdutos.find(p=>p.id===prodId)
  if (!prod) { toast('Produto não encontrado.','error'); return }
  const existe = etiquetasSel.find(e=>e.produto.id===prodId)
  existe ? (existe.quantidade += qtd) : etiquetasSel.push({produto:prod, quantidade:qtd})
  renderEtiquetasLista()
  renderEtiquetasPreview()
})

document.getElementById('btn-limpar-etiquetas').addEventListener('click', ()=>{
  etiquetasSel=[]; renderEtiquetasLista(); renderEtiquetasPreview()
})

function renderEtiquetasLista() {
  const container = document.getElementById('etiquetas-lista-container')
  if (!etiquetasSel.length) { container.style.display='none'; return }
  container.style.display = 'block'
  document.getElementById('tbody-etiquetas-lista').innerHTML = etiquetasSel.map((e,i)=>`
    <tr>
      <td>${escHtml(e.produto.nome)}</td>
      <td>${e.quantidade}</td>
      <td><button class="btn btn-sm btn-danger" onclick="removerEtiqueta(${i})">Remover</button></td>
    </tr>`).join('')
}

function removerEtiqueta(idx) { etiquetasSel.splice(idx,1); renderEtiquetasLista(); renderEtiquetasPreview() }

function renderEtiquetasPreview() {
  const preview   = document.getElementById('etiquetas-preview')
  const printArea = document.getElementById('print-area')
  const infoEl    = document.getElementById('total-etiquetas-info')

  if (!etiquetasSel.length) {
    preview.innerHTML = `<div class="empty-state" style="padding:40px 0;width:100%;"><div class="empty-icon">🏷️</div><div>Adicione produtos para visualizar</div></div>`
    printArea.innerHTML = ''
    infoEl.textContent = ''
    return
  }

  const total = etiquetasSel.reduce((s,e)=>s+e.quantidade,0)
  infoEl.textContent = `${total} etiqueta${total!==1?'s':''}`

  let html = ''
  etiquetasSel.forEach(({produto,quantidade})=>{
    for(let i=0;i<quantidade;i++){
      html += `<div class="etiqueta">
        <div class="etiqueta-nome">${escHtml(produto.nome)}</div>
        <svg class="etiqueta-barcode" data-codigo="${produto.codigo_barras}"></svg>
        <div class="etiqueta-preco">${fmtMoeda(produto.preco_venda)}</div>
      </div>`
    }
  })

  preview.innerHTML = html
  printArea.innerHTML = html
  document.querySelectorAll('.etiqueta-barcode').forEach(svg =>
    renderBarcode(svg, svg.dataset.codigo, {width:1.4,height:36,fontSize:9,margin:4})
  )
}

document.getElementById('btn-imprimir-etiquetas').addEventListener('click', ()=>{
  if (!etiquetasSel.length) { toast('Selecione ao menos um produto.','warn'); return }
  window.print()
})

/* ============================================================
   CAIXA
   ============================================================ */
function focusCaixa() {
  document.getElementById('data-hoje').textContent =
    new Date().toLocaleDateString('pt-BR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
  setTimeout(()=>document.getElementById('input-barcode').focus(), 80)
}

document.getElementById('input-barcode').addEventListener('keydown', async e=>{
  if(e.key==='Enter'){ e.preventDefault(); await adicionarItem() }
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
      toast(`Produto não encontrado: ${codigo}`,'error')
      setTimeout(()=>input.classList.remove('error'),600)
      input.value = ''
      return
    }
    adicionarAoCarrinho(prod)
    input.value = ''
    input.focus()
  } catch(err) { toast(`Erro: ${err.message}`,'error') }
}

/* Busca por nome */
document.getElementById('btn-buscar-produto-nome').addEventListener('click', ()=>{
  renderBuscaCaixa(todosProdutos)
  openModal('modal-buscar-nome')
  setTimeout(()=>document.getElementById('input-busca-caixa').focus(),80)
})
document.getElementById('input-busca-caixa').addEventListener('input', e=>{
  const q = e.target.value.toLowerCase()
  renderBuscaCaixa(todosProdutos.filter(p=>p.nome.toLowerCase().includes(q)))
})

function renderBuscaCaixa(lista) {
  const tbody = document.getElementById('tbody-busca-caixa')
  if (!lista.length) {
    tbody.innerHTML=`<tr><td colspan="5" class="empty-state" style="padding:20px 0;">Nenhum produto encontrado</td></tr>`
    return
  }
  tbody.innerHTML = lista.map(p=>{
    const estOk = p.estoque > 0
    return `<tr>
      <td>${escHtml(p.nome)}</td>
      <td><code>${p.codigo_barras}</code></td>
      <td>${fmtMoeda(p.preco_venda)}</td>
      <td>${estOk?`<span class="badge-estoque-ok">${p.estoque}</span>`:`<span class="badge-estoque-baixo">0</span>`}</td>
      <td><button class="btn btn-sm btn-primary" onclick="adicionarDoModal(${p.id})">+ Adicionar</button></td>
    </tr>`
  }).join('')
}

function adicionarDoModal(id) {
  const prod = todosProdutos.find(p=>p.id===id); if(!prod) return
  adicionarAoCarrinho(prod)
  closeModal('modal-buscar-nome')
  document.getElementById('input-barcode').focus()
}

function adicionarAoCarrinho(prod) {
  const existe = carrinho.find(i=>i.produto_id===prod.id)
  existe
    ? existe.quantidade++
    : carrinho.push({produto_id:prod.id, nome:prod.nome, quantidade:1,
                     preco_unitario:prod.preco_venda, preco_custo:prod.preco_custo})
  renderCarrinho()
}

function renderCarrinho() {
  const tbody   = document.getElementById('tbody-carrinho')
  const btnFin  = document.getElementById('btn-finalizar-venda')
  const totalEl = document.getElementById('total-venda')
  const countEl = document.getElementById('carrinho-count')
  const subEl   = document.getElementById('resumo-subtotal')
  const itensEl = document.getElementById('resumo-itens')

  if (!carrinho.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5" class="empty-state" style="padding:48px 0;">
      <div class="empty-icon">🛒</div><div>Carrinho vazio</div>
      <div class="empty-hint">Escaneie ou busque um produto</div>
    </td></tr>`
    btnFin.disabled = true
    totalEl.textContent = 'R$ 0,00'
    countEl.textContent = '0 itens'
    subEl.textContent   = 'R$ 0,00'
    itensEl.textContent = '0'
    return
  }

  let total=0, numItens=0
  tbody.innerHTML = carrinho.map((item,idx)=>{
    const sub = item.quantidade * item.preco_unitario
    total    += sub
    numItens += item.quantidade
    return `<tr>
      <td><strong>${escHtml(item.nome)}</strong></td>
      <td>
        <div class="qty-control">
          <button class="btn-xs" onclick="alterarQtd(${idx},-1)">−</button>
          <span class="qty-num">${item.quantidade}</span>
          <button class="btn-xs" onclick="alterarQtd(${idx},+1)">+</button>
        </div>
      </td>
      <td>${fmtMoeda(item.preco_unitario)}</td>
      <td><strong>${fmtMoeda(sub)}</strong></td>
      <td><button class="btn-xs" style="color:var(--danger);" onclick="removerDoCarrinho(${idx})">✕</button></td>
    </tr>`
  }).join('')

  totalEl.textContent = fmtMoeda(total)
  subEl.textContent   = fmtMoeda(total)
  countEl.textContent = `${numItens} ${numItens!==1?'itens':'item'}`
  itensEl.textContent = numItens
  btnFin.disabled     = false
}

function alterarQtd(idx, delta) {
  carrinho[idx].quantidade += delta
  if (carrinho[idx].quantidade<=0) carrinho.splice(idx,1)
  renderCarrinho()
}
function removerDoCarrinho(idx) { carrinho.splice(idx,1); renderCarrinho() }

/* Finalizar → abre modal de pagamento */
document.getElementById('btn-finalizar-venda').addEventListener('click', ()=>{
  if (!carrinho.length) return
  const total = carrinho.reduce((s,i)=>s+i.quantidade*i.preco_unitario,0)
  document.getElementById('pagamento-total-valor').textContent = fmtMoeda(total)
  openModal('modal-pagamento')
})

/* Botões de pagamento */
document.querySelectorAll('.pagamento-btn').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const pagamento = btn.dataset.pag
    const total = carrinho.reduce((s,i)=>s+i.quantidade*i.preco_unitario,0)
    try {
      await api.finalizarVenda({itens:carrinho, total, pagamento})
      document.getElementById('venda-ok-total').textContent = fmtMoeda(total)
      document.getElementById('venda-ok-pagamento').textContent = PAGAMENTO_LABEL[pagamento]||pagamento
      closeModal('modal-pagamento')
      carrinho = []
      renderCarrinho()
      await carregarProdutos() // atualiza estoque
      openModal('modal-venda-ok')
    } catch(err) { toast(`Erro ao finalizar: ${err.message}`,'error') }
  })
})

document.getElementById('btn-nova-venda').addEventListener('click', ()=>{
  closeModal('modal-venda-ok')
  document.getElementById('input-barcode').focus()
})

document.getElementById('btn-cancelar-venda').addEventListener('click', ()=>{
  if (!carrinho.length) { toast('Carrinho já está vazio.'); return }
  confirmar('Deseja cancelar a venda? Todos os itens serão removidos.', ()=>{
    carrinho = []; renderCarrinho(); toast('Venda cancelada.')
    document.getElementById('input-barcode').focus()
  })
})

/* ============================================================
   RELATÓRIOS (operador — sem lucro)
   ============================================================ */
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.remove('active'))
    document.querySelectorAll('.tab-pane[id^="tab-"]').forEach(p=>p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active')
    if(btn.dataset.tab==='hoje')   carregarHoje()
    if(btn.dataset.tab==='mensal') carregarMensal()
  })
})

function initDateSelectors() {
  const now = new Date()
  const mesA = now.getMonth()+1, anoA = now.getFullYear()
  const anos = Array.from({length:5},(_,i)=>anoA-i)
  const mesOpts = MESES_PT.slice(1).map((m,i)=>`<option value="${i+1}"${i+1===mesA?' selected':''}>${m}</option>`).join('')
  const anoOpts = anos.map(a=>`<option value="${a}"${a===anoA?' selected':''}>${a}</option>`).join('')

  ;['sel-mes-mensal'].forEach(id=>{ document.getElementById(id).innerHTML=mesOpts })
  ;['sel-ano-mensal'].forEach(id=>{ document.getElementById(id).innerHTML=anoOpts })

  // Admin selectors
  ;['admin-sel-mes-lucro'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=mesOpts })
  ;['admin-sel-ano-lucro'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=anoOpts })
}

async function carregarHoje() {
  const dados = await api.vendasHoje()
  const d = new Date()
  document.getElementById('titulo-hoje').textContent =
    `Vendas — ${d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}`
  document.getElementById('stats-hoje').innerHTML = `
    <div class="stat-card"><span class="stat-label">Vendas realizadas</span><span class="stat-value">${dados.totais.num_vendas}</span></div>
    <div class="stat-card"><span class="stat-label">Total arrecadado</span><span class="stat-value green">${fmtMoeda(dados.totais.total_vendas)}</span></div>
    <div class="stat-card"><span class="stat-label">Ticket médio</span><span class="stat-value purple">${dados.totais.num_vendas>0?fmtMoeda(dados.totais.total_vendas/dados.totais.num_vendas):'R$ 0,00'}</span></div>`

  const tbody = document.getElementById('tbody-hoje')
  tbody.innerHTML = !dados.vendas.length
    ? `<tr><td colspan="6" class="empty-state" style="padding:32px 0;">Nenhuma venda hoje</td></tr>`
    : dados.vendas.map(v=>`<tr>
        <td><code>#${v.id}</code></td>
        <td>${fmtHora(v.criado_em)}</td>
        <td><span class="badge-pagamento">${PAGAMENTO_LABEL[v.pagamento]||v.pagamento}</span></td>
        <td>${v.num_itens} ${v.num_itens===1?'item':'itens'}</td>
        <td><strong>${fmtMoeda(v.total)}</strong></td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-outline" onclick="verDetalhesVenda(${v.id})">Ver</button>
            <button class="btn btn-sm btn-estorno" onclick="estornarVenda(${v.id})">↩ Estornar</button>
          </div>
        </td>
      </tr>`).join('')
}

document.getElementById('btn-refresh-hoje').addEventListener('click', carregarHoje)

async function carregarMensal() {
  const mes = parseInt(document.getElementById('sel-mes-mensal').value)
  const ano = parseInt(document.getElementById('sel-ano-mensal').value)
  const dados = await api.vendasMensais(mes, ano)
  document.getElementById('stats-mensal').innerHTML = `
    <div class="stat-card"><span class="stat-label">Mês</span><span class="stat-value" style="font-size:18px;">${MESES_PT[mes]} ${ano}</span></div>
    <div class="stat-card"><span class="stat-label">Vendas</span><span class="stat-value">${dados.totais.num_vendas}</span></div>
    <div class="stat-card"><span class="stat-label">Total arrecadado</span><span class="stat-value green">${fmtMoeda(dados.totais.total_vendas)}</span></div>
    <div class="stat-card"><span class="stat-label">Ticket médio</span><span class="stat-value purple">${dados.totais.num_vendas>0?fmtMoeda(dados.totais.total_vendas/dados.totais.num_vendas):'R$ 0,00'}</span></div>`

  const tbody = document.getElementById('tbody-mensal')
  tbody.innerHTML = !dados.vendas.length
    ? `<tr><td colspan="6" class="empty-state" style="padding:32px 0;">Nenhuma venda neste período</td></tr>`
    : dados.vendas.map(v=>`<tr>
        <td><code>#${v.id}</code></td>
        <td>${fmtDH(v.criado_em)}</td>
        <td><span class="badge-pagamento">${PAGAMENTO_LABEL[v.pagamento]||v.pagamento}</span></td>
        <td>${v.num_itens} ${v.num_itens===1?'item':'itens'}</td>
        <td><strong>${fmtMoeda(v.total)}</strong></td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-outline" onclick="verDetalhesVenda(${v.id})">Ver</button>
            <button class="btn btn-sm btn-estorno" onclick="estornarVenda(${v.id})">↩ Estornar</button>
          </div>
        </td>
      </tr>`).join('')
}

document.getElementById('btn-buscar-mensal').addEventListener('click', carregarMensal)

/* Detalhes venda */
async function verDetalhesVenda(id) {
  const {venda, itens} = await api.detalhesVenda(id)
  document.getElementById('detalhes-venda-titulo').textContent =
    `Venda #${id} — ${fmtDH(venda.criado_em)} — ${PAGAMENTO_LABEL[venda.pagamento]||venda.pagamento}`
  document.getElementById('tbody-detalhes-venda').innerHTML = itens.map(i=>`
    <tr>
      <td>${escHtml(i.nome_produto)}</td>
      <td style="text-align:center;">${i.quantidade}</td>
      <td>${fmtMoeda(i.preco_unitario)}</td>
      <td><strong>${fmtMoeda(i.preco_unitario*i.quantidade)}</strong></td>
    </tr>`).join('')
  document.getElementById('detalhes-total-row').innerHTML = `Total: ${fmtMoeda(venda.total)}`
  openModal('modal-detalhes-venda')
}

/* ============================================================
   PDF — UTILITÁRIOS DE LAYOUT
   ============================================================ */

function _novoPDF() {
  const { jsPDF } = window.jspdf
  return new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
}

/* Cabeçalho do relatório */
function _pdfHeader(doc, titulo, periodo, isConfidential = false) {
  const W = 210

  // Barra roxa escura de fundo
  doc.setFillColor(30, 27, 75)
  doc.rect(0, 0, W, 30, 'F')

  // Faixa roxa principal (2/3 esquerda)
  doc.setFillColor(109, 40, 217)
  doc.rect(0, 0, 130, 30, 'F')

  // Triângulo decorativo (transição suave simulada)
  doc.setFillColor(91, 33, 182)
  doc.rect(110, 0, 30, 30, 'F')

  // Ícone decorativo (círculos concêntricos)
  doc.setFillColor(167, 139, 250)
  doc.circle(190, 15, 12, 'F')
  doc.setFillColor(124, 58, 237)
  doc.circle(190, 15, 8, 'F')
  doc.setFillColor(196, 181, 253)
  doc.circle(190, 15, 3.5, 'F')

  // Nome da loja
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Baby Store', 14, 13)

  // Slogan / sistema
  doc.setTextColor(196, 181, 253)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Sistema de Ponto de Venda', 14, 20)

  // Data de geração (canto direito)
  doc.setTextColor(167, 139, 250)
  doc.setFontSize(7)
  doc.text(new Date().toLocaleString('pt-BR'), 168, 20, { align: 'right' })

  // Faixa de título do relatório (cinza claro)
  const titleBarY = 30
  doc.setFillColor(248, 250, 252)
  doc.rect(0, titleBarY, W, 18, 'F')
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.line(0, titleBarY + 18, W, titleBarY + 18)

  // Título
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(titulo, 14, titleBarY + 8)

  // Período / subtítulo
  if (periodo) {
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(periodo, 14, titleBarY + 14)
  }

  // Badge confidencial
  if (isConfidential) {
    doc.setFillColor(254, 226, 226)
    doc.setDrawColor(252, 165, 165)
    doc.roundedRect(W - 50, titleBarY + 4, 36, 9, 2, 2, 'FD')
    doc.setTextColor(185, 28, 28)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text('CONFIDENCIAL', W - 32, titleBarY + 9.5, { align: 'center' })
  }

  return titleBarY + 18 + 8 // y após o cabeçalho
}

/* Cards de resumo */
function _pdfCards(doc, y, cards) {
  const m    = 14
  const W    = 210
  const gap  = 5
  const n    = cards.length
  const cW   = (W - m * 2 - gap * (n - 1)) / n
  const cH   = 24

  const SCHEMES = {
    purple: { accent: [109, 40, 217], bg: [237, 233, 254], label: [91, 33, 182],  value: [109, 40, 217] },
    green:  { accent: [5, 150, 105],  bg: [209, 250, 229], label: [6, 78, 59],    value: [4, 120, 87]   },
    red:    { accent: [185, 28, 28],  bg: [254, 226, 226], label: [127, 29, 29],  value: [185, 28, 28]  },
    orange: { accent: [180, 83, 9],   bg: [254, 243, 199], label: [120, 53, 15],  value: [146, 64, 14]  },
    gray:   { accent: [71, 85, 105],  bg: [241, 245, 249], label: [71, 85, 105],  value: [30, 41, 59]   },
  }

  cards.forEach((card, i) => {
    const x = m + i * (cW + gap)
    const s = SCHEMES[card.color] || SCHEMES.gray

    // Fundo do card
    doc.setFillColor(...s.bg)
    doc.setDrawColor(...s.bg)
    doc.roundedRect(x, y, cW, cH, 2, 2, 'FD')

    // Barra de acento esquerda
    doc.setFillColor(...s.accent)
    doc.roundedRect(x, y, 3, cH, 1, 1, 'F')

    // Label
    doc.setTextColor(...s.label)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text(card.label.toUpperCase(), x + 6, y + 7)

    // Valor
    doc.setTextColor(...s.value)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(String(card.value), x + 6, y + 18)
  })

  return y + cH + 7
}

/* Tabela de dados */
function _pdfTable(doc, y, { headers, colWidths, aligns, rows }) {
  const m      = 14
  const W      = 210
  const hH     = 9    // altura do cabeçalho
  const rH     = 7.5  // altura das linhas
  const tableW = W - m * 2

  const desenharHeader = (posY) => {
    doc.setFillColor(30, 41, 59)
    doc.rect(m, posY, tableW, hH, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    let xc = m
    headers.forEach((h, i) => {
      const al = aligns?.[i] || 'left'
      const xT = al === 'right' ? xc + colWidths[i] - 3 : (al === 'center' ? xc + colWidths[i] / 2 : xc + 3)
      doc.text(h, xT, posY + 6, { align: al })
      xc += colWidths[i]
    })
    return posY + hH
  }

  y = desenharHeader(y)

  rows.forEach((row, ri) => {
    if (y + rH > 280) {
      doc.addPage()
      y = 20
      y = desenharHeader(y)
    }

    // Fundo alternado
    doc.setFillColor(ri % 2 === 0 ? 248 : 255, ri % 2 === 0 ? 250 : 255, ri % 2 === 0 ? 252 : 255)
    doc.rect(m, y, tableW, rH, 'F')

    // Linha divisória inferior
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.line(m, y + rH, m + tableW, y + rH)

    // Células
    let xc = m
    row.forEach((cell, i) => {
      const al = aligns?.[i] || 'left'
      const xT = al === 'right' ? xc + colWidths[i] - 3 : (al === 'center' ? xc + colWidths[i] / 2 : xc + 3)
      doc.setTextColor(30, 41, 59)
      doc.setFontSize(8.5)
      // Coluna Nº e Total em negrito
      doc.setFont('helvetica', (i === 0 || i === row.length - 1) ? 'bold' : 'normal')
      doc.text(String(cell), xT, y + 5.2, { align: al })
      xc += colWidths[i]
    })

    y += rH
  })

  // Borda externa da tabela
  const tableStartY = y - rows.length * rH - hH
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.5)
  doc.rect(m, tableStartY, tableW, rows.length * rH + hH, 'S')

  return y + 5
}

/* Linha totalizadora abaixo da tabela */
function _pdfTotalRow(doc, y, label, valor) {
  const m = 14, W = 210
  doc.setFillColor(30, 41, 59)
  doc.rect(m, y, W - m * 2, 9, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(label, m + 3, y + 6)
  doc.text(valor, W - m - 3, y + 6, { align: 'right' })
  return y + 9 + 4
}

/* Rodapé em todas as páginas */
function _pdfFooter(doc, isConfidential = false) {
  const totalPages = doc.internal.getNumberOfPages()
  const W = 210
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.5)
    doc.line(14, 285, W - 14, 285)
    doc.setTextColor(148, 163, 184)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('Baby Store — Sistema PDV', 14, 290)
    doc.text(`Página ${p} de ${totalPages}`, W / 2, 290, { align: 'center' })
    const footerRight = isConfidential ? '🔒 Documento confidencial' : 'Gerado automaticamente'
    doc.text(footerRight, W - 14, 290, { align: 'right' })
  }
}

/* Mensagem de "sem dados" */
function _pdfSemDados(doc, y, msg = 'Nenhum registro encontrado para este período.') {
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.roundedRect(14, y, 182, 16, 2, 2, 'FD')
  doc.setTextColor(148, 163, 184)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.text(msg, 105, y + 10, { align: 'center' })
  return y + 22
}

/* ============================================================
   PDF — EXPORTAR: VENDAS DE HOJE
   ============================================================ */
document.getElementById('btn-export-hoje').addEventListener('click', async () => {
  const dados = await api.vendasHoje()
  const doc   = _novoPDF()
  const hoje  = new Date()
  const periodoStr = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  let y = _pdfHeader(doc, 'Relatório de Vendas do Dia', periodoStr)

  const ticket = dados.totais.num_vendas > 0
    ? dados.totais.total_vendas / dados.totais.num_vendas : 0

  y = _pdfCards(doc, y, [
    { label: 'Vendas realizadas', value: String(dados.totais.num_vendas), color: 'purple' },
    { label: 'Total arrecadado',  value: fmtMoeda(dados.totais.total_vendas), color: 'green'  },
    { label: 'Ticket médio',      value: fmtMoeda(ticket),                    color: 'gray'   },
  ])

  if (dados.vendas.length > 0) {
    y = _pdfTable(doc, y, {
      headers:   ['Nº', 'Hora', 'Forma de Pagamento', 'Itens', 'Total (R$)'],
      colWidths: [18,   22,     68,                   22,      52],
      aligns:    ['left','left','left',                'center','right'],
      rows: dados.vendas.map(v => [
        `#${v.id}`,
        fmtHora(v.criado_em),
        PAGAMENTO_LABEL[v.pagamento] || v.pagamento,
        String(v.num_itens),
        fmtMoeda(v.total)
      ])
    })
    _pdfTotalRow(doc, y - 5, 'TOTAL DO DIA', fmtMoeda(dados.totais.total_vendas))
  } else {
    _pdfSemDados(doc, y, 'Nenhuma venda registrada hoje.')
  }

  _pdfFooter(doc)
  doc.save(`vendas-hoje-${hoje.toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`)
  toast('PDF exportado com sucesso!', 'success')
})

/* ============================================================
   PDF — EXPORTAR: HISTÓRICO MENSAL
   ============================================================ */
document.getElementById('btn-export-mensal').addEventListener('click', async () => {
  const mes   = parseInt(document.getElementById('sel-mes-mensal').value)
  const ano   = parseInt(document.getElementById('sel-ano-mensal').value)
  const dados = await api.vendasMensais(mes, ano)
  const doc   = _novoPDF()

  let y = _pdfHeader(doc, 'Histórico Mensal de Vendas', `Período: ${MESES_PT[mes]} de ${ano}`)

  const ticket = dados.totais.num_vendas > 0
    ? dados.totais.total_vendas / dados.totais.num_vendas : 0

  y = _pdfCards(doc, y, [
    { label: 'Vendas no mês',    value: String(dados.totais.num_vendas),      color: 'purple' },
    { label: 'Total arrecadado', value: fmtMoeda(dados.totais.total_vendas),  color: 'green'  },
    { label: 'Ticket médio',     value: fmtMoeda(ticket),                     color: 'gray'   },
  ])

  if (dados.vendas.length > 0) {
    y = _pdfTable(doc, y, {
      headers:   ['Nº', 'Data / Hora', 'Forma de Pagamento', 'Itens', 'Total (R$)'],
      colWidths: [18,   42,            60,                   20,      42],
      aligns:    ['left','left',        'left',               'center','right'],
      rows: dados.vendas.map(v => [
        `#${v.id}`,
        fmtDH(v.criado_em),
        PAGAMENTO_LABEL[v.pagamento] || v.pagamento,
        String(v.num_itens),
        fmtMoeda(v.total)
      ])
    })
    _pdfTotalRow(doc, y - 5, `TOTAL DE ${MESES_PT[mes].toUpperCase()}/${ano}`, fmtMoeda(dados.totais.total_vendas))
  } else {
    _pdfSemDados(doc, y, `Nenhuma venda em ${MESES_PT[mes]}/${ano}.`)
  }

  _pdfFooter(doc)
  doc.save(`vendas-${MESES_PT[mes].toLowerCase()}-${ano}.pdf`)
  toast('PDF exportado com sucesso!', 'success')
})

/* ============================================================
   ADMINISTRADOR
   ============================================================ */
function renderAdminState() {
  document.getElementById('admin-login-wall').style.display = isAdmin ? 'none' : 'flex'
  document.getElementById('admin-painel').style.display     = isAdmin ? 'block' : 'none'
  if (isAdmin) carregarAdminCustos()
}

/* Login */
document.getElementById('btn-admin-login').addEventListener('click', async ()=>{
  const email = document.getElementById('admin-email').value.trim()
  const senha = document.getElementById('admin-senha').value
  const errEl = document.getElementById('admin-error')
  errEl.style.display = 'none'
  if (!email||!senha) { errEl.style.display='block'; errEl.textContent='Preencha todos os campos.'; return }
  try {
    const eH = await hashStr(email)
    const sH = await hashStr(senha)
    const ok = await api.verificarAdmin(eH, sH)
    if (ok) {
      isAdmin = true
      document.getElementById('admin-email').value = ''
      document.getElementById('admin-senha').value = ''
      renderAdminState()
    } else {
      errEl.style.display = 'block'
      errEl.textContent   = 'E-mail ou senha incorretos.'
    }
  } catch(err) { toast(`Erro: ${err.message}`,'error') }
})

document.getElementById('admin-senha').addEventListener('keydown', e=>{
  if(e.key==='Enter') document.getElementById('btn-admin-login').click()
})

/* Logout */
document.getElementById('btn-admin-logout').addEventListener('click', ()=>{
  confirmar('Deseja sair do painel de administrador?', ()=>{
    isAdmin = false
    renderAdminState()
    navigateTo('produtos')
    toast('Sessão de administrador encerrada.')
  })
})

/* Tabs admin */
document.querySelectorAll('[data-admin-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.remove('active'))
    document.querySelectorAll('#admin-painel .tab-pane').forEach(p=>p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById(`admin-tab-${btn.dataset.adminTab}`).classList.add('active')
    if(btn.dataset.adminTab==='custos')  carregarAdminCustos()
    if(btn.dataset.adminTab==='estoque') carregarAdminEstoque()
  })
})

/* --- Aba: Preços de Custo --- */
async function carregarAdminCustos() {
  const prods = await api.listarProdutos()
  const tbody = document.getElementById('tbody-admin-custos')
  if (!prods.length) {
    tbody.innerHTML=`<tr><td colspan="5" class="empty-state" style="padding:32px 0;">Nenhum produto cadastrado</td></tr>`
    return
  }
  tbody.innerHTML = prods.map(p=>{
    const semCusto = p.preco_custo===0||p.preco_custo===null
    const m = semCusto ? '—' : margem(p.preco_custo, p.preco_venda)
    return `<tr class="${semCusto?'linha-sem-custo':''}">
      <td><strong>${escHtml(p.nome)}</strong> ${semCusto?'<span class="badge-sem-custo">sem custo</span>':''}</td>
      <td>${fmtMoeda(p.preco_venda)}</td>
      <td>${semCusto?'<span class="text-muted">—</span>':fmtMoeda(p.preco_custo)}</td>
      <td>${typeof m==='string'&&m!=='—'?`<span class="${parseFloat(m)>=0?'positive':'negative'}">${m}</span>`:m}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="abrirEditarCusto(${p.id},'${escHtml(p.nome).replace(/'/g,"\\'")}',${p.preco_custo})">
          ${semCusto?'✚ Definir':'✏️ Editar'}
        </button>
      </td>
    </tr>`
  }).join('')
}

function abrirEditarCusto(id, nome, custoAtual) {
  adminEditCustoId = id
  document.getElementById('editar-custo-nome').textContent = nome
  document.getElementById('editar-custo-valor').value = custoAtual||''
  openModal('modal-editar-custo')
  setTimeout(()=>document.getElementById('editar-custo-valor').focus(), 80)
}

document.getElementById('btn-salvar-custo').addEventListener('click', async ()=>{
  const v = parseFloat(document.getElementById('editar-custo-valor').value)
  if (isNaN(v)||v<0) { toast('Valor inválido.','error'); return }
  try {
    await api.adminAtualizarCusto(adminEditCustoId, v)
    closeModal('modal-editar-custo')
    toast('Preço de custo salvo!','success')
    await carregarAdminCustos()
    await carregarProdutos()
  } catch(err) { toast(`Erro: ${err.message}`,'error') }
})

document.getElementById('editar-custo-valor').addEventListener('keydown', e=>{
  if(e.key==='Enter') document.getElementById('btn-salvar-custo').click()
})

/* --- Aba: Estoque --- */
async function carregarAdminEstoque() {
  const prods = await api.listarProdutos()
  const tbody = document.getElementById('tbody-admin-estoque')
  if (!prods.length) {
    tbody.innerHTML=`<tr><td colspan="4" class="empty-state" style="padding:32px 0;">Nenhum produto cadastrado</td></tr>`
    return
  }
  tbody.innerHTML = prods.map(p=>{
    const badge = p.estoque<=0
      ? `<span class="badge-estoque-baixo">${p.estoque}</span>`
      : p.estoque<=3
        ? `<span class="badge-estoque-aviso">${p.estoque}</span>`
        : `<span class="badge-estoque-ok">${p.estoque}</span>`
    return `<tr>
      <td><strong>${escHtml(p.nome)}</strong></td>
      <td><code>${p.codigo_barras}</code></td>
      <td>${badge}</td>
      <td>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="number" id="est-input-${p.id}" value="${p.estoque}" min="0"
            style="width:80px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:14px;">
          <button class="btn btn-sm btn-primary" onclick="salvarEstoque(${p.id})">Salvar</button>
        </div>
      </td>
    </tr>`
  }).join('')
}

async function salvarEstoque(id) {
  const input = document.getElementById(`est-input-${id}`)
  const v = parseInt(input.value)
  if (isNaN(v)||v<0) { toast('Quantidade inválida.','error'); return }
  try {
    await api.adminAtualizarEstoque(id, v)
    toast('Estoque atualizado!','success')
    await carregarProdutos()
    await carregarAdminEstoque()
  } catch(err) { toast(`Erro: ${err.message}`,'error') }
}

/* --- Aba: Lucro (admin) --- */
async function carregarAdminLucro() {
  const mes = parseInt(document.getElementById('admin-sel-mes-lucro').value)
  const ano = parseInt(document.getElementById('admin-sel-ano-lucro').value)
  const d = await api.lucroMensal(mes, ano)
  const {receita,custo,lucro} = d
  const pct = receita>0 ? ((lucro/receita)*100).toFixed(1) : '0'

  document.getElementById('admin-stats-lucro').innerHTML = `
    <div class="stat-card"><span class="stat-label">Mês</span><span class="stat-value" style="font-size:18px;">${MESES_PT[mes]} ${ano}</span></div>
    <div class="stat-card"><span class="stat-label">Receita total</span><span class="stat-value green">${fmtMoeda(receita)}</span></div>
    <div class="stat-card"><span class="stat-label">Custo total</span><span class="stat-value red">${fmtMoeda(custo)}</span></div>
    <div class="stat-card highlight"><span class="stat-label">Lucro líquido</span><span class="stat-value ${lucro>=0?'green':'red'}">${fmtMoeda(lucro)}</span></div>
    <div class="stat-card"><span class="stat-label">Margem</span><span class="stat-value ${parseFloat(pct)>=0?'purple':'red'}">${pct}%</span></div>`

  const chart = document.getElementById('admin-lucro-chart')
  if (receita>0) {
    chart.style.display='block'
    const cW=((custo/receita)*100).toFixed(1)
    const lW=((Math.max(lucro,0)/receita)*100).toFixed(1)
    document.getElementById('admin-lucro-bar').innerHTML=`
      <div class="lucro-bar-wrap">
        <div class="lucro-bar-custo" style="width:${cW}%"></div>
        <div class="lucro-bar-lucro" style="width:${lW}%"></div>
      </div>
      <div class="lucro-legend">
        <div class="legend-item"><div class="legend-dot" style="background:#ef4444;"></div><span>Custo: ${fmtMoeda(custo)} (${cW}%)</span></div>
        <div class="legend-item"><div class="legend-dot" style="background:#10b981;"></div><span>Lucro: ${fmtMoeda(lucro)} (${lW}%)</span></div>
      </div>`
  } else { chart.style.display='none' }
}

document.getElementById('admin-btn-buscar-lucro').addEventListener('click', carregarAdminLucro)

document.getElementById('admin-btn-export-lucro').addEventListener('click', async () => {
  const mes = parseInt(document.getElementById('admin-sel-mes-lucro').value)
  const ano = parseInt(document.getElementById('admin-sel-ano-lucro').value)
  const { receita, custo, lucro } = await api.lucroMensal(mes, ano)
  const pct   = receita > 0 ? ((lucro / receita) * 100).toFixed(1) : '0'
  const doc   = _novoPDF()

  let y = _pdfHeader(doc, 'Relatório de Lucratividade', `Período: ${MESES_PT[mes]} de ${ano}`, true)

  y = _pdfCards(doc, y, [
    { label: 'Receita total',  value: fmtMoeda(receita), color: 'green'  },
    { label: 'Custo total',    value: fmtMoeda(custo),   color: 'red'    },
    { label: 'Lucro líquido',  value: fmtMoeda(lucro),   color: lucro >= 0 ? 'purple' : 'red' },
    { label: 'Margem de lucro',value: `${pct}%`,          color: parseFloat(pct) >= 0 ? 'orange' : 'red' },
  ])

  // Seção: Análise detalhada
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.4)
  doc.roundedRect(14, y, 182, 54, 3, 3, 'FD')

  doc.setTextColor(30, 41, 59)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Análise Detalhada', 20, y + 9)

  const linhas = [
    ['Receita bruta (total de vendas):', fmtMoeda(receita)],
    ['(-) Custo dos produtos vendidos:', fmtMoeda(custo)],
    ['(=) Lucro operacional bruto:',     fmtMoeda(lucro)],
    ['Margem de lucro sobre a receita:', `${pct}%`],
  ]

  doc.setFontSize(9)
  linhas.forEach(([label, valor], i) => {
    const ly = y + 18 + i * 9
    const isTotalRow = i === 2
    if (isTotalRow) {
      doc.setDrawColor(209, 213, 219)
      doc.setLineWidth(0.3)
      doc.line(20, ly - 3, 196, ly - 3)
    }
    doc.setFont('helvetica', isTotalRow ? 'bold' : 'normal')
    doc.setTextColor(isTotalRow ? 30 : 71, isTotalRow ? 41 : 85, isTotalRow ? 59 : 105)
    doc.text(label, 20, ly)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(isTotalRow ? (lucro >= 0 ? 5 : 185) : 30, isTotalRow ? (lucro >= 0 ? 150 : 28) : 41, isTotalRow ? (lucro >= 0 ? 105 : 28) : 59)
    doc.text(valor, 194, ly, { align: 'right' })
  })

  y += 62

  // Barra visual proporcional (se há receita)
  if (receita > 0) {
    const barW = 182
    const barH = 10
    const costoW = Math.min((custo / receita) * barW, barW)
    const lucroW = Math.min((Math.max(lucro, 0) / receita) * barW, barW)

    doc.setTextColor(71, 85, 105)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.text('Composição da Receita', 14, y + 5)
    y += 9

    // Fundo da barra (receita)
    doc.setFillColor(226, 232, 240)
    doc.roundedRect(14, y, barW, barH, 2, 2, 'F')

    // Custo (vermelho)
    if (costoW > 0) {
      doc.setFillColor(239, 68, 68)
      doc.roundedRect(14, y, costoW, barH, 2, 2, 'F')
    }

    // Lucro (verde) — sobrepõe após custo
    if (lucroW > 0) {
      doc.setFillColor(16, 185, 129)
      doc.roundedRect(14 + costoW, y, lucroW, barH, 2, 2, 'F')
    }

    y += barH + 5

    // Legenda
    doc.setFillColor(239, 68, 68); doc.rect(14, y, 8, 4, 'F')
    doc.setTextColor(71, 85, 105); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(`Custo (${((custo/receita)*100).toFixed(1)}%)`, 24, y + 3.5)

    doc.setFillColor(16, 185, 129); doc.rect(80, y, 8, 4, 'F')
    doc.text(`Lucro (${pct}%)`, 90, y + 3.5)
  }

  _pdfFooter(doc, true)
  doc.save(`lucro-${MESES_PT[mes].toLowerCase()}-${ano}-admin.pdf`)
  toast('PDF de lucro exportado!', 'success')
})

/* ============================================================
   ESTORNO DE VENDA
   ============================================================ */
async function estornarVenda(id) {
  const { venda, itens } = await api.detalhesVenda(id)
  const linhaItens = itens.map(i =>
    `• ${i.nome_produto} × ${i.quantidade} — ${fmtMoeda(i.preco_unitario * i.quantidade)}`
  ).join('\n')

  confirmar(
    `Estornar a venda #${id} (${fmtMoeda(venda.total)})?\n\nIsso removerá o registro e devolverá os itens ao estoque.\n\n${linhaItens}`,
    async () => {
      try {
        await api.cancelarVenda(id)
        toast(`Venda #${id} estornada. Estoque restaurado.`, 'success')
        await carregarProdutos()
        // Recarrega a aba ativa de relatórios
        const tabHoje   = document.getElementById('tab-hoje')
        const tabMensal = document.getElementById('tab-mensal')
        if (tabHoje.classList.contains('active'))   carregarHoje()
        if (tabMensal.classList.contains('active')) carregarMensal()
      } catch(err) {
        toast(`Erro ao estornar: ${err.message}`, 'error')
      }
    }
  )
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function init() {
  iniciarRelogio()
  initDateSelectors()
  try { await carregarProdutos() } catch(err) { toast(`Erro ao iniciar: ${err.message}`,'error') }

  document.getElementById('data-hoje').textContent =
    new Date().toLocaleDateString('pt-BR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})
}

init()
