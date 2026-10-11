'use strict'

/* ============================================================
   MERCADORIAS — entrada de mercadoria e fornecedores (admin)
   ============================================================ */
let entradaItens   = []   // [{ produto, quantidade, custo }]
let fornecedores   = []
let fornecedorEditId = null
let aoSalvarFornecedor = null

async function abrirMercadorias() {
  $('mercadorias-bloqueio').style.display = isAdmin ? 'none' : 'flex'
  $('mercadorias-painel').style.display   = isAdmin ? 'block' : 'none'
  if (!isAdmin) return
  await carregarFornecedores()
  renderEntrada()
  setTimeout(() => $('entrada-scanner').focus(), 30)
}
$('btn-mercadorias-login').addEventListener('click', () => navigateTo('admin'))

document.querySelectorAll('[data-merc-tab]').forEach(btn => btn.addEventListener('click', () => {
  const aba = btn.dataset.mercTab
  document.querySelectorAll('[data-merc-tab]').forEach(b => b.classList.toggle('active', b === btn))
  document.querySelectorAll('#mercadorias-painel .tab-pane').forEach(p => p.classList.toggle('active', p.id === `merc-tab-${aba}`))
  if (aba === 'historico')    carregarEntradas()
  if (aba === 'fornecedores') renderFornecedores()
  if (aba === 'entrada')      $('entrada-scanner').focus()
}))

/* ---------- Fornecedores ---------- */
async function carregarFornecedores() {
  try { fornecedores = await api.listarFornecedores() } catch (err) { toast(msgErro(err), 'error'); return }
  const sel = $('entrada-fornecedor'), atual = sel.value
  sel.innerHTML = '<option value="">— Sem fornecedor —</option>' +
    fornecedores.map(f => `<option value="${f.id}">${escHtml(f.nome)}</option>`).join('')
  sel.value = atual
  renderFornecedores()
}

function renderFornecedores() {
  $('tbody-fornecedores').innerHTML = !fornecedores.length
    ? linhaVazia(6, 'truck', 'Nenhum fornecedor cadastrado')
    : fornecedores.map(f => `<tr>
        <td><strong>${escHtml(f.nome)}</strong>${f.obs ? `<div class="item-cod">${escHtml(f.obs)}</div>` : ''}</td>
        <td>${escHtml(f.telefone || '—')}</td>
        <td>${escHtml(f.cnpj || '—')}</td>
        <td class="ctr">${f.num_entradas}</td>
        <td class="num">${fmtMoeda(f.total_comprado)}</td>
        <td style="text-align:right;">
          <button class="btn btn-sm btn-secondary" data-editar-forn="${f.id}">${icon('edit')} Editar</button>
          <button class="btn btn-sm btn-danger-outline btn-icon" data-excluir-forn="${f.id}" title="Excluir">${icon('trash')}</button>
        </td>
      </tr>`).join('')
}

function abrirFornecedor(f = null, callback = null) {
  fornecedorEditId = f ? f.id : null
  aoSalvarFornecedor = callback
  $('fornecedor-titulo').textContent = f ? 'Editar fornecedor' : 'Novo fornecedor'
  $('fornecedor-nome').value     = f ? f.nome : ''
  $('fornecedor-telefone').value = f ? f.telefone || '' : ''
  $('fornecedor-cnpj').value     = f ? f.cnpj || '' : ''
  $('fornecedor-obs').value      = f ? f.obs || '' : ''
  openModal('modal-fornecedor', 'fornecedor-nome')
}
$('btn-novo-fornecedor').addEventListener('click', () => abrirFornecedor())
$('btn-entrada-novo-fornecedor').addEventListener('click', () => abrirFornecedor(null, f => { $('entrada-fornecedor').value = String(f.id) }))

async function salvarFornecedor() {
  try {
    const f = await api.salvarFornecedor({
      id: fornecedorEditId, nome: $('fornecedor-nome').value, telefone: $('fornecedor-telefone').value,
      cnpj: $('fornecedor-cnpj').value, obs: $('fornecedor-obs').value
    })
    closeModal('modal-fornecedor')
    toast('Fornecedor salvo!', 'success')
    await carregarFornecedores()
    if (aoSalvarFornecedor) { const cb = aoSalvarFornecedor; aoSalvarFornecedor = null; cb(f) }
  } catch (err) { toast(msgErro(err), 'error') }
}
$('btn-salvar-fornecedor').addEventListener('click', salvarFornecedor)
document.querySelectorAll('#modal-fornecedor input').forEach(i =>
  i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvarFornecedor() } })
)

$('tbody-fornecedores').addEventListener('click', e => {
  const ed = e.target.closest('[data-editar-forn]'), ex = e.target.closest('[data-excluir-forn]')
  if (ed) abrirFornecedor(fornecedores.find(f => f.id === Number(ed.dataset.editarForn)))
  if (ex) {
    const f = fornecedores.find(x => x.id === Number(ex.dataset.excluirForn))
    confirmar(`Excluir o fornecedor "${f.nome}"?`, async () => {
      try { await api.excluirFornecedor(f.id); toast('Fornecedor excluído.', 'success'); await carregarFornecedores() }
      catch (err) { toast(msgErro(err), 'error') }
    }, { titulo: 'Excluir fornecedor', botao: 'Excluir' })
  }
})

