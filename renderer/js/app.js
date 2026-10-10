'use strict'

const api = window.electronAPI

/* ============================================================
   ESTADO
   ============================================================ */
let todosProdutos    = []
let carrinho         = []
let ultimoIdx        = -1
let descontoCfg      = null   // { tipo: 'valor' | 'percentual', valor }
let finalizando      = false
let produtoEditId    = null
let confirmCallback  = null
let isAdmin          = false
let adminEditCustoId = null
let ultimaVendaId    = null
let detalheVendaId   = null
let filtroEstoque    = 'todos'
let buscaSelIdx      = 0
let buscaLista       = []

const ESTOQUE_BAIXO     = 3
const ADMIN_TIMEOUT_MS  = 10 * 60 * 1000

/* ============================================================
   UTILS
   ============================================================ */
function fmt(v)       { return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) }
function fmtMoeda(v)  { return `R$ ${fmt(v)}` }
function fmtHora(s)   { if(!s)return'—'; const d=new Date(s.replace(' ','T')); return isNaN(d)?s:d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) }
function fmtDH(s)     { if(!s)return'—'; const d=new Date(s.replace(' ','T')); return isNaN(d)?s:`${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` }
function fmtNumVenda(n) { return String(n).padStart(6,'0') }
function fmtPct(v)    { return `${Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%` }
function margem(c,v)  { if(!c||c===0)return'—'; return fmtPct(((v-c)/c)*100) }
function maiuscula(s) { return s.charAt(0).toUpperCase() + s.slice(1) }
function escHtml(s)   { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }
function round2(v)    { return Math.round((Number(v)||0)*100)/100 }
function icon(nome)   { return `<svg class="ico"><use href="#i-${nome}"/></svg>` }
const $ = id => document.getElementById(id)

// Remove o prefixo técnico que o Electron adiciona aos erros vindos do processo principal
function msgErro(err) {
  return String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

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
    return true
  } catch(e) { console.warn('Barcode:', e); return false }
}

const PAGAMENTO_LABEL = { pix:'PIX', debito:'Débito', credito:'Crédito', dinheiro:'Dinheiro', fiado:'Fiado', vale:'Vale-troca', multiplo:'Mais de uma forma' }
const PAGAMENTO_ICON  = { pix:'pix', debito:'card', credito:'card', dinheiro:'cash', fiado:'user', vale:'ticket', multiplo:'wallet' }

// Versão sem acento para uso no comprovante térmico
const PAGAMENTO_PDF = { pix:'PIX', debito:'Debito', credito:'Credito', dinheiro:'Dinheiro', fiado:'Fiado', vale:'Vale-troca', multiplo:'Varias formas' }