/* ---------- Nova entrada ---------- */
function adicionarNaEntrada(produto, qtd = 1) {
  const existente = entradaItens.find(i => i.produto.id === produto.id)
  if (existente) existente.quantidade += qtd
  else entradaItens.push({ produto, quantidade: qtd, custo: produto.preco_custo || '' })
  bipe('ok')
  renderEntrada()
  // Leva o foco para o custo quando ainda não há custo cadastrado
  const idx = entradaItens.findIndex(i => i.produto.id === produto.id)
  const custo = document.querySelector(`[data-entrada-custo="${idx}"]`)
  if (custo && !entradaItens[idx].custo) custo.focus()
  else $('entrada-scanner').focus()
}

$('entrada-scanner').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const { qtd, codigo } = lerEntradaScanner(e.target.value.trim()); e.target.value = ''
  if (!codigo) return
  const produto = todosProdutos.find(p => p.codigo_barras === codigo) || await api.buscarPorCodigo(codigo)
  if (produto) { adicionarNaEntrada(produto, qtd); return }
  bipe('erro')
  confirmar(`O código ${codigo} não está cadastrado.\nQuer cadastrar o produto agora?`, () => {
    novoProduto(codigo, prod => adicionarNaEntrada(prod, qtd))
    // O estoque entra pela nota, não pelo cadastro
    $('produto-estoque').value = 0
    $('grupo-estoque').style.display = 'none'
  }, { titulo: 'Produto novo', botao: 'Cadastrar' })
})
$('btn-entrada-buscar').addEventListener('click', () => abrirBusca(p => adicionarNaEntrada(p)))

function linhaEntradaCalc(item) {
  const custo = parseFloat(item.custo) || 0
  const venda = item.produto.preco_venda
  return { subtotal: round2(custo * item.quantidade), margem: custo > 0 ? margem(custo, venda) : '—', positiva: venda >= custo }
}

function renderEntrada() {
  $('tbody-entrada').innerHTML = !entradaItens.length
    ? linhaVazia(8, 'truck', 'Nenhum produto nesta entrada', 'Leia o código de barras das peças que chegaram')
    : entradaItens.map((i, idx) => {
        const c = linhaEntradaCalc(i)
        return `<tr>
          <td><strong>${escHtml(i.produto.nome)}</strong><div class="item-cod">${escHtml(i.produto.codigo_barras)}</div></td>
          <td class="ctr">${badgeEstoque(i.produto.estoque)}</td>
          <td><input type="number" class="input-inline" min="1" value="${i.quantidade}" data-entrada-qtd="${idx}"></td>
          <td><input type="number" class="input-inline" min="0" step="0.01" value="${i.custo}" placeholder="0,00" data-entrada-custo="${idx}" style="width:110px;"></td>
          <td class="num">${fmtMoeda(i.produto.preco_venda)}</td>
          <td class="num" data-entrada-margem="${idx}">${c.margem !== '—' ? `<span class="${c.positiva ? 'positive' : 'negative'}">${c.margem}</span>` : '—'}</td>
          <td class="num"><strong data-entrada-sub="${idx}">${fmtMoeda(c.subtotal)}</strong></td>
          <td><button class="btn-xs danger" data-entrada-remover="${idx}">${icon('x')}</button></td>
        </tr>`
      }).join('')
  atualizarTotalEntrada()
}

function atualizarTotalEntrada() {
  const total = entradaItens.reduce((s, i) => s + linhaEntradaCalc(i).subtotal, 0)
  const pecas = entradaItens.reduce((s, i) => s + (parseInt(i.quantidade) || 0), 0)
  $('entrada-total').textContent = `${pecas} peça(s) · Total da nota: ${fmtMoeda(total)}`
}

// Atualiza a linha sem redesenhar a tabela (mantém o cursor no campo)
$('tbody-entrada').addEventListener('input', e => {
  const q = e.target.dataset.entradaQtd, c = e.target.dataset.entradaCusto
  const idx = Number(q ?? c); if (isNaN(idx)) return
  if (q != null) entradaItens[idx].quantidade = parseInt(e.target.value) || 0
  if (c != null) entradaItens[idx].custo = e.target.value
  const calc = linhaEntradaCalc(entradaItens[idx])
  document.querySelector(`[data-entrada-sub="${idx}"]`).textContent = fmtMoeda(calc.subtotal)
  document.querySelector(`[data-entrada-margem="${idx}"]`).innerHTML =
    calc.margem !== '—' ? `<span class="${calc.positiva ? 'positive' : 'negative'}">${calc.margem}</span>` : '—'
  atualizarTotalEntrada()
})
$('tbody-entrada').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); $('entrada-scanner').focus() }
})
$('tbody-entrada').addEventListener('click', e => {
  const b = e.target.closest('[data-entrada-remover]'); if (!b) return
  entradaItens.splice(Number(b.dataset.entradaRemover), 1)
  renderEntrada()
})