/* Queima de estoque: preço especial para um número limitado de peças */
function hojeISO() { return new Date().toLocaleDateString('sv-SE') }
function agoraTexto() { const d = new Date(); return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` }
function promoAtiva(p) {
  return !!(p && p.preco_promo > 0 && p.promo_qtd > 0 && (!p.promo_ate || p.promo_ate >= hojeISO()))
}
function badgeQueima(p) {
  return promoAtiva(p) ? `<span class="badge-queima" title="Queima de estoque">Queima ${fmtMoeda(p.preco_promo)} · ${p.promo_qtd} pç</span>` : ''
}

function badgePagamento(p) {
  return `<span class="badge-pagamento">${icon(PAGAMENTO_ICON[p]||'wallet')}${PAGAMENTO_LABEL[p]||escHtml(p)}</span>`
}

function badgeEstoque(qtd) {
  if (qtd <= 0)             return `<span class="badge-estoque-baixo">${qtd}</span>`
  if (qtd <= ESTOQUE_BAIXO) return `<span class="badge-estoque-aviso">${qtd}</span>`
  return `<span class="badge-estoque-ok">${qtd}</span>`
}

function linhaVazia(colspan, iconNome, titulo, dica='') {
  return `<tr><td colspan="${colspan}" class="empty-state">
    <div class="empty-icon">${icon(iconNome)}</div>
    <div class="empty-title">${titulo}</div>
    ${dica?`<div class="empty-hint">${dica}</div>`:''}
  </td></tr>`
}

const MESES_PT = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

/* Bipe curto (sucesso) ou grave (erro), como nos leitores de caixa */
let audioCtx = null
function bipe(tipo='ok') {
  try {
    audioCtx = audioCtx || new AudioContext()
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain()
    osc.type = tipo==='erro' ? 'square' : 'sine'
    osc.frequency.value = tipo==='erro' ? 220 : 1400
    gain.gain.value = 0.06
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.start(); osc.stop(audioCtx.currentTime + (tipo==='erro' ? 0.28 : 0.07))
  } catch(e) { /* sem áudio disponível */ }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null
function toast(msg, type='') {
  const el = $('toast')
  el.textContent = msg
  el.className = `toast${type?' toast-'+type:''}`
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(()=>el.classList.remove('show'), 3400)
}

/* ============================================================
   MODAL
   ============================================================ */
// Abre o modal e já move o foco para dentro dele, para que nada digitado caia na tela de trás
function openModal(id, focoId=null) {
  const overlay = $(id)
  overlay.classList.add('open')
  const ativo = document.activeElement
  if (ativo && !overlay.contains(ativo)) ativo.blur()
  if (focoId) { $(focoId).focus(); if ($(focoId).select) $(focoId).select() }
}
function closeModal(id) {
  $(id).classList.remove('open')
  if (!modalAberto() && secaoAtiva()==='caixa') focarScanner()
}
function modalAberto()  {
  const abertos = document.querySelectorAll('.modal-overlay.open')
  return abertos.length ? abertos[abertos.length-1].id : null
}

document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
)
document.querySelectorAll('.modal-overlay').forEach(overlay =>
  overlay.addEventListener('mousedown', e => { if(e.target===overlay) closeModal(overlay.id) })
)

/* ============================================================
   CONFIRMAR
   ============================================================ */
function confirmar(msg, cb, { titulo='Confirmar', botao='Confirmar' } = {}) {
  $('confirmar-titulo').textContent  = titulo
  $('confirmar-msg').textContent     = msg
  $('btn-confirmar-sim').textContent = botao
  confirmCallback = cb
  openModal('modal-confirmar', 'btn-confirmar-sim')
}
$('btn-confirmar-nao').addEventListener('click', ()=>closeModal('modal-confirmar'))
$('btn-confirmar-sim').addEventListener('click', ()=>{
  closeModal('modal-confirmar')
  if(confirmCallback) confirmCallback()
})

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
document.querySelectorAll('.nav-item').forEach(item =>
  item.addEventListener('click', ()=>navigateTo(item.dataset.section))
)

function secaoAtiva() {
  const s = document.querySelector('.section.active')
  return s ? s.id.replace('section-','') : null
}

function navigateTo(section) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.querySelector(`.nav-item[data-section="${section}"]`).classList.add('active')
  $(`section-${section}`).classList.add('active')

  if (section === 'produtos')   renderProdutos()
  if (section === 'etiquetas')  { preencherSelectEtiquetas(); renderEtiquetasPreview() }
  if (section === 'caixa')      { atualizarNumeroVenda(); focarScanner() }
  if (section === 'relatorios') carregarHoje()
  if (section === 'admin')      renderAdminState()
  if (section === 'clientes')   carregarClientes()
  if (section === 'trocas')     abrirTrocas()
  if (section === 'mercadorias')abrirMercadorias()
}

/* ============================================================
   RELÓGIO
   ============================================================ */
function iniciarRelogio() {
  const tick = () => {
    const d = new Date()
    $('clock').textContent      = d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    $('clock-date').textContent = maiuscula(d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'}))
  }
  tick(); setInterval(tick, 1000)
}

/* ============================================================
   PRODUTOS
   ============================================================ */
async function carregarProdutos() {
  todosProdutos = await api.listarProdutos()
  if (secaoAtiva()==='produtos') renderProdutos()
}

function produtosFiltrados() {
  const q = $('input-busca-produto').value.trim().toLowerCase()
  return todosProdutos.filter(p => {
    if (q && !p.nome.toLowerCase().includes(q) && !p.codigo_barras.includes(q)) return false
    if (filtroEstoque==='baixo')  return p.estoque > 0 && p.estoque <= ESTOQUE_BAIXO
    if (filtroEstoque==='zerado') return p.estoque <= 0
    if (filtroEstoque==='queima') return promoAtiva(p)
    return true
  })
}

function renderProdutos() {
  const zerados = todosProdutos.filter(p=>p.estoque<=0).length
  const baixos  = todosProdutos.filter(p=>p.estoque>0 && p.estoque<=ESTOQUE_BAIXO).length
  const pecas   = todosProdutos.reduce((s,p)=>s+Math.max(p.estoque,0),0)
  const valor   = todosProdutos.reduce((s,p)=>s+Math.max(p.estoque,0)*p.preco_venda,0)

  $('stats-produtos').innerHTML = `
    <div class="stat-card c-purple"><span class="stat-label">Produtos</span><span class="stat-value">${todosProdutos.length}</span></div>
    <div class="stat-card c-green"><span class="stat-label">Peças em estoque</span><span class="stat-value">${pecas}</span><span class="stat-sub">${fmtMoeda(valor)} em preço de venda</span></div>
    <div class="stat-card c-orange"><span class="stat-label">Estoque baixo</span><span class="stat-value">${baixos}</span><span class="stat-sub">até ${ESTOQUE_BAIXO} peças</span></div>
    <div class="stat-card c-red"><span class="stat-label">Sem estoque</span><span class="stat-value">${zerados}</span></div>`

  const lista = produtosFiltrados()
  $('contador-produtos').textContent = `${lista.length} produto${lista.length!==1?'s':''}`

  const tbody = $('tbody-produtos')
  if (!lista.length) {
    tbody.innerHTML = todosProdutos.length
      ? linhaVazia(5, 'search', 'Nenhum produto encontrado', 'Tente outro nome ou filtro')
      : linhaVazia(5, 'box', 'Nenhum produto cadastrado', 'Clique em "Novo produto" para começar')
    return
  }

  tbody.innerHTML = lista.map(p => `
    <tr>
      <td><code>${escHtml(p.codigo_barras)}</code></td>
      <td><strong>${escHtml(p.nome)}</strong> ${badgeQueima(p)}</td>
      <td class="num">${fmtMoeda(p.preco_venda)}</td>
      <td class="ctr">${badgeEstoque(p.estoque)}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-secondary" data-acao="editar" data-id="${p.id}">${icon('edit')} Editar</button>
          <button class="btn btn-sm btn-danger-outline btn-icon" data-acao="excluir" data-id="${p.id}" title="Excluir">${icon('trash')}</button>
        </div>
      </td>
    </tr>`).join('')
}

$('tbody-produtos').addEventListener('click', e => {
  const btn = e.target.closest('[data-acao]'); if (!btn) return
  const id = Number(btn.dataset.id)
  if (btn.dataset.acao==='editar')  abrirEditarProduto(id)
  if (btn.dataset.acao==='excluir') deletarProduto(id)
})

$('input-busca-produto').addEventListener('input', renderProdutos)

document.querySelectorAll('#filtro-estoque .chip').forEach(chip =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('#filtro-estoque .chip').forEach(c=>c.classList.remove('active'))
    chip.classList.add('active')
    filtroEstoque = chip.dataset.filtro
    renderProdutos()
  })
)

function atualizarPreviewCodigo() {
  const codigo = $('produto-codigo').value.trim()
  const ok = codigo && renderBarcode('#barcode-preview', codigo, {height:50,fontSize:11})
  if (!ok) $('barcode-preview').innerHTML = ''
  $('barcode-caption-texto').textContent = !codigo
    ? 'Informe ou gere um código'
    : ok ? (produtoEditId ? 'O código não pode ser alterado depois do cadastro' : 'Pronto para imprimir na etiqueta')
         : 'Código inválido'
}

/* Queima de estoque no formulário do produto */
function preencherPromo(p) {
  const ativa = promoAtiva(p)
  $('promo-ativa').checked = ativa
  $('promo-preco').value   = ativa ? p.preco_promo : ''
  $('promo-qtd').value     = ativa ? p.promo_qtd : ''
  $('promo-ate').value     = ativa && p.promo_ate ? p.promo_ate : ''
  atualizarPromoForm()
}

function atualizarPromoForm() {
  const ativa = $('promo-ativa').checked
  $('promo-campos').style.display = ativa ? '' : 'none'
  const preco = parseFloat($('promo-preco').value), normal = parseFloat($('produto-venda').value)
  const qtd = parseInt($('promo-qtd').value)
  $('promo-resumo').textContent = !ativa ? 'Use para vender algumas peças mais baratas; depois o preço volta ao normal sozinho.'
    : preco > 0 && qtd > 0
      ? `As próximas ${qtd} peça(s) saem por ${fmtMoeda(preco)}${normal>0?` em vez de ${fmtMoeda(normal)}`:''}. Depois volta ao preço normal.`
      : 'Informe o preço e quantas peças entram na queima.'
}
;['promo-ativa','promo-preco','promo-qtd','produto-venda'].forEach(id => $(id).addEventListener('input', atualizarPromoForm))

function lerPromoForm() {
  if (!$('promo-ativa').checked) return null
  return { preco: parseFloat($('promo-preco').value), quantidade: parseInt($('promo-qtd').value), ate: $('promo-ate').value || null }
}

// Chamado quando outra tela pede um produto novo (ex.: entrada de mercadoria)
let aoCriarProduto = null
function novoProduto(codigo='', callback=null) {
  $('btn-novo-produto').click()
  if (codigo) { $('produto-codigo').value = codigo; atualizarPreviewCodigo() }
  aoCriarProduto = callback
}

/* Novo produto */
$('btn-novo-produto').addEventListener('click', () => {
  aoCriarProduto = null
  produtoEditId = null
  $('modal-produto-titulo').textContent = 'Novo produto'
  $('form-produto').reset()
  $('produto-codigo').value    = gerarCodigoBarras()
  $('produto-codigo').readOnly = false
  $('btn-gerar-codigo').style.display = ''
  $('grupo-estoque').style.display    = ''
  $('label-estoque').textContent      = 'Estoque inicial'
  atualizarPreviewCodigo()
  preencherPromo(null)
  openModal('modal-produto', 'produto-nome')
})

$('btn-gerar-codigo').addEventListener('click', () => {
  $('produto-codigo').value = gerarCodigoBarras()
  atualizarPreviewCodigo()
})

$('produto-codigo').addEventListener('input', atualizarPreviewCodigo)

// Leitor de código no campo do produto: Enter não deve salvar o formulário
$('produto-codigo').addEventListener('keydown', e => {
  if (e.key==='Enter') { e.preventDefault(); $('produto-estoque').focus() }
})

function abrirEditarProduto(id) {
  const p = todosProdutos.find(x=>x.id===id); if(!p) return
  produtoEditId = id
  $('modal-produto-titulo').textContent = 'Editar produto'
  $('produto-nome').value    = p.nome
  $('produto-venda').value   = p.preco_venda
  $('produto-estoque').value = p.estoque
  $('produto-codigo').value  = p.codigo_barras
  $('produto-codigo').readOnly = true
  $('btn-gerar-codigo').style.display = 'none'
  // Ajuste de estoque é exclusivo do administrador
  $('grupo-estoque').style.display = isAdmin ? '' : 'none'
  $('label-estoque').textContent   = 'Estoque'
  atualizarPreviewCodigo()
  preencherPromo(p)
  openModal('modal-produto', 'produto-nome')
}

$('form-produto').addEventListener('submit', async e => {
  e.preventDefault()
  const nome        = $('produto-nome').value.trim()
  const preco_venda = parseFloat($('produto-venda').value)
  const estoque     = parseInt($('produto-estoque').value) || 0
  const codigo      = $('produto-codigo').value.trim()

  if (!nome)                              { toast('Informe o nome do produto.','error'); return }
  if (isNaN(preco_venda)||preco_venda<=0) { toast('Preço de venda inválido.','error'); return }
  if (estoque < 0)                        { toast('Estoque não pode ser negativo.','error'); return }
  if (!produtoEditId && !codigo)          { toast('Informe o código de barras.','error'); return }
  const promo = lerPromoForm()
  if (promo && !(promo.preco > 0 && promo.preco < preco_venda)) { toast('O preço da queima deve ser menor que o preço normal.','error'); return }
  if (promo && !(promo.quantidade > 0))   { toast('Informe quantas peças entram na queima.','error'); return }

  try {
    let produto
    if (produtoEditId) {
      const antes = todosProdutos.find(x=>x.id===produtoEditId)
      produto = await api.atualizarProduto(produtoEditId, { nome, preco_venda })
      if (isAdmin) await api.adminAtualizarEstoque(produtoEditId, estoque)
      if (promo || promoAtiva(antes)) await api.definirPromocao(produtoEditId, promo)
      toast('Produto atualizado!', 'success')
    } else {
      produto = await api.criarProduto({ nome, preco_venda, codigo_barras: codigo, estoque })
      if (promo) produto = await api.definirPromocao(produto.id, promo)
      toast('Produto cadastrado!', 'success')
    }
    closeModal('modal-produto')
    await carregarProdutos()
    preencherSelectEtiquetas()
    if (aoCriarProduto && !produtoEditId) { const cb = aoCriarProduto; aoCriarProduto = null; cb(produto) }
  } catch(err) { toast(msgErro(err), 'error') }
})

function deletarProduto(id) {
  const p = todosProdutos.find(x=>x.id===id); if(!p) return
  confirmar(`Excluir o produto "${p.nome}"?\nEsta ação não pode ser desfeita. As vendas já feitas continuam nos relatórios.`, async () => {
    try {
      await api.deletarProduto(id)
      toast('Produto excluído.', 'success')
      await carregarProdutos()
    } catch(err) { toast(msgErro(err), 'error') }
  }, { titulo:'Excluir produto', botao:'Excluir' })
}

/* ============================================================
   ETIQUETAS
   ============================================================ */
let etiquetasSel = []

function preencherSelectEtiquetas() {
  const sel = $('select-produto-etiqueta')
  const val = sel.value
  sel.innerHTML = '<option value="">— Selecione —</option>' +
    todosProdutos.map(p=>`<option value="${p.id}">${escHtml(p.nome)} — ${fmtMoeda(p.preco_venda)}</option>`).join('')
  if (val) sel.value = val
}

function adicionarEtiqueta(prod, qtd) {
  const existe = etiquetasSel.find(e=>e.produto.id===prod.id)
  existe ? (existe.quantidade += qtd) : etiquetasSel.push({produto:prod, quantidade:qtd})
  renderEtiquetasLista()
  renderEtiquetasPreview()
}

function produtoSelecionadoEtiqueta() {
  const prodId = parseInt($('select-produto-etiqueta').value)
  if (!prodId) { toast('Selecione um produto.','warn'); return null }
  const prod = todosProdutos.find(p=>p.id===prodId)
  if (!prod) toast('Produto não encontrado.','error')
  return prod || null
}

$('btn-add-etiqueta').addEventListener('click', () => {
  const prod = produtoSelecionadoEtiqueta(); if (!prod) return
  adicionarEtiqueta(prod, Math.max(1, parseInt($('input-qtd-etiqueta').value) || 1))
})

$('btn-etiquetas-estoque').addEventListener('click', () => {
  const prod = produtoSelecionadoEtiqueta(); if (!prod) return
  if (prod.estoque <= 0) { toast('Este produto está sem estoque.','warn'); return }
  adicionarEtiqueta(prod, prod.estoque)
})

$('btn-limpar-etiquetas').addEventListener('click', ()=>{
  etiquetasSel=[]; renderEtiquetasLista(); renderEtiquetasPreview()
})

function renderEtiquetasLista() {
  const container = $('etiquetas-lista-container')
  if (!etiquetasSel.length) { container.style.display='none'; return }
  container.style.display = 'block'
  $('tbody-etiquetas-lista').innerHTML = etiquetasSel.map((e,i)=>`
    <tr>
      <td>${escHtml(e.produto.nome)}</td>
      <td>${e.quantidade}</td>
      <td style="text-align:right;"><button class="btn btn-sm btn-danger-outline" data-remover="${i}">${icon('trash')} Remover</button></td>
    </tr>`).join('')
}

$('tbody-etiquetas-lista').addEventListener('click', e => {
  const btn = e.target.closest('[data-remover]'); if (!btn) return
  etiquetasSel.splice(Number(btn.dataset.remover),1)
  renderEtiquetasLista(); renderEtiquetasPreview()
})

function renderEtiquetasPreview() {
  const preview   = $('etiquetas-preview')
  const printArea = $('print-area')
  const infoEl    = $('total-etiquetas-info')

  if (!etiquetasSel.length) {
    preview.innerHTML = `<div class="empty-state" style="padding:40px 0;width:100%;">
      <div class="empty-icon">${icon('tag')}</div>
      <div class="empty-title">Adicione produtos para visualizar</div></div>`
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
        <div class="etiqueta-loja">Cantinho do Bebê</div>
        <div class="etiqueta-nome">${escHtml(produto.nome)}</div>
        <svg class="etiqueta-barcode" data-codigo="${escHtml(produto.codigo_barras)}"></svg>
        ${promoAtiva(produto)
          ? `<div class="etiqueta-de">De ${fmtMoeda(produto.preco_venda)}</div><div class="etiqueta-preco">Por ${fmtMoeda(produto.preco_promo)}</div>`
          : `<div class="etiqueta-preco">${fmtMoeda(produto.preco_venda)}</div>`}
      </div>`
    }
  })

  preview.innerHTML = html
  printArea.innerHTML = html
  document.querySelectorAll('.etiqueta-barcode').forEach(svg =>
    renderBarcode(svg, svg.dataset.codigo, {width:1.4,height:36,fontSize:9,margin:4})
  )
}

$('btn-imprimir-etiquetas').addEventListener('click', ()=>{
  if (!etiquetasSel.length) { toast('Selecione ao menos um produto.','warn'); return }
  window.print()
})

/* ============================================================
   CAIXA
   ============================================================ */
function focarScanner() {
  setTimeout(()=>{
    if (modalAberto()) return
    if (!caixaAberto()) $('abertura-valor').focus()
    else $('input-barcode').focus()
  }, 30)
}

async function atualizarNumeroVenda() {
  try { $('num-venda-atual').textContent = fmtNumVenda(await api.proximoNumeroVenda()) }
  catch(e) { $('num-venda-atual').textContent = '—' }
}

/* Peças em queima saem pelo preço especial até acabar a quantidade da queima */
function qtdNaQueima(item) { return item.promo ? Math.min(item.quantidade, item.promo.disponivel) : 0 }
function subtotalItem(item) {
  const q = qtdNaQueima(item)
  return round2(q * (item.promo ? item.promo.preco : 0) + (item.quantidade - q) * item.preco_unitario)
}
function subtotalCarrinho() { return round2(carrinho.reduce((s,i)=>s+subtotalItem(i),0)) }

/* Itens enviados para o banco: a parte em queima vira uma linha separada */
function itensParaVenda() {
  const lista = []
  for (const item of carrinho) {
    const q = qtdNaQueima(item)
    const base = { produto_id:item.produto_id, nome:item.nome, preco_custo:item.preco_custo }
    if (q > 0) lista.push({ ...base, quantidade:q, preco_unitario:item.promo.preco, promo:true })
    if (item.quantidade - q > 0) lista.push({ ...base, quantidade:item.quantidade - q, preco_unitario:item.preco_unitario })
  }
  return lista
}

function calcDesconto(subtotal) {
  if (!descontoCfg || !descontoCfg.valor) return 0
  const v = descontoCfg.tipo==='percentual' ? subtotal*descontoCfg.valor/100 : descontoCfg.valor
  return Math.min(round2(v), subtotal)
}

function totalCarrinho() { const s = subtotalCarrinho(); return round2(s - calcDesconto(s)) }

$('input-barcode').addEventListener('keydown', e=>{
  if(e.key==='Enter'){ e.preventDefault(); adicionarItem() }
})

/* Aceita "3*7891234" ou "3x7891234" para lançar várias unidades */
function lerEntradaScanner(texto) {
  const m = texto.match(/^(\d{1,3})\s*[*xX]\s*(.+)$/)
  return m ? { qtd: Math.max(1, parseInt(m[1])), codigo: m[2].trim() } : { qtd: 1, codigo: texto }
}

async function adicionarItem() {
  const input = $('input-barcode')
  const texto = input.value.trim()
  if (!texto) return
  if (!caixaAberto()) { toast('Abra o caixa antes de vender.','warn'); return }
  const { qtd, codigo } = lerEntradaScanner(texto)
  // Limpa na hora: o leitor pode mandar o próximo código antes da busca terminar
  input.value = ''
  try {
    const prod = todosProdutos.find(p=>p.codigo_barras===codigo) || await api.buscarPorCodigo(codigo)
    if (!prod) {
      bipe('erro')
      input.classList.add('error')
      toast(`Produto não encontrado: ${codigo}`,'error')
      setTimeout(()=>input.classList.remove('error'),600)
      if (!input.value) { input.value = texto; input.select() }
      return
    }
    adicionarAoCarrinho(prod, qtd)
  } catch(err) { toast(msgErro(err),'error') }
}

function adicionarAoCarrinho(prod, qtd=1) {
  let idx = carrinho.findIndex(i=>i.produto_id===prod.id)
  if (idx >= 0) {
    carrinho[idx].quantidade += qtd
    carrinho[idx].estoque = prod.estoque
  } else {
    carrinho.push({produto_id:prod.id, nome:prod.nome, codigo:prod.codigo_barras, quantidade:qtd,
                   preco_unitario:prod.preco_venda, preco_custo:prod.preco_custo, estoque:prod.estoque,
                   promo: promoAtiva(prod) ? { preco:prod.preco_promo, disponivel:prod.promo_qtd } : null})
    idx = carrinho.length - 1
  }
  ultimoIdx = idx
  bipe('ok')
  const item = carrinho[idx]
  if (item.quantidade > item.estoque) {
    toast(item.estoque > 0
      ? `Atenção: só há ${item.estoque} em estoque de "${item.nome}".`
      : `Atenção: "${item.nome}" está sem estoque no sistema.`, 'warn')
  }
  renderCarrinho()
}