function limparEntrada() {
  entradaItens = []
  $('entrada-documento').value = ''; $('entrada-obs').value = ''
  renderEntrada()
}
$('btn-entrada-limpar').addEventListener('click', limparEntrada)

$('btn-entrada-salvar').addEventListener('click', async () => {
  if (!entradaItens.length) { toast('Adicione os produtos que chegaram.', 'warn'); return }
  if (entradaItens.some(i => !(parseInt(i.quantidade) > 0))) { toast('Confira as quantidades.', 'error'); return }
  const semCusto = entradaItens.filter(i => !(parseFloat(i.custo) > 0)).length
  const salvar = async () => {
    try {
      const r = await api.registrarEntrada({
        fornecedor_id: $('entrada-fornecedor').value ? Number($('entrada-fornecedor').value) : null,
        documento: $('entrada-documento').value,
        obs: $('entrada-obs').value,
        itens: entradaItens.map(i => ({ produto_id: i.produto.id, quantidade: parseInt(i.quantidade), custo_unitario: parseFloat(i.custo) || 0 }))
      })
      const pecas = r.itens.reduce((s, i) => s + i.quantidade, 0)
      toast(`Entrada registrada: ${pecas} peça(s) somadas ao estoque.`, 'success')
      const paraEtiquetas = $('entrada-etiquetas').checked ? entradaItens.map(i => ({ id: i.produto.id, quantidade: parseInt(i.quantidade) })) : []
      limparEntrada()
      await carregarProdutos()
      await carregarFornecedores()
      if (paraEtiquetas.length) {
        etiquetasSel = paraEtiquetas.map(e => ({ produto: todosProdutos.find(p => p.id === e.id), quantidade: e.quantidade })).filter(e => e.produto)
        navigateTo('etiquetas')
        renderEtiquetasLista()
        toast('Etiquetas prontas para imprimir.', 'success')
      }
    } catch (err) { toast(msgErro(err), 'error') }
  }
  if (semCusto) confirmar(`${semCusto} produto(s) estão sem custo. O custo deles não será alterado.\nContinuar?`, salvar, { titulo: 'Produtos sem custo', botao: 'Continuar' })
  else salvar()
})

/* ---------- Histórico ---------- */
async function carregarEntradas() {
  let lista
  try { lista = await api.listarEntradas(parseInt($('merc-sel-mes').value), parseInt($('merc-sel-ano').value)) }
  catch (err) { toast(msgErro(err), 'error'); return }
  $('tbody-entradas').innerHTML = !lista.length
    ? linhaVazia(6, 'truck', 'Nenhuma entrada neste período')
    : lista.map(e => `<tr>
        <td>${fmtDH(e.criado_em)}</td>
        <td>${escHtml(e.fornecedor_nome || '—')}</td>
        <td>${escHtml(e.documento || '—')}</td>
        <td class="ctr">${e.num_pecas}</td>
        <td class="num"><strong>${fmtMoeda(e.total)}</strong></td>
        <td style="text-align:right;"><button class="btn btn-sm btn-outline" data-ver-entrada="${e.id}">${icon('eye')} Ver</button></td>
      </tr>`).join('')
}
$('btn-merc-buscar').addEventListener('click', carregarEntradas)

$('tbody-entradas').addEventListener('click', async e => {
  const b = e.target.closest('[data-ver-entrada]'); if (!b) return
  const { entrada, itens } = await api.detalhesEntrada(Number(b.dataset.verEntrada))
  abrirInfo(`Entrada de ${fmtDH(entrada.criado_em)}`, `
    <div class="detalhes-info">
      <span class="info-pill">Fornecedor: <strong>${escHtml(entrada.fornecedor_nome || '—')}</strong></span>
      ${entrada.documento ? `<span class="info-pill">Nota: <strong>${escHtml(entrada.documento)}</strong></span>` : ''}
      ${entrada.obs ? `<span class="info-pill">${escHtml(entrada.obs)}</span>` : ''}
    </div>
    <div class="card table-card">
      <table class="table"><thead><tr><th>Produto</th><th class="ctr">Qtd</th><th class="num">Custo unit.</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${itens.map(i => `<tr><td>${escHtml(i.nome_produto)}</td><td class="ctr">${i.quantidade}</td><td class="num">${fmtMoeda(i.custo_unitario)}</td><td class="num">${fmtMoeda(i.custo_unitario * i.quantidade)}</td></tr>`).join('')}</tbody></table>
      <div class="detalhes-total"><span class="grand">Total: ${fmtMoeda(entrada.total)}</span></div>
    </div>`)
})