function renderCarrinho() {
  const tbody    = $('tbody-carrinho')
  const subtotal = subtotalCarrinho()
  const desconto = calcDesconto(subtotal)
  const total    = round2(subtotal - desconto)
  const numItens = carrinho.reduce((s,i)=>s+i.quantidade,0)
  const vazio    = !carrinho.length

  if (vazio) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6" class="empty-state" style="padding:70px 0 !important;">
      <div class="empty-icon">${icon('barcode')}</div>
      <div class="empty-title">Caixa livre</div>
      <div class="empty-hint">Leia o código de barras de um produto para começar a venda</div>
    </td></tr>`
  } else {
    tbody.innerHTML = carrinho.map((item,idx)=>{
      const sub = subtotalItem(item)
      const q = qtdNaQueima(item)
      const semEstoque = item.quantidade > item.estoque
      return `<tr class="${idx===ultimoIdx?'ultimo':''}">
        <td class="item-num">${String(idx+1).padStart(3,'0')}</td>
        <td>
          <div class="item-nome">${escHtml(item.nome)}${semEstoque?`<span class="item-alerta" title="Quantidade maior que o estoque cadastrado">${icon('alert')} estoque: ${item.estoque}</span>`:''}</div>
          <div class="item-cod">${escHtml(item.codigo||'')}
            ${q?`<span class="badge-queima">Queima: ${q} × ${fmtMoeda(item.promo.preco)}${item.quantidade>q?` · ${item.quantidade-q} no preço normal`:''}</span>`:''}</div>
        </td>
        <td>
          <div class="qty-control">
            <button class="btn-xs" data-qtd="${idx}" data-delta="-1" title="Diminuir">${icon('minus')}</button>
            <span class="qty-num">${item.quantidade}</span>
            <button class="btn-xs" data-qtd="${idx}" data-delta="1" title="Aumentar">${icon('plus')}</button>
          </div>
        </td>
        <td class="num">${q?`<span class="preco-de">${fmtMoeda(item.preco_unitario)}</span>${fmtMoeda(item.promo.preco)}`:fmtMoeda(item.preco_unitario)}</td>
        <td class="num"><strong>${fmtMoeda(sub)}</strong></td>
        <td><button class="btn-xs danger" data-remover="${idx}" title="Remover item">${icon('x')}</button></td>
      </tr>`
    }).join('')
    const linha = tbody.querySelector('tr.ultimo')
    if (linha) linha.scrollIntoView({block:'nearest'})
  }

  // Painel lateral
  const ultimo = carrinho[ultimoIdx]
  $('ultimo-nome').textContent  = ultimo ? ultimo.nome : '—'
  const qQueima = ultimo ? qtdNaQueima(ultimo) : 0
  $('ultimo-qtd').textContent   = !ultimo ? ''
    : qQueima && qQueima < ultimo.quantidade ? `${ultimo.quantidade} un. (${qQueima} na queima)`
    : `${ultimo.quantidade} × ${fmtMoeda(qQueima ? ultimo.promo.preco : ultimo.preco_unitario)}`
  $('ultimo-preco').textContent = ultimo ? fmtMoeda(subtotalItem(ultimo)) : ''

  $('resumo-itens').textContent    = numItens
  $('resumo-subtotal').textContent = fmtMoeda(subtotal)
  $('resumo-desconto').textContent = desconto
    ? `− ${fmtMoeda(desconto)}${descontoCfg.tipo==='percentual'?` (${descontoCfg.valor}%)`:''}`
    : 'R$ 0,00'
  document.querySelector('.resumo-desconto').classList.toggle('ativo', desconto>0)
  $('total-venda').textContent     = fmtMoeda(total)
  $('carrinho-count').textContent  = `${numItens} ${numItens!==1?'itens':'item'}`

  $('pdv-status').classList.toggle('ocupado', !vazio)
  $('pdv-status').classList.toggle('fechado', !caixaAberto())
  $('pdv-status-text').textContent = !caixaAberto() ? 'CAIXA FECHADO' : vazio ? 'CAIXA LIVRE' : 'VENDA EM ANDAMENTO'

  ;['btn-finalizar-venda','btn-desconto','btn-remover-ultimo','btn-cancelar-venda']
    .forEach(id => $(id).disabled = vazio)
}

$('tbody-carrinho').addEventListener('click', e => {
  const qtdBtn = e.target.closest('[data-qtd]')
  const remBtn = e.target.closest('[data-remover]')
  if (qtdBtn) alterarQtd(Number(qtdBtn.dataset.qtd), Number(qtdBtn.dataset.delta))
  if (remBtn) removerDoCarrinho(Number(remBtn.dataset.remover))
  focarScanner()
})

function alterarQtd(idx, delta) {
  const item = carrinho[idx]; if (!item) return
  item.quantidade += delta
  ultimoIdx = idx
  if (item.quantidade<=0) { removerDoCarrinho(idx); return }
  if (delta>0 && item.quantidade>item.estoque) toast(`Atenção: só há ${Math.max(item.estoque,0)} em estoque.`, 'warn')
  renderCarrinho()
}

function removerDoCarrinho(idx) {
  carrinho.splice(idx,1)
  ultimoIdx = carrinho.length - 1
  if (!carrinho.length) descontoCfg = null
  renderCarrinho()
}

function removerUltimoItem() {
  if (!carrinho.length) return
  const idx  = ultimoIdx>=0 && ultimoIdx<carrinho.length ? ultimoIdx : carrinho.length-1
  const item = carrinho[idx]
  if (item.quantidade > 1) { item.quantidade--; renderCarrinho() }
  else removerDoCarrinho(idx)
  toast(`Retirado: ${item.nome}`)
}

$('btn-remover-ultimo').addEventListener('click', ()=>{ removerUltimoItem(); focarScanner() })

function cancelarVendaAtual() {
  if (!carrinho.length) return
  confirmar('Cancelar a venda em andamento?\nTodos os itens lançados serão removidos.', ()=>{
    carrinho = []; ultimoIdx = -1; descontoCfg = null
    renderCarrinho(); toast('Venda cancelada.')
    focarScanner()
  }, { titulo:'Cancelar venda', botao:'Cancelar venda' })
}
$('btn-cancelar-venda').addEventListener('click', cancelarVendaAtual)

/* Busca por nome (F2) */
let aoEscolherBusca = null
function abrirBusca(callback=null) {
  aoEscolherBusca = callback
  $('input-busca-caixa').value = ''
  filtrarBusca()
  openModal('modal-buscar-nome', 'input-busca-caixa')
}
$('btn-buscar-produto-nome').addEventListener('click', ()=>abrirBusca())

function filtrarBusca() {
  const q = $('input-busca-caixa').value.trim().toLowerCase()
  buscaLista = todosProdutos.filter(p=>!q || p.nome.toLowerCase().includes(q) || p.codigo_barras.includes(q))
  buscaSelIdx = 0
  renderBuscaCaixa()
}
$('input-busca-caixa').addEventListener('input', filtrarBusca)

$('input-busca-caixa').addEventListener('keydown', e=>{
  if (e.key==='ArrowDown') { e.preventDefault(); buscaSelIdx = Math.min(buscaSelIdx+1, buscaLista.length-1); renderBuscaCaixa() }
  if (e.key==='ArrowUp')   { e.preventDefault(); buscaSelIdx = Math.max(buscaSelIdx-1, 0); renderBuscaCaixa() }
  if (e.key==='Enter' && buscaLista[buscaSelIdx]) { e.preventDefault(); adicionarDoModal(buscaLista[buscaSelIdx].id) }
})

function renderBuscaCaixa() {
  const tbody = $('tbody-busca-caixa')
  if (!buscaLista.length) {
    tbody.innerHTML = linhaVazia(5, 'search', 'Nenhum produto encontrado')
    return
  }
  tbody.innerHTML = buscaLista.map((p,i)=>`<tr class="${i===buscaSelIdx?'ultimo':''}" data-add="${p.id}" style="cursor:pointer;">
      <td><strong>${escHtml(p.nome)}</strong></td>
      <td><code>${escHtml(p.codigo_barras)}</code></td>
      <td class="num">${fmtMoeda(p.preco_venda)}</td>
      <td class="ctr">${badgeEstoque(p.estoque)}</td>
      <td style="text-align:right;"><button class="btn btn-sm btn-primary" data-add="${p.id}">${icon('plus')} Adicionar</button></td>
    </tr>`).join('')
  const sel = tbody.querySelector('tr.ultimo')
  if (sel) sel.scrollIntoView({block:'nearest'})
}

$('tbody-busca-caixa').addEventListener('click', e => {
  const el = e.target.closest('[data-add]'); if (el) adicionarDoModal(Number(el.dataset.add))
})

function adicionarDoModal(id) {
  const prod = todosProdutos.find(p=>p.id===id); if(!prod) return
  closeModal('modal-buscar-nome')
  if (aoEscolherBusca) { const cb = aoEscolherBusca; aoEscolherBusca = null; cb(prod); return }
  if (!caixaAberto()) { toast('Abra o caixa antes de vender.','warn'); return }
  adicionarAoCarrinho(prod)
  focarScanner()
}

/* Desconto (F4) */
function abrirDesconto() {
  if (!carrinho.length) return
  setTipoDesconto(descontoCfg ? descontoCfg.tipo : 'valor')
  $('desconto-valor').value = descontoCfg ? descontoCfg.valor : ''
  atualizarPreviewDesconto()
  openModal('modal-desconto', 'desconto-valor')
}
$('btn-desconto').addEventListener('click', abrirDesconto)

let tipoDesconto = 'valor'
function setTipoDesconto(tipo) {
  tipoDesconto = tipo
  document.querySelectorAll('#desconto-tipo .seg').forEach(s=>s.classList.toggle('active', s.dataset.tipo===tipo))
  $('desconto-label').textContent = tipo==='percentual' ? 'Percentual de desconto (%)' : 'Valor do desconto (R$)'
  atualizarPreviewDesconto()
}
document.querySelectorAll('#desconto-tipo .seg').forEach(s =>
  s.addEventListener('click', ()=>{ setTipoDesconto(s.dataset.tipo); $('desconto-valor').focus() })
)

function lerDescontoDigitado() {
  const v = parseFloat($('desconto-valor').value)
  if (isNaN(v) || v < 0) return null
  if (tipoDesconto==='percentual' && v > 100) return null
  return { tipo: tipoDesconto, valor: round2(v) }
}

function atualizarPreviewDesconto() {
  const subtotal = subtotalCarrinho()
  const cfg = lerDescontoDigitado()
  const salvo = descontoCfg; descontoCfg = cfg
  const desc = calcDesconto(subtotal)
  descontoCfg = salvo
  $('desconto-preview').innerHTML = cfg === null && $('desconto-valor').value !== ''
    ? '<span class="negative">Valor inválido.</span>'
    : `Subtotal: <strong>${fmtMoeda(subtotal)}</strong><br>
       Desconto: <strong>− ${fmtMoeda(desc)}</strong><br>
       Total com desconto: <strong>${fmtMoeda(subtotal-desc)}</strong>`
}
$('desconto-valor').addEventListener('input', atualizarPreviewDesconto)
$('desconto-valor').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); aplicarDesconto() } })

function aplicarDesconto() {
  const cfg = lerDescontoDigitado()
  if (!cfg) { toast('Desconto inválido.','error'); return }
  if (cfg.tipo==='valor' && cfg.valor > subtotalCarrinho()) { toast('Desconto maior que o subtotal.','error'); return }
  descontoCfg = cfg.valor ? cfg : null
  closeModal('modal-desconto')
  renderCarrinho()
  if (descontoCfg) toast(`Desconto aplicado: ${fmtMoeda(calcDesconto(subtotalCarrinho()))}`,'success')
}
$('btn-aplicar-desconto').addEventListener('click', aplicarDesconto)
$('btn-remover-desconto').addEventListener('click', ()=>{
  descontoCfg = null; closeModal('modal-desconto'); renderCarrinho()
})

/* ============================================================
   PAGAMENTO (pode ser dividido em mais de uma forma)
   ============================================================ */
const pag = { lancados: [], forma: null, cliente: null, vale: null }
let valePendente = null   // vale-troca gerado na tela de Trocas para usar nesta venda
let clientesCache = []

const pagoAteAgora = () => round2(pag.lancados.reduce((s,p)=>s+p.valor,0))
const faltaPagar   = () => round2(totalCarrinho() - pagoAteAgora())

async function abrirPagamento() {
  if (!carrinho.length) return
  pag.lancados = []; pag.forma = null; pag.cliente = null; pag.vale = null
  document.querySelectorAll('.pagamento-btn').forEach(b=>b.classList.remove('selecionado'))
  document.querySelectorAll('.pag-painel').forEach(p=>p.classList.remove('ativo'))
  ;['valor-recebido','valor-cartao','pag-autorizacao','fiado-busca','valor-fiado','vale-codigo','valor-vale'].forEach(id=>$(id).value='')
  $('vale-info').innerHTML = ''
  $('pag-parcelas').innerHTML = Array.from({length:12},(_,i)=>`<option value="${i+1}">${i===0?'À vista':`${i+1}x`}</option>`).join('')
  renderPagamento()
  // Sem foco em campo, as teclas 1–6 escolhem a forma de pagamento
  openModal('modal-pagamento')
  try { clientesCache = await api.listarClientes() } catch(e) { clientesCache = [] }
  if (valePendente) { selecionarPagamento('vale'); $('vale-codigo').value = valePendente; await carregarVale() }
}
$('btn-finalizar-venda').addEventListener('click', abrirPagamento)

function renderPagamento() {
  const falta = faltaPagar()
  $('pagamento-total-valor').textContent = fmtMoeda(totalCarrinho())
  $('pagamento-pago').textContent  = fmtMoeda(pagoAteAgora())
  $('pagamento-falta').textContent = fmtMoeda(Math.max(falta,0))
  document.querySelector('.pag-falta').classList.toggle('quitado', falta <= 0)
  $('pag-lancados').innerHTML = pag.lancados.map((p,i)=>`
    <div class="pag-lancado">${icon(PAGAMENTO_ICON[p.forma])} ${PAGAMENTO_LABEL[p.forma]}
      ${p.descricao?`<small>${escHtml(p.descricao)}</small>`:''}
      <strong>${fmtMoeda(p.valor)}</strong>
      <button data-remover-pag="${i}" title="Remover">${icon('x')}</button>
    </div>`).join('')
  atualizarBotaoPagamento()
}

$('pag-lancados').addEventListener('click', e=>{
  const b = e.target.closest('[data-remover-pag]'); if (!b) return
  pag.lancados.splice(Number(b.dataset.removerPag),1)
  renderPagamento()
})

function selecionarPagamento(forma) {
  if (faltaPagar() <= 0) return
  if (forma==='dinheiro' && pag.lancados.some(p=>p.forma==='dinheiro')) { toast('O dinheiro já foi lançado.','warn'); return }
  pag.forma = forma
  document.querySelectorAll('.pagamento-btn').forEach(b=>b.classList.toggle('selecionado', b.dataset.pag===forma))
  const painel = ['pix','debito','credito'].includes(forma) ? 'cartao' : forma
  document.querySelectorAll('.pag-painel').forEach(p=>p.classList.toggle('ativo', p.dataset.painel===painel))
  const falta = faltaPagar()

  if (forma==='dinheiro') {
    montarNotasRapidas(falta)
    $('valor-recebido').value = ''
    $('valor-recebido').focus()
  }
  if (painel==='cartao') {
    $('valor-cartao').value = falta.toFixed(2)
    $('pag-autorizacao').value = ''
    $('pag-parcelas').value = '1'
    $('grupo-parcelas').style.display = forma==='credito' ? '' : 'none'
    $('maquininha-forma').textContent = forma==='pix' ? '(PIX)' : forma==='debito' ? 'no débito' : 'no crédito'
    $('valor-cartao').focus(); $('valor-cartao').select()
  }
  if (forma==='fiado') {
    $('valor-fiado').value = falta.toFixed(2)
    renderListaFiado()
    if (pag.cliente) $('valor-fiado').focus(); else $('fiado-busca').focus()
  }
  if (forma==='vale') {
    $('vale-codigo').focus()
    if (pag.vale) $('valor-vale').value = Math.min(pag.vale.saldo, falta).toFixed(2)
  }
  atualizarBotaoPagamento()
}

document.querySelectorAll('.pagamento-btn').forEach(btn=>
  btn.addEventListener('click', ()=>selecionarPagamento(btn.dataset.pag))
)

function montarNotasRapidas(valor) {
  const sugestoes = [valor]
  ;[5,10,20,50,100].forEach(n=>{
    const v = Math.ceil(valor/n)*n
    if (v > valor && !sugestoes.includes(v)) sugestoes.push(v)
  })
  $('notas-rapidas').innerHTML = sugestoes.slice(0,5).map((v,i)=>
    `<button class="btn btn-sm btn-secondary" data-valor="${v}">${i===0?'Valor exato':fmtMoeda(v)}</button>`).join('')
}

$('notas-rapidas').addEventListener('click', e=>{
  const b = e.target.closest('[data-valor]'); if (!b) return
  $('valor-recebido').value = Number(b.dataset.valor).toFixed(2)
  atualizarBotaoPagamento()
  $('valor-recebido').focus()
})

$('valor-cartao').addEventListener('input', ()=>{ atualizarMaquininha(); atualizarBotaoPagamento() })
function atualizarMaquininha() { $('maquininha-valor').textContent = fmtMoeda(parseFloat($('valor-cartao').value)||0) }

/* Lê o painel da forma escolhida e devolve o pagamento a lançar (ou o motivo de não poder) */
function pagamentoDigitado() {
  const falta = faltaPagar()
  const f = pag.forma
  if (!f) return { erro: 'Escolha a forma de pagamento.' }
  if (f==='dinheiro') {
    const txt = $('valor-recebido').value
    const recebido = txt==='' ? falta : round2(parseFloat(txt))
    if (isNaN(recebido) || recebido <= 0) return { erro: 'Valor recebido inválido.' }
    const valor = Math.min(recebido, falta)
    return { forma:f, valor, recebido, troco: round2(recebido - valor),
             descricao: recebido > valor ? `recebido ${fmtMoeda(recebido)}` : '' }
  }
  if (['pix','debito','credito'].includes(f)) {
    const valor = round2(parseFloat($('valor-cartao').value))
    if (!(valor > 0)) return { erro: 'Valor inválido.' }
    if (valor > falta + 0.001) return { erro: `No ${PAGAMENTO_LABEL[f]} o valor não pode passar de ${fmtMoeda(falta)}.` }
    const parcelas = f==='credito' ? parseInt($('pag-parcelas').value) : 1
    const aut = $('pag-autorizacao').value.trim()
    const partes = [parcelas>1?`${parcelas}x`:'', aut?`aut. ${aut}`:''].filter(Boolean)
    return { forma:f, valor, detalhe: partes.join(' · ') || null, descricao: partes.join(' · ') }
  }
  if (f==='fiado') {
    if (!pag.cliente) return { erro: 'Escolha o cliente do fiado.' }
    const valor = round2(parseFloat($('valor-fiado').value))
    if (!(valor > 0) || valor > falta + 0.001) return { erro: 'Valor do fiado inválido.' }
    return { forma:f, valor, descricao: pag.cliente.nome }
  }
  if (f==='vale') {
    if (!pag.vale) return { erro: 'Leia o código do vale-troca.' }
    if (pag.lancados.some(p=>p.forma==='vale' && p.detalhe===pag.vale.codigo)) return { erro: 'Este vale já foi lançado.' }
    const valor = round2(parseFloat($('valor-vale').value))
    if (!(valor > 0)) return { erro: 'Valor do vale inválido.' }
    if (valor > pag.vale.saldo + 0.001) return { erro: `O vale tem só ${fmtMoeda(pag.vale.saldo)}.` }
    if (valor > falta + 0.001) return { erro: `O valor não pode passar de ${fmtMoeda(falta)}.` }
    return { forma:f, valor, detalhe: pag.vale.codigo, descricao: pag.vale.codigo }
  }
}

function atualizarBotaoPagamento() {
  const btn = $('btn-confirmar-pagamento')
  const falta = faltaPagar()
  const p = falta > 0 ? pagamentoDigitado() : null
  const fecha = falta <= 0 || (p && !p.erro && p.valor >= falta - 0.001)
  btn.disabled = falta > 0 && (!p || !!p.erro)
  $('btn-confirmar-texto').textContent = fecha ? 'Confirmar venda' : 'Lançar e continuar'

  // Troco (dinheiro)
  if (pag.forma==='dinheiro') {
    const row = document.querySelector('[data-painel="dinheiro"] .troco-row')
    if (p && !p.erro) {
      const restante = round2(falta - p.valor)
      row.classList.toggle('falta', restante > 0)
      row.firstElementChild.textContent = restante > 0 ? 'Falta (pague o resto em outra forma)' : 'Troco'
      $('troco-valor').textContent = fmtMoeda(restante > 0 ? restante : p.troco)
    } else {
      row.classList.add('falta'); row.firstElementChild.textContent = 'Valor inválido'; $('troco-valor').textContent = '—'
    }
  }
  if (['pix','debito','credito'].includes(pag.forma)) atualizarMaquininha()
}
;['valor-recebido','valor-fiado','valor-vale','pag-parcelas'].forEach(id=>$(id).addEventListener('input', atualizarBotaoPagamento))

// Enter em qualquer campo do pagamento lança/confirma
;['valor-recebido','valor-cartao','pag-autorizacao','valor-fiado','valor-vale'].forEach(id=>
  $(id).addEventListener('keydown', e=>{ if (e.key==='Enter') { e.preventDefault(); confirmarPagamento() } })
)

/* Fiado: escolha do cliente */
function renderListaFiado() {
  const q = $('fiado-busca').value.trim().toLowerCase()
  const lista = clientesCache.filter(c => !q || c.nome.toLowerCase().includes(q) || (c.telefone||'').includes(q)).slice(0, 30)
  $('fiado-lista').innerHTML = !lista.length
    ? `<div class="side-vazio">Nenhum cliente encontrado. Use "Novo" para cadastrar.</div>`
    : lista.map(c=>`<button class="fiado-item ${pag.cliente&&pag.cliente.id===c.id?'selecionado':''}" data-cliente="${c.id}">
        <span><strong>${escHtml(c.nome)}</strong> <small>${escHtml(c.telefone||'')}</small></span>
        <small>${c.saldo>0?`deve ${fmtMoeda(c.saldo)}`:'sem débito'}</small>
      </button>`).join('')
}
$('fiado-busca').addEventListener('input', renderListaFiado)
$('fiado-busca').addEventListener('keydown', e=>{
  if (e.key!=='Enter') return
  e.preventDefault()
  const primeiro = $('fiado-lista').querySelector('[data-cliente]')
  if (primeiro) primeiro.click()
})
$('fiado-lista').addEventListener('click', e=>{
  const b = e.target.closest('[data-cliente]'); if (!b) return
  pag.cliente = clientesCache.find(c=>c.id===Number(b.dataset.cliente))
  $('fiado-busca').value = pag.cliente.nome
  renderListaFiado()
  atualizarBotaoPagamento()
  $('valor-fiado').focus(); $('valor-fiado').select()
})
$('btn-fiado-novo-cliente').addEventListener('click', ()=>{
  abrirCadastroCliente(null, async cliente => {
    clientesCache = await api.listarClientes()
    pag.cliente = clientesCache.find(c=>c.id===cliente.id)
    $('fiado-busca').value = cliente.nome
    renderListaFiado(); atualizarBotaoPagamento()
    $('valor-fiado').focus()
  })
})

/* Vale-troca */
async function carregarVale() {
  const codigo = $('vale-codigo').value.trim()
  pag.vale = null
  if (!codigo) { $('vale-info').innerHTML = ''; atualizarBotaoPagamento(); return }
  const vale = await api.buscarVale(codigo)
  if (!vale) {
    $('vale-info').innerHTML = '<span class="negative">Vale-troca não encontrado.</span>'
  } else if (vale.saldo <= 0) {
    $('vale-info').innerHTML = `<span class="negative">O vale ${escHtml(vale.codigo)} já foi totalmente usado.</span>`
  } else {
    pag.vale = vale
    $('vale-info').innerHTML = `<span class="positive">Vale ${escHtml(vale.codigo)}</span> — saldo <strong>${fmtMoeda(vale.saldo)}</strong>${vale.cliente_nome?` · ${escHtml(vale.cliente_nome)}`:''}`
    $('valor-vale').value = Math.min(vale.saldo, faltaPagar()).toFixed(2)
    $('valor-vale').focus(); $('valor-vale').select()
  }
  atualizarBotaoPagamento()
}
$('vale-codigo').addEventListener('keydown', e=>{ if (e.key==='Enter') { e.preventDefault(); carregarVale() } })
$('vale-codigo').addEventListener('change', carregarVale)

$('btn-confirmar-pagamento').addEventListener('click', confirmarPagamento)

async function confirmarPagamento() {
  if (finalizando) return
  if (faltaPagar() > 0) {
    const p = pagamentoDigitado()
    if (!p || p.erro) { if (p) toast(p.erro,'error'); return }
    pag.lancados.push(p)
    pag.forma = null
    document.querySelectorAll('.pagamento-btn').forEach(b=>b.classList.remove('selecionado'))
    document.querySelectorAll('.pag-painel').forEach(x=>x.classList.remove('ativo'))
    renderPagamento()
    if (faltaPagar() > 0) {
      toast(`Lançado. Falta ${fmtMoeda(faltaPagar())} — escolha a próxima forma.`)
      if (document.activeElement) document.activeElement.blur()
      return
    }
  }
  await finalizarVendaAtual()
}

async function finalizarVendaAtual() {
  finalizando = true
  const subtotal = subtotalCarrinho()
  const dinheiro = pag.lancados.find(p=>p.forma==='dinheiro')
  const fiado    = pag.lancados.some(p=>p.forma==='fiado')
  try {
    const venda = await api.finalizarVenda({
      itens:      itensParaVenda(),
      desconto:   calcDesconto(subtotal),
      pagamentos: pag.lancados.map(p=>({ forma:p.forma, valor:p.valor, detalhe:p.detalhe||null, recebido:p.recebido })),
      cliente_id: fiado && pag.cliente ? pag.cliente.id : null
    })
    ultimaVendaId = venda.id
    $('venda-ok-numero').textContent    = `Venda nº ${fmtNumVenda(venda.id)}`
    $('venda-ok-total').textContent     = fmtMoeda(venda.total)
    const formas = [...new Set(pag.lancados.map(p=>p.forma))]
    $('venda-ok-pagamento').textContent = formas.map(f=>PAGAMENTO_LABEL[f]).join(' + ') || '—'
    $('venda-ok-troco-box').style.display = dinheiro ? 'flex' : 'none'
    $('venda-ok-troco').textContent = fmtMoeda(venda.troco||0)
    if (fiado) {
      const det = await api.detalhesVenda(venda.id)
      $('venda-ok-fiado').innerHTML = `Fiado para <strong>${escHtml(pag.cliente.nome)}</strong>.<br>Saldo devedor agora: <strong>${fmtMoeda(det.saldoCliente)}</strong>. Imprima o comprovante para o cliente assinar.`
    }
    $('venda-ok-fiado').style.display = fiado ? 'block' : 'none'
    if (pag.lancados.some(p=>p.forma==='vale')) valePendente = null

    $('modal-pagamento').classList.remove('open')
    carrinho = []; ultimoIdx = -1; descontoCfg = null
    renderCarrinho(); renderValeBanner()
    openModal('modal-venda-ok', 'btn-nova-venda')
    await carregarProdutos()
    await atualizarNumeroVenda()
  } catch(err) {
    toast(`Erro ao finalizar: ${msgErro(err)}`,'error')
  } finally {
    finalizando = false
  }
}

function renderValeBanner() {
  const el = $('vale-banner')
  el.style.display = valePendente ? 'flex' : 'none'
  if (valePendente) el.innerHTML = `${icon('ticket')} Vale-troca <strong>${escHtml(valePendente)}</strong> será usado no pagamento desta venda.
    <button class="link-btn" id="btn-vale-descartar">não usar agora</button>`
}
$('vale-banner').addEventListener('click', e=>{
  if (e.target.closest('#btn-vale-descartar')) { valePendente = null; renderValeBanner(); focarScanner() }
})

$('btn-nova-venda').addEventListener('click', ()=>closeModal('modal-venda-ok'))
$('btn-gerar-comprovante').addEventListener('click', ()=> gerarComprovante(ultimaVendaId))
$('btn-comprovante-detalhe').addEventListener('click', ()=> gerarComprovante(detalheVendaId))

$('btn-atalhos').addEventListener('click', ()=>openModal('modal-atalhos'))

// Clicar em área vazia do caixa devolve o foco ao leitor
$('section-caixa').addEventListener('click', e=>{
  if (!e.target.closest('input, button, select, a')) focarScanner()
})

/* ============================================================
   TECLADO
   ============================================================ */
document.addEventListener('keydown', e => {
  const modal = modalAberto()
  const emCampo = e.target.matches('input, textarea, select')

  if (e.key==='F1') { e.preventDefault(); if (!modal) navigateTo('caixa'); return }

  if (e.key==='Escape' && modal) { e.preventDefault(); closeModal(modal); return }

  if (modal==='modal-pagamento') {
    const mapa = { '1':'dinheiro', '2':'pix', '3':'debito', '4':'credito', '5':'fiado', '6':'vale' }
    if (!emCampo && mapa[e.key]) { e.preventDefault(); selecionarPagamento(mapa[e.key]); return }
    if (e.key==='Enter' && !emCampo) { e.preventDefault(); confirmarPagamento(); return }
    return
  }
  if (modal==='modal-venda-ok') {
    if (e.key==='Enter')                { e.preventDefault(); closeModal('modal-venda-ok') }
    if (e.key==='p' || e.key==='P')     { e.preventDefault(); gerarComprovante(ultimaVendaId) }
    return
  }
  // Enter numa caixa de marcar também confirma o modal
  const primario = { 'modal-receber':'btn-confirmar-receber', 'modal-movimento':'btn-salvar-movimento',
                     'modal-fechar-caixa':'btn-confirmar-fechamento' }[modal]
  if (primario && e.key==='Enter' && e.target.type==='checkbox') { e.preventDefault(); $(primario).click(); return }
  if (modal) return

  if (secaoAtiva()!=='caixa') return
  if (!caixaAberto()) return

  if (e.key==='F2')  { e.preventDefault(); abrirBusca(); return }
  if (e.key==='F4')  { e.preventDefault(); abrirDesconto(); return }
  if (e.key==='F8')  { e.preventDefault(); cancelarVendaAtual(); return }
  if (e.key==='F10') { e.preventDefault(); abrirPagamento(); return }
  if (e.key==='Delete' && (!emCampo || (e.target.id==='input-barcode' && !e.target.value))) {
    e.preventDefault(); removerUltimoItem(); return
  }

  // Leitor de código digitando fora do campo: redireciona para o campo
  if (!emCampo && e.key.length===1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    $('input-barcode').focus()
  }
})

/* ============================================================
   RELATÓRIOS (operador — sem lucro)
   ============================================================ */
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.remove('active'))
    document.querySelectorAll('.tab-pane[id^="tab-"]').forEach(p=>p.classList.remove('active'))
    btn.classList.add('active')
    $(`tab-${btn.dataset.tab}`).classList.add('active')
    if(btn.dataset.tab==='hoje')   carregarHoje()
    if(btn.dataset.tab==='mensal') carregarMensal()
    if(btn.dataset.tab==='caixas') carregarCaixas()
  })
})

function initDateSelectors() {
  const now = new Date()
  const mesA = now.getMonth()+1, anoA = now.getFullYear()
  const anos = Array.from({length:5},(_,i)=>anoA-i)
  const mesOpts = MESES_PT.slice(1).map((m,i)=>`<option value="${i+1}"${i+1===mesA?' selected':''}>${m}</option>`).join('')
  const anoOpts = anos.map(a=>`<option value="${a}"${a===anoA?' selected':''}>${a}</option>`).join('')

  ;['sel-mes-mensal','admin-sel-mes-lucro','admin-sel-mes-estornos','sel-mes-caixas','merc-sel-mes'].forEach(id=>{ $(id).innerHTML=mesOpts })
  ;['sel-ano-mensal','admin-sel-ano-lucro','admin-sel-ano-estornos','sel-ano-caixas','merc-sel-ano'].forEach(id=>{ $(id).innerHTML=anoOpts })
}

function statsVendas(totais) {
  const ticket = totais.num_vendas>0 ? totais.total_vendas/totais.num_vendas : 0
  return `
    <div class="stat-card c-purple"><span class="stat-label">Vendas</span><span class="stat-value">${totais.num_vendas}</span>
      ${totais.num_canceladas?`<span class="stat-sub">${totais.num_canceladas} estornada${totais.num_canceladas!==1?'s':''}</span>`:''}</div>
    <div class="stat-card c-green"><span class="stat-label">Total arrecadado</span><span class="stat-value green">${fmtMoeda(totais.total_vendas)}</span></div>
    <div class="stat-card"><span class="stat-label">Ticket médio</span><span class="stat-value purple">${fmtMoeda(ticket)}</span></div>
    <div class="stat-card c-orange"><span class="stat-label">Descontos dados</span><span class="stat-value">${fmtMoeda(totais.total_descontos)}</span></div>`
}

function linhasVendas(vendas, comData, vazio) {
  if (!vendas.length) return linhaVazia(6, 'cart', vazio)
  return vendas.map(v=>`<tr class="${v.status==='cancelada'?'row-cancelada':''}">
      <td><code>#${fmtNumVenda(v.id)}</code></td>
      <td>${comData?fmtDH(v.criado_em):fmtHora(v.criado_em)}</td>
      <td>${v.status==='cancelada'?'<span class="badge-status cancelada">Estornada</span>':badgePagamento(v.pagamento)}</td>
      <td>${v.num_itens} ${v.num_itens===1?'item':'itens'}${v.cliente_nome?`<div class="item-cod">${escHtml(v.cliente_nome)}</div>`:''}</td>
      <td class="num"><strong>${fmtMoeda(v.total)}</strong></td>
      <td style="text-align:right;"><button class="btn btn-sm btn-outline" data-ver="${v.id}">${icon('eye')} Ver</button></td>
    </tr>`).join('')
}

function renderPagResumo(el, porPagamento, total) {
  if (!porPagamento.length) { el.innerHTML = '<div class="side-vazio">Nenhuma venda no período</div>'; return }
  el.innerHTML = porPagamento.map(p=>`
    <div class="pag-linha">
      <span class="pag-nome">${icon(PAGAMENTO_ICON[p.pagamento]||'wallet')}${PAGAMENTO_LABEL[p.pagamento]||escHtml(p.pagamento)}</span>
      <span class="pag-valor">${fmtMoeda(p.total)}</span>
      <span class="pag-qtd">${p.quantidade} venda${p.quantidade!==1?'s':''}</span>
      <span class="pag-qtd" style="text-align:right;">${total>0?((p.total/total)*100).toFixed(0):0}%</span>
      <div class="pag-barra"><span style="width:${total>0?(p.total/total)*100:0}%"></span></div>
    </div>`).join('') +
    `<div class="pag-total"><span>Total</span><span>${fmtMoeda(total)}</span></div>`
}

async function carregarHoje() {
  const dados = await api.vendasHoje()
  const d = new Date()
  $('titulo-hoje').textContent =
    `Vendas de ${d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}`
  $('stats-hoje').innerHTML = statsVendas(dados.totais)
  $('tbody-hoje').innerHTML = linhasVendas(dados.vendas, false, 'Nenhuma venda hoje')
  renderPagResumo($('pagamentos-hoje'), dados.porPagamento, dados.totais.total_vendas)
}

$('btn-refresh-hoje').addEventListener('click', carregarHoje)

async function carregarMensal() {
  const mes = parseInt($('sel-mes-mensal').value)
  const ano = parseInt($('sel-ano-mensal').value)
  const [dados, top] = await Promise.all([api.vendasMensais(mes, ano), api.maisVendidos(mes, ano)])
  $('stats-mensal').innerHTML = statsVendas(dados.totais)
  $('tbody-mensal').innerHTML = linhasVendas(dados.vendas, true, 'Nenhuma venda neste período')
  renderPagResumo($('pagamentos-mensal'), dados.porPagamento, dados.totais.total_vendas)
  $('top-produtos-mensal').innerHTML = !top.length
    ? '<div class="side-vazio">Nenhuma venda no período</div>'
    : top.map((p,i)=>`<div class="top-item">
        <span class="top-pos">${i+1}</span>
        <span class="top-nome" title="${escHtml(p.nome_produto)}">${escHtml(p.nome_produto)}</span>
        <span class="top-qtd"><strong>${p.quantidade}</strong> un · ${fmtMoeda(p.total)}</span>
      </div>`).join('')
}

$('btn-buscar-mensal').addEventListener('click', carregarMensal)

;['tbody-hoje','tbody-mensal'].forEach(id => $(id).addEventListener('click', e=>{
  const b = e.target.closest('[data-ver]'); if (b) verDetalhesVenda(Number(b.dataset.ver))
}))

/* Detalhes venda */
async function verDetalhesVenda(id) {
  detalheVendaId = id
  const {venda, itens, pagamentos} = await api.detalhesVenda(id)
  $('detalhes-venda-titulo').textContent = `Venda nº ${fmtNumVenda(id)}`
  $('detalhes-venda-info').innerHTML = `
    <span class="info-pill">Data: <strong>${fmtDH(venda.criado_em)}</strong></span>
    ${pagamentos.map(p=>`<span class="info-pill">${PAGAMENTO_LABEL[p.forma]||escHtml(p.forma)}: <strong>${fmtMoeda(p.valor)}</strong>${p.detalhe?` (${escHtml(p.detalhe)})`:''}</span>`).join('')}
    ${venda.cliente_nome?`<span class="info-pill">Cliente: <strong>${escHtml(venda.cliente_nome)}</strong></span>`:''}
    ${venda.status==='cancelada'?`<span class="badge-status cancelada">Estornada em ${fmtDH(venda.cancelado_em)}</span>`:''}`
  $('tbody-detalhes-venda').innerHTML = itens.map(i=>`
    <tr>
      <td>${escHtml(i.nome_produto)} ${i.promo?'<span class="badge-queima">queima</span>':''}</td>
      <td class="ctr">${i.quantidade}</td>
      <td class="num">${fmtMoeda(i.preco_unitario)}</td>
      <td class="num"><strong>${fmtMoeda(i.preco_unitario*i.quantidade)}</strong></td>
    </tr>`).join('')
  $('detalhes-total-row').innerHTML = `
    ${venda.desconto>0?`<span>Subtotal: ${fmtMoeda(venda.subtotal)}</span><span>Desconto: − ${fmtMoeda(venda.desconto)}</span>`:''}
    <span class="grand">Total: ${fmtMoeda(venda.total)}</span>
    ${venda.valor_recebido!=null?`<span>Recebido: ${fmtMoeda(venda.valor_recebido)} · Troco: ${fmtMoeda(venda.troco)}</span>`:''}`
  openModal('modal-detalhes-venda')
}

/* ============================================================
   CUPOM TÉRMICO 80mm (comprovantes, vale, sangria, fechamento)
   ============================================================ */
// Texto sem acento: as fontes padrão do PDF nas impressoras térmicas não têm todos os acentos
function semAcento(t) { return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '') }

function imprimirPDF(doc) {
  const blobUrl = doc.output('bloburl')
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;'
  iframe.src = blobUrl
  document.body.appendChild(iframe)
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } catch(e) {
      window.open(blobUrl)
    }
    setTimeout(() => {
      document.body.removeChild(iframe)
      URL.revokeObjectURL(blobUrl)
    }, 60000)
  }
}

/* montar(c) recebe as funções de desenho; a altura do papel é medida antes de gerar o PDF */
function cupomTermico(montar, { imprimir = true } = {}) {
  const { jsPDF } = window.jspdf
  const W = 80, m = 5
  const desenhar = (doc) => {
    let y = 8
    const fonte = (tam, estilo='normal') => { doc.setFontSize(tam); doc.setFont('helvetica', estilo); doc.setTextColor(0) }
    const c = {
      centro(txt, { tam=8, estilo='normal', passo=4.6 } = {}) {
        fonte(tam, estilo); doc.text(semAcento(txt), W/2, y, { align:'center' }); y += passo
      },
      linha(rotulo, valor, { tam=8, negrito=false, passo=5 } = {}) {
        fonte(tam, 'normal'); doc.text(semAcento(rotulo), m, y)
        fonte(tam, negrito ? 'bold' : 'normal'); doc.text(semAcento(valor), W-m, y, { align:'right' }); y += passo
      },
      item(nome, qtd, valor) {
        fonte(8); doc.text(semAcento(nome.length>22?nome.slice(0,22)+'..':nome), m, y)
        doc.text(String(qtd), W-m-20, y, { align:'right' })
        fonte(8,'bold'); doc.text(semAcento(valor), W-m, y, { align:'right' }); y += 4.6
      },
      texto(txt, { tam=7.5, estilo='normal', passo=3.8 } = {}) {
        fonte(tam, estilo)
        doc.splitTextToSize(semAcento(txt), W-2*m).forEach(l => { doc.text(l, m, y); y += passo })
      },
      solida()    { doc.setLineWidth(0.4); doc.setLineDash([],0); doc.line(m, y, W-m, y); y += 5 },
      tracejada() { doc.setLineWidth(0.3); doc.setLineDash([1.2,1.2],0); doc.line(m, y, W-m, y); doc.setLineDash([],0); y += 4 },
      espaco(n=3) { y += n },
      imagem(url, w, h) { doc.addImage(url, 'PNG', (W-w)/2, y, w, h); y += h + 2 },
      assinatura(rotulo) { y += 10; doc.setLineWidth(0.3); doc.line(m+8, y, W-m-8, y); y += 4; c.centro(rotulo, { tam:7 }) },
      cabecalho(titulo) {
        c.centro('CANTINHO DO BEBE', { tam:13, estilo:'bold', passo:5 })
        c.centro(titulo, { tam:8, passo:4 })
      }
    }
    montar(c)
    return y
  }
  const altura = desenhar(new jsPDF({ unit:'mm', format:[W, 3000] })) + 6
  const doc = new jsPDF({ unit:'mm', format:[W, Math.max(altura, 50)], orientation:'portrait' })
  desenhar(doc)
  if (imprimir) imprimirPDF(doc)
  return doc
}

function barcodePNG(codigo) {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, codigo, { format:'CODE128', width:2, height:60, displayValue:true, fontSize:18, margin:4 })
  return canvas.toDataURL('image/png')
}

/* Comprovante da venda */
async function gerarComprovante(vendaId) {
  if (!vendaId) { toast('Venda não encontrada.', 'error'); return }
  const { venda, itens, pagamentos, saldoCliente } = await api.detalhesVenda(vendaId)

  cupomTermico(c => {
    c.cabecalho('Comprovante de Venda')
    c.centro('NAO E DOCUMENTO FISCAL', { tam:6.5, passo:5 })
    c.solida()
    if (venda.status === 'cancelada') { c.centro('*** VENDA ESTORNADA ***', { tam:10, estilo:'bold', passo:6 }); c.tracejada() }
    c.linha('Venda:', `No ${fmtNumVenda(venda.id)}`, { negrito:true })
    c.linha('Data/Hora:', fmtDH(venda.criado_em), { negrito:true })
    if (venda.cliente_nome) c.linha('Cliente:', venda.cliente_nome, { negrito:true })
    c.espaco(1); c.solida()
    c.item('PRODUTO', 'QTD', 'TOTAL'); c.tracejada()
    itens.forEach(i => {
      c.item(i.nome_produto, i.quantidade, fmtMoeda(i.preco_unitario * i.quantidade))
      if (i.quantidade > 1 || i.promo) c.texto(`  ${i.quantidade}x ${fmtMoeda(i.preco_unitario)}${i.promo?' (queima de estoque)':''}`, { tam:7 })
    })
    c.tracejada()
    if (venda.desconto > 0) {
      c.linha('Subtotal:', fmtMoeda(venda.subtotal))
      c.linha('Desconto:', `- ${fmtMoeda(venda.desconto)}`)
    }
    c.linha('TOTAL:', fmtMoeda(venda.total), { tam:11, negrito:true, passo:6 })
    pagamentos.forEach(p => c.linha(`${PAGAMENTO_PDF[p.forma]||p.forma}${p.detalhe?` (${p.detalhe})`:''}:`, fmtMoeda(p.valor)))
    if (venda.valor_recebido != null && venda.troco > 0) {
      c.linha('Dinheiro recebido:', fmtMoeda(venda.valor_recebido))
      c.linha('Troco:', fmtMoeda(venda.troco), { negrito:true })
    }
    if (pagamentos.some(p => p.forma === 'fiado')) {
      c.espaco(1); c.tracejada()
      c.linha('Saldo devedor atual:', fmtMoeda(saldoCliente), { negrito:true })
      c.assinatura(`Assinatura: ${venda.cliente_nome || 'cliente'}`)
    }
    c.espaco(2); c.solida()
    c.centro('Obrigado pela compra!', { estilo:'italic' })
    c.centro('Trocas somente com este comprovante.', { estilo:'italic' })
  })
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

  // Transição
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
  doc.text('Cantinho do Bebê', 14, 13)

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

    doc.setFillColor(...s.bg)
    doc.setDrawColor(...s.bg)
    doc.roundedRect(x, y, cW, cH, 2, 2, 'FD')

    doc.setFillColor(...s.accent)
    doc.roundedRect(x, y, 3, cH, 1, 1, 'F')

    doc.setTextColor(...s.label)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text(card.label.toUpperCase(), x + 6, y + 7)

    doc.setTextColor(...s.value)
    doc.setFontSize(n > 3 ? 11.5 : 13)
    doc.setFont('helvetica', 'bold')
    doc.text(String(card.value), x + 6, y + 18)
  })

  return y + cH + 7
}

/* Título de seção */
function _pdfSecao(doc, y, titulo) {
  if (y > 255) { doc.addPage(); y = 20 }
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(10.5)
  doc.setFont('helvetica', 'bold')
  doc.text(titulo, 14, y + 4)
  return y + 8
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

  if (y + hH + rH > 280) { doc.addPage(); y = 20 }
  let blocoInicio = y
  y = desenharHeader(y)

  const fecharBloco = (fim) => {
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.5)
    doc.rect(m, blocoInicio, tableW, fim - blocoInicio, 'S')
  }

  rows.forEach((row, ri) => {
    if (y + rH > 280) {
      fecharBloco(y)
      doc.addPage()
      blocoInicio = 20
      y = desenharHeader(20)
    }

    doc.setFillColor(ri % 2 === 0 ? 248 : 255, ri % 2 === 0 ? 250 : 255, ri % 2 === 0 ? 252 : 255)
    doc.rect(m, y, tableW, rH, 'F')

    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.line(m, y + rH, m + tableW, y + rH)

    let xc = m
    row.forEach((cell, i) => {
      const al = aligns?.[i] || 'left'
      const xT = al === 'right' ? xc + colWidths[i] - 3 : (al === 'center' ? xc + colWidths[i] / 2 : xc + 3)
      doc.setTextColor(30, 41, 59)
      doc.setFontSize(8.5)
      doc.setFont('helvetica', (i === 0 || i === row.length - 1) ? 'bold' : 'normal')
      doc.text(String(cell), xT, y + 5.2, { align: al })
      xc += colWidths[i]
    })

    y += rH
  })

  fecharBloco(y)
  return y + 5
}

/* Linha totalizadora abaixo da tabela */
function _pdfTotalRow(doc, y, label, valor) {
  const m = 14, W = 210
  if (y + 9 > 282) { doc.addPage(); y = 20 }
  doc.setFillColor(30, 41, 59)
  doc.rect(m, y, W - m * 2, 9, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(label, m + 3, y + 6)
  doc.text(valor, W - m - 3, y + 6, { align: 'right' })
  return y + 9 + 6
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
    doc.text('Cantinho do Bebê — Sistema PDV', 14, 290)
    doc.text(`Página ${p} de ${totalPages}`, W / 2, 290, { align: 'center' })
    const footerRight = isConfidential ? 'Documento confidencial' : 'Gerado automaticamente'
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

/* Blocos comuns dos relatórios de vendas */
function _pdfCardsVendas(doc, y, totais) {
  const ticket = totais.num_vendas > 0 ? totais.total_vendas / totais.num_vendas : 0
  return _pdfCards(doc, y, [
    { label: 'Vendas',           value: String(totais.num_vendas),      color: 'purple' },
    { label: 'Total arrecadado', value: fmtMoeda(totais.total_vendas),  color: 'green'  },
    { label: 'Ticket médio',     value: fmtMoeda(ticket),               color: 'gray'   },
    { label: 'Descontos',        value: fmtMoeda(totais.total_descontos), color: 'orange' },
  ])
}

function _pdfPagamentos(doc, y, porPagamento, total) {
  if (!porPagamento.length) return y
  y = _pdfSecao(doc, y, 'Conferência por forma de pagamento')
  return _pdfTable(doc, y, {
    headers:   ['Forma de pagamento', 'Vendas', '% do total', 'Valor (R$)'],
    colWidths: [72, 30, 30, 50],
    aligns:    ['left', 'center', 'center', 'right'],
    rows: porPagamento.map(p => [
      PAGAMENTO_LABEL[p.pagamento] || p.pagamento,
      String(p.quantidade),
      fmtPct(total > 0 ? (p.total / total) * 100 : 0),
      fmtMoeda(p.total)
    ])
  }) + 3
}

/* ============================================================
   PDF — EXPORTAR: VENDAS DE HOJE
   ============================================================ */
$('btn-export-hoje').addEventListener('click', async () => {
  const dados = await api.vendasHoje()
  const doc   = _novoPDF()
  const hoje  = new Date()
  const periodoStr = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  let y = _pdfHeader(doc, 'Relatório de Vendas do Dia', periodoStr)
  y = _pdfCardsVendas(doc, y, dados.totais)
  y = _pdfPagamentos(doc, y, dados.porPagamento, dados.totais.total_vendas)

  const vendas = dados.vendas.filter(v => v.status === 'concluida')
  y = _pdfSecao(doc, y, 'Vendas')
  if (vendas.length > 0) {
    y = _pdfTable(doc, y, {
      headers:   ['Nº', 'Hora', 'Forma de Pagamento', 'Itens', 'Total (R$)'],
      colWidths: [24,   22,     62,                   22,      52],
      aligns:    ['left','left','left',                'center','right'],
      rows: vendas.map(v => [
        fmtNumVenda(v.id),
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
$('btn-export-mensal').addEventListener('click', async () => {
  const mes   = parseInt($('sel-mes-mensal').value)
  const ano   = parseInt($('sel-ano-mensal').value)
  const [dados, top] = await Promise.all([api.vendasMensais(mes, ano), api.maisVendidos(mes, ano)])
  const doc   = _novoPDF()

  let y = _pdfHeader(doc, 'Histórico Mensal de Vendas', `Período: ${MESES_PT[mes]} de ${ano}`)
  y = _pdfCardsVendas(doc, y, dados.totais)
  y = _pdfPagamentos(doc, y, dados.porPagamento, dados.totais.total_vendas)

  if (top.length) {
    y = _pdfSecao(doc, y, 'Produtos mais vendidos')
    y = _pdfTable(doc, y, {
      headers:   ['#', 'Produto', 'Quantidade', 'Valor (R$)'],
      colWidths: [14, 98, 30, 40],
      aligns:    ['left', 'left', 'center', 'right'],
      rows: top.map((p, i) => [String(i + 1), p.nome_produto.slice(0, 55), String(p.quantidade), fmtMoeda(p.total)])
    }) + 3
  }

  const vendas = dados.vendas.filter(v => v.status === 'concluida')
  y = _pdfSecao(doc, y, 'Vendas')
  if (vendas.length > 0) {
    y = _pdfTable(doc, y, {
      headers:   ['Nº', 'Data / Hora', 'Forma de Pagamento', 'Itens', 'Total (R$)'],
      colWidths: [22,   40,            58,                   20,      42],
      aligns:    ['left','left',        'left',               'center','right'],
      rows: vendas.map(v => [
        fmtNumVenda(v.id),
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
let ultimaAtividade = Date.now()
;['mousemove','keydown','mousedown'].forEach(ev =>
  document.addEventListener(ev, ()=>{ ultimaAtividade = Date.now() }, { passive:true })
)

// Encerra a sessão de administrador após inatividade
setInterval(()=>{
  if (isAdmin && Date.now() - ultimaAtividade > ADMIN_TIMEOUT_MS) {
    sairAdmin()
    toast('Sessão de administrador encerrada por inatividade.','warn')
  }
}, 30 * 1000)

function renderAdminState() {
  $('admin-login-wall').style.display = isAdmin ? 'none' : 'flex'
  $('admin-painel').style.display     = isAdmin ? 'block' : 'none'
  $('admin-dot').classList.toggle('on', isAdmin)
  if (isAdmin) {
    const ativa = document.querySelector('[data-admin-tab].active')
    abrirAbaAdmin(ativa ? ativa.dataset.adminTab : 'custos')
  } else {
    setTimeout(()=>$('admin-email').focus(), 60)
  }
  if (secaoAtiva()==='mercadorias') abrirMercadorias()
}

async function sairAdmin() {
  isAdmin = false
  try { await api.adminLogout() } catch(e) {}
  renderAdminState()
}

/* Login */
$('btn-admin-login').addEventListener('click', async ()=>{
  const email = $('admin-email').value.trim()
  const senha = $('admin-senha').value
  const errEl = $('admin-error')
  errEl.style.display = 'none'
  if (!email||!senha) { errEl.style.display='block'; errEl.textContent='Preencha todos os campos.'; return }
  try {
    const ok = await api.adminLogin(email, senha)
    if (ok) {
      isAdmin = true
      ultimaAtividade = Date.now()
      $('admin-email').value = ''
      $('admin-senha').value = ''
      renderAdminState()
    } else {
      errEl.style.display = 'block'
      errEl.textContent   = 'E-mail ou senha incorretos.'
      $('admin-senha').select()
    }
  } catch(err) { toast(msgErro(err),'error') }
})

$('admin-email').addEventListener('keydown', e=>{ if(e.key==='Enter') $('admin-senha').focus() })
$('admin-senha').addEventListener('keydown', e=>{ if(e.key==='Enter') $('btn-admin-login').click() })

/* Logout */
$('btn-admin-logout').addEventListener('click', ()=>{
  confirmar('Deseja sair do painel de administrador?', async ()=>{
    await sairAdmin()
    navigateTo('caixa')
    toast('Sessão de administrador encerrada.')
  }, { titulo:'Sair', botao:'Sair' })
})

/* Tabs admin */
function abrirAbaAdmin(aba) {
  document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active', b.dataset.adminTab===aba))
  document.querySelectorAll('#admin-painel .tab-pane').forEach(p=>p.classList.toggle('active', p.id===`admin-tab-${aba}`))
  if(aba==='custos')    carregarAdminCustos()
  if(aba==='estoque')   carregarAdminEstoque()
  if(aba==='lucro')     carregarAdminLucro()
  if(aba==='estornos')  carregarAdminEstornos()
  if(aba==='seguranca') carregarBackups()
}

document.querySelectorAll('[data-admin-tab]').forEach(btn=>
  btn.addEventListener('click', ()=>abrirAbaAdmin(btn.dataset.adminTab))
)

/* --- Aba: Estornos --- */
async function carregarAdminEstornos() {
  const mes = parseInt($('admin-sel-mes-estornos').value)
  const ano = parseInt($('admin-sel-ano-estornos').value)
  const dados = await api.vendasMensais(mes, ano)
  $('tbody-admin-estornos').innerHTML = !dados.vendas.length
    ? linhaVazia(6, 'cart', 'Nenhuma venda neste período')
    : dados.vendas.map(v=>`<tr class="${v.status==='cancelada'?'row-cancelada':''}">
        <td><code>#${fmtNumVenda(v.id)}</code></td>
        <td>${fmtDH(v.criado_em)}</td>
        <td>${badgePagamento(v.pagamento)}</td>
        <td>${v.num_itens} ${v.num_itens===1?'item':'itens'}</td>
        <td class="num"><strong>${fmtMoeda(v.total)}</strong></td>
        <td>${v.status==='cancelada'
          ? '<span class="badge-status cancelada">Estornada</span>'
          : `<button class="btn-estorno" data-estornar="${v.id}">${icon('undo')} Estornar</button>`}</td>
      </tr>`).join('')
}

$('admin-btn-buscar-estornos').addEventListener('click', carregarAdminEstornos)
$('tbody-admin-estornos').addEventListener('click', e=>{
  const b = e.target.closest('[data-estornar]'); if (b) estornarVenda(Number(b.dataset.estornar))
})

/* --- Aba: Preços de Custo --- */
async function carregarAdminCustos() {
  const prods = await api.listarProdutos()
  const tbody = $('tbody-admin-custos')
  if (!prods.length) { tbody.innerHTML = linhaVazia(5, 'box', 'Nenhum produto cadastrado'); return }
  tbody.innerHTML = prods.map(p=>{
    const semCusto = !p.preco_custo
    const m = semCusto ? '—' : margem(p.preco_custo, p.preco_venda)
    return `<tr class="${semCusto?'linha-sem-custo':''}">
      <td><strong>${escHtml(p.nome)}</strong> ${semCusto?'<span class="badge-sem-custo">sem custo</span>':''}</td>
      <td class="num">${fmtMoeda(p.preco_venda)}</td>
      <td class="num">${semCusto?'<span class="text-muted">—</span>':fmtMoeda(p.preco_custo)}</td>
      <td class="num">${m!=='—'?`<span class="${p.preco_venda>=p.preco_custo?'positive':'negative'}">${m}</span>`:m}</td>
      <td>
        <button class="btn btn-sm btn-outline" data-custo="${p.id}">
          ${semCusto?`${icon('plus')} Definir`:`${icon('edit')} Editar`}
        </button>
      </td>
    </tr>`
  }).join('')
}

$('tbody-admin-custos').addEventListener('click', e=>{
  const b = e.target.closest('[data-custo]'); if (!b) return
  const p = todosProdutos.find(x=>x.id===Number(b.dataset.custo)); if (p) abrirEditarCusto(p)
})

function abrirEditarCusto(p) {
  adminEditCustoId = p.id
  $('editar-custo-nome').textContent = `${p.nome} — venda a ${fmtMoeda(p.preco_venda)}`
  $('editar-custo-valor').value = p.preco_custo||''
  openModal('modal-editar-custo', 'editar-custo-valor')
}

$('btn-salvar-custo').addEventListener('click', async ()=>{
  const v = parseFloat($('editar-custo-valor').value)
  if (isNaN(v)||v<0) { toast('Valor inválido.','error'); return }
  try {
    await api.adminAtualizarCusto(adminEditCustoId, v)
    closeModal('modal-editar-custo')
    toast('Preço de custo salvo!','success')
    await carregarProdutos()
    await carregarAdminCustos()
  } catch(err) { toast(msgErro(err),'error') }
})

$('editar-custo-valor').addEventListener('keydown', e=>{
  if(e.key==='Enter') $('btn-salvar-custo').click()
})

/* --- Aba: Estoque --- */
async function carregarAdminEstoque() {
  const prods = await api.listarProdutos()
  const tbody = $('tbody-admin-estoque')
  if (!prods.length) { tbody.innerHTML = linhaVazia(4, 'box', 'Nenhum produto cadastrado'); return }
  tbody.innerHTML = prods.map(p=>`<tr>
      <td><strong>${escHtml(p.nome)}</strong></td>
      <td><code>${escHtml(p.codigo_barras)}</code></td>
      <td class="ctr">${badgeEstoque(p.estoque)}</td>
      <td>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="number" class="input-inline" id="est-input-${p.id}" value="${p.estoque}" min="0" data-estoque-input="${p.id}">
          <button class="btn btn-sm btn-primary" data-salvar-estoque="${p.id}">Salvar</button>
        </div>
      </td>
    </tr>`).join('')
}

$('tbody-admin-estoque').addEventListener('click', e=>{
  const b = e.target.closest('[data-salvar-estoque]'); if (b) salvarEstoque(Number(b.dataset.salvarEstoque))
})
$('tbody-admin-estoque').addEventListener('keydown', e=>{
  if (e.key==='Enter' && e.target.dataset.estoqueInput) salvarEstoque(Number(e.target.dataset.estoqueInput))
})

async function salvarEstoque(id) {
  const v = parseInt($(`est-input-${id}`).value)
  if (isNaN(v)||v<0) { toast('Quantidade inválida.','error'); return }
  try {
    await api.adminAtualizarEstoque(id, v)
    toast('Estoque atualizado!','success')
    await carregarProdutos()
    await carregarAdminEstoque()
  } catch(err) { toast(msgErro(err),'error') }
}

/* --- Aba: Lucro --- */
async function carregarAdminLucro() {
  const mes = parseInt($('admin-sel-mes-lucro').value)
  const ano = parseInt($('admin-sel-ano-lucro').value)
  let d
  try { d = await api.adminLucro(mes, ano) } catch(err) { toast(msgErro(err),'error'); return }
  const {receita,custo,lucro,receita_sem_custo} = d
  const pct = receita>0 ? (lucro/receita)*100 : 0

  $('admin-stats-lucro').innerHTML = `
    <div class="stat-card"><span class="stat-label">Mês</span><span class="stat-value" style="font-size:20px;">${MESES_PT[mes]} ${ano}</span></div>
    <div class="stat-card c-green"><span class="stat-label">Receita total</span><span class="stat-value green">${fmtMoeda(receita)}</span></div>
    <div class="stat-card c-red"><span class="stat-label">Custo dos produtos</span><span class="stat-value red">${fmtMoeda(custo)}</span></div>
    <div class="stat-card highlight c-purple"><span class="stat-label">Lucro bruto</span><span class="stat-value ${lucro>=0?'green':'red'}">${fmtMoeda(lucro)}</span></div>
    <div class="stat-card"><span class="stat-label">Margem</span><span class="stat-value ${pct>=0?'purple':'red'}">${fmtPct(pct)}</span>
      ${receita_sem_custo>0?`<span class="stat-sub">${fmtMoeda(receita_sem_custo)} vendidos sem custo cadastrado</span>`:''}</div>`

  const chart = $('admin-lucro-chart')
  if (receita>0) {
    chart.style.display='block'
    const pctDe = v => (Math.max(v,0)/receita)*100
    $('admin-lucro-bar').innerHTML=`
      <div class="lucro-bar-wrap">
        <div class="lucro-bar-custo" style="width:${pctDe(custo).toFixed(2)}%"></div>
        <div class="lucro-bar-lucro" style="width:${pctDe(lucro).toFixed(2)}%"></div>
        <div class="lucro-bar-semcusto" style="width:${pctDe(receita_sem_custo).toFixed(2)}%"></div>
      </div>
      <div class="lucro-legend">
        <div class="legend-item"><div class="legend-dot" style="background:#f87171;"></div><span>Custo: ${fmtMoeda(custo)} (${fmtPct(pctDe(custo))})</span></div>
        <div class="legend-item"><div class="legend-dot" style="background:#34d399;"></div><span>Lucro: ${fmtMoeda(lucro)} (${fmtPct(pctDe(lucro))})</span></div>
        ${receita_sem_custo>0?`<div class="legend-item"><div class="legend-dot" style="background:#d6d3e2;"></div><span>Sem custo cadastrado: ${fmtMoeda(receita_sem_custo)} (${fmtPct(pctDe(receita_sem_custo))})</span></div>`:''}
      </div>`
  } else { chart.style.display='none' }
}

$('admin-btn-buscar-lucro').addEventListener('click', carregarAdminLucro)

$('admin-btn-export-lucro').addEventListener('click', async () => {
  const mes = parseInt($('admin-sel-mes-lucro').value)
  const ano = parseInt($('admin-sel-ano-lucro').value)
  let d
  try { d = await api.adminLucro(mes, ano) } catch(err) { toast(msgErro(err),'error'); return }
  const { receita, custo, lucro } = d
  const pct   = receita > 0 ? (lucro / receita) * 100 : 0
  const doc   = _novoPDF()

  let y = _pdfHeader(doc, 'Relatório de Lucratividade', `Período: ${MESES_PT[mes]} de ${ano}`, true)

  y = _pdfCards(doc, y, [
    { label: 'Receita total',  value: fmtMoeda(receita), color: 'green'  },
    { label: 'Custo total',    value: fmtMoeda(custo),   color: 'red'    },
    { label: 'Lucro bruto',    value: fmtMoeda(lucro),   color: lucro >= 0 ? 'purple' : 'red' },
    { label: 'Margem de lucro',value: fmtPct(pct),        color: pct >= 0 ? 'orange' : 'red' },
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
    ['Receita (vendas com desconto aplicado):', fmtMoeda(receita)],
    ['(-) Custo dos produtos vendidos:',        fmtMoeda(custo)],
    ['(=) Lucro bruto:',                        fmtMoeda(lucro)],
    ['Margem de lucro sobre a receita:',        fmtPct(pct)],
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
    const custoW = Math.min((custo / receita) * barW, barW)
    const lucroW = Math.min((Math.max(lucro, 0) / receita) * barW, barW - custoW)

    doc.setTextColor(71, 85, 105)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.text('Composição da Receita', 14, y + 5)
    y += 9

    doc.setFillColor(226, 232, 240)
    doc.roundedRect(14, y, barW, barH, 2, 2, 'F')

    if (custoW > 0) {
      doc.setFillColor(239, 68, 68)
      doc.roundedRect(14, y, custoW, barH, 2, 2, 'F')
    }

    if (lucroW > 0) {
      doc.setFillColor(16, 185, 129)
      doc.roundedRect(14 + custoW, y, lucroW, barH, 2, 2, 'F')
    }

    y += barH + 5

    doc.setFillColor(239, 68, 68); doc.rect(14, y, 8, 4, 'F')
    doc.setTextColor(71, 85, 105); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(`Custo (${fmtPct((custo/receita)*100)})`, 24, y + 3.5)

    doc.setFillColor(16, 185, 129); doc.rect(80, y, 8, 4, 'F')
    doc.text(`Lucro (${fmtPct(pct)})`, 90, y + 3.5)

    doc.setFillColor(226, 232, 240); doc.rect(136, y, 8, 4, 'F')
    doc.text('Sem custo cadastrado', 146, y + 3.5)
  }

  _pdfFooter(doc, true)
  doc.save(`lucro-${MESES_PT[mes].toLowerCase()}-${ano}-admin.pdf`)
  toast('PDF de lucro exportado!', 'success')
})

/* --- Aba: Segurança e backup --- */
$('btn-alterar-senha').addEventListener('click', async ()=>{
  const atual = $('senha-atual').value, nova = $('senha-nova').value, nova2 = $('senha-nova2').value
  if (!atual || !nova)  { toast('Preencha a senha atual e a nova.','error'); return }
  if (nova !== nova2)   { toast('As novas senhas não conferem.','error'); return }
  if (nova.length < 6)  { toast('A nova senha deve ter pelo menos 6 caracteres.','error'); return }
  try {
    await api.adminAlterarSenha(atual, nova)
    ;['senha-atual','senha-nova','senha-nova2'].forEach(id=>$(id).value='')
    toast('Senha alterada com sucesso!','success')
  } catch(err) { toast(msgErro(err),'error') }
})

async function carregarBackups() {
  try {
    const lista = await api.adminListarBackups()
    $('lista-backups').innerHTML = !lista.length
      ? '<div class="side-vazio">Nenhum backup automático ainda</div>'
      : lista.map(b=>`<div class="backup-item"><span>${escHtml(b.nome)}</span><span>${new Date(b.data).toLocaleString('pt-BR')}</span></div>`).join('')
  } catch(err) { toast(msgErro(err),'error') }
}

$('btn-backup-agora').addEventListener('click', async ()=>{
  try {
    const caminho = await api.adminBackup()
    if (caminho) toast(`Backup salvo em ${caminho}`,'success')
  } catch(err) { toast(msgErro(err),'error') }
})

$('btn-abrir-backups').addEventListener('click', ()=>api.adminAbrirPastaBackups().catch(err=>toast(msgErro(err),'error')))

/* ============================================================
   ESTORNO DE VENDA
   ============================================================ */
async function estornarVenda(id) {
  const { venda, itens } = await api.detalhesVenda(id)
  const linhaItens = itens.map(i =>
    `• ${i.nome_produto} × ${i.quantidade} — ${fmtMoeda(i.preco_unitario * i.quantidade)}`
  ).join('\n')

  confirmar(
    `Estornar a venda nº ${fmtNumVenda(id)} (${fmtMoeda(venda.total)})?\n\nOs itens voltam para o estoque e a venda sai dos totais.\n\n${linhaItens}`,
    async () => {
      try {
        await api.adminEstornar(id)
        toast(`Venda nº ${fmtNumVenda(id)} estornada. Estoque restaurado.`, 'success')
        await carregarProdutos()
        carregarAdminEstornos()
      } catch(err) {
        toast(`Erro ao estornar: ${msgErro(err)}`, 'error')
      }
    },
    { titulo:'Estornar venda', botao:'Estornar' }
  )
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function init() {
  iniciarRelogio()
  initDateSelectors()
  renderCarrinho()
  try {
    await carregarProdutos()
    await atualizarCaixa()
  } catch(err) { toast(`Erro ao iniciar: ${msgErro(err)}`,'error') }
  navigateTo('caixa')
}

// Espera os outros scripts (caixa, clientes, trocas, mercadorias) carregarem
document.addEventListener('DOMContentLoaded', init)
