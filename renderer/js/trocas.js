'use strict'

/* ============================================================
   TROCAS E VALE-TROCA
   ============================================================ */
let trocaVenda  = null   // { venda, itens } quando a troca é de uma venda com comprovante
let trocaItens  = []     // peças devolvidas
let trocaAcerto = 'vale'
let ultimoVale  = null

async function abrirTrocas() {
  if (!caixaAberto()) toast('O caixa está fechado. Abra o caixa para registrar trocas.', 'warn')
  try {
    const clientes = await api.listarClientes()
    const sel = $('troca-cliente'), atual = sel.value
    sel.innerHTML = '<option value="">— Sem cliente —</option>' +
      clientes.map(c => `<option value="${c.id}">${escHtml(c.nome)}${c.telefone ? ` · ${escHtml(c.telefone)}` : ''}</option>`).join('')
    sel.value = atual
  } catch (e) { /* lista de clientes é opcional */ }
  renderTroca()
  carregarListasTroca()
  setTimeout(() => $('troca-scanner').focus(), 30)
}

async function carregarListasTroca() {
  const agora = new Date()
  const [vales, trocas] = await Promise.all([api.listarVales(), api.listarTrocas(agora.getMonth() + 1, agora.getFullYear())])
  $('lista-vales').innerHTML = !vales.length
    ? '<div class="side-vazio">Nenhum vale em aberto</div>'
    : vales.map(v => `<div class="lista-item">
        <strong>${escHtml(v.codigo)}</strong><strong class="num">${fmtMoeda(v.saldo)}</strong>
        <small>${v.cliente_nome ? escHtml(v.cliente_nome) + ' · ' : ''}${fmtDH(v.criado_em)}</small>
        <small class="num">${v.saldo < v.valor ? `de ${fmtMoeda(v.valor)}` : ''}</small>
        <div class="acoes-mini">
          <button class="btn btn-sm btn-secondary" data-imprimir-vale="${escHtml(v.codigo)}">${icon('printer')} Imprimir</button>
          <button class="btn btn-sm btn-outline" data-usar-vale="${escHtml(v.codigo)}">Usar no caixa</button>
        </div>
      </div>`).join('')
  $('lista-trocas').innerHTML = !trocas.length
    ? '<div class="side-vazio">Nenhuma troca este mês</div>'
    : trocas.map(t => `<div class="lista-item">
        <span>${fmtDH(t.criado_em)}</span><strong class="num">${fmtMoeda(t.valor_total)}</strong>
        <small>${t.num_itens} peça(s) · ${t.acerto === 'vale' ? `vale ${escHtml(t.vale_codigo || '')}` : `devolvido no ${t.acerto === 'pix' ? 'PIX' : 'dinheiro'}`}${t.cliente_nome ? ` · ${escHtml(t.cliente_nome)}` : ''}</small>
        <button class="link-btn" data-ver-troca="${t.id}">ver</button>
      </div>`).join('')
}

$('lista-vales').addEventListener('click', async e => {
  const imp = e.target.closest('[data-imprimir-vale]')
  const usar = e.target.closest('[data-usar-vale]')
  if (imp) imprimirVale(await api.buscarVale(imp.dataset.imprimirVale))
  if (usar) usarValeNoCaixa(usar.dataset.usarVale)
})

$('lista-trocas').addEventListener('click', async e => {
  const b = e.target.closest('[data-ver-troca]'); if (!b) return
  const { troca, itens } = await api.detalhesTroca(Number(b.dataset.verTroca))
  abrirInfo(`Troca de ${fmtDH(troca.criado_em)}`, `
    <div class="detalhes-info">
      ${troca.venda_id ? `<span class="info-pill">Venda: <strong>nº ${fmtNumVenda(troca.venda_id)}</strong></span>` : '<span class="info-pill">Sem comprovante</span>'}
      ${troca.cliente_nome ? `<span class="info-pill">Cliente: <strong>${escHtml(troca.cliente_nome)}</strong></span>` : ''}
      <span class="info-pill">Acerto: <strong>${troca.acerto === 'vale' ? `vale-troca ${escHtml(troca.vale_codigo || '')} (saldo ${fmtMoeda(troca.vale_saldo)})` : `devolvido no ${troca.acerto === 'pix' ? 'PIX' : 'dinheiro'}`}</strong></span>
      ${troca.obs ? `<span class="info-pill">Motivo: <strong>${escHtml(troca.obs)}</strong></span>` : ''}
    </div>
    <div class="card table-card">
      <table class="table"><thead><tr><th>Peça devolvida</th><th class="ctr">Qtd</th><th class="num">Valor</th></tr></thead>
      <tbody>${itens.map(i => `<tr><td>${escHtml(i.nome_produto)}</td><td class="ctr">${i.quantidade}</td><td class="num">${fmtMoeda(i.preco_unitario * i.quantidade)}</td></tr>`).join('')}</tbody></table>
      <div class="detalhes-total"><span class="grand">Total: ${fmtMoeda(troca.valor_total)}</span></div>
    </div>`)
})

/* ---------- Venda de origem ---------- */
async function buscarVendaTroca() {
  const num = parseInt($('troca-venda').value.replace(/\D/g, ''))
  if (!num) { toast('Digite o número da venda.', 'warn'); return }
  try {
    trocaVenda = await api.itensParaTroca(num)
  } catch (err) { trocaVenda = null; toast(msgErro(err), 'error'); renderTroca(); return }
  trocaItens = []
  if (trocaVenda.venda.cliente_id) $('troca-cliente').value = String(trocaVenda.venda.cliente_id)
  renderTroca()
  $('troca-scanner').focus()
}
$('btn-troca-buscar-venda').addEventListener('click', buscarVendaTroca)
$('troca-venda').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarVendaTroca() } })

function adicionarPecaTroca(ref, qtd = 1) {
  const chave = i => i.produto_id ? i.produto_id === ref.produto_id : i.nome === ref.nome
  const existente = trocaItens.find(chave)
  const novaQtd = (existente ? existente.quantidade : 0) + qtd
  if (ref.max != null && novaQtd > ref.max) {
    toast(`Só ${ref.max} unidade(s) de "${ref.nome}" podem ser devolvidas desta venda.`, 'warn'); return
  }
  if (existente) existente.quantidade = novaQtd
  else trocaItens.push({ ...ref, quantidade: qtd })
  bipe('ok')
  renderTroca()
}

/* Peça lida no leitor: se a venda foi informada, precisa ser uma peça dela */
function pecaDaVenda(produto) {
  const it = trocaVenda.itens.find(i => i.produto_id === produto.id)
  if (!it) return null
  return { produto_id: it.produto_id, nome: it.nome, preco_unitario: it.preco_unitario, preco_custo: it.preco_custo, max: it.disponivel }
}
function pecaSemVenda(produto) {
  return { produto_id: produto.id, nome: produto.nome, preco_unitario: produto.preco_venda, preco_custo: produto.preco_custo, max: null }
}

function escolherPecaTroca(produto) {
  if (trocaVenda) {
    const ref = pecaDaVenda(produto)
    if (!ref) { bipe('erro'); toast(`"${produto.nome}" não faz parte da venda nº ${fmtNumVenda(trocaVenda.venda.id)}.`, 'error'); return }
    adicionarPecaTroca(ref)
  } else adicionarPecaTroca(pecaSemVenda(produto))
}

$('troca-scanner').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const codigo = e.target.value.trim(); e.target.value = ''
  if (!codigo) return
  const produto = todosProdutos.find(p => p.codigo_barras === codigo) || await api.buscarPorCodigo(codigo)
  if (!produto) { bipe('erro'); toast(`Produto não encontrado: ${codigo}`, 'error'); return }
  escolherPecaTroca(produto)
})
$('btn-troca-buscar-nome').addEventListener('click', () => abrirBusca(produto => { escolherPecaTroca(produto); $('troca-scanner').focus() }))

function renderTroca() {
  const info = $('troca-venda-info')
  if (trocaVenda) {
    const v = trocaVenda.venda
    info.style.display = 'block'
    info.innerHTML = `Venda <strong>nº ${fmtNumVenda(v.id)}</strong> de ${fmtDH(v.criado_em)} — ${fmtMoeda(v.total)}${v.cliente_nome ? ` · ${escHtml(v.cliente_nome)}` : ''}
      <button class="link-btn" id="btn-troca-sem-venda" style="float:right;">trocar sem esta venda</button>
      <div class="itens-venda">${trocaVenda.itens.map((i, idx) => i.disponivel > 0
        ? `<button class="btn btn-sm btn-secondary" data-peca-venda="${idx}">${icon('plus')} ${escHtml(i.nome)} · ${fmtMoeda(i.preco_unitario)} <small>(${i.disponivel})</small></button>`
        : `<span class="badge-status cancelada">${escHtml(i.nome)} já devolvida</span>`).join('')}</div>`
  } else info.style.display = 'none'

  $('tbody-troca-itens').innerHTML = !trocaItens.length
    ? linhaVazia(4, 'swap', 'Nenhuma peça devolvida', 'Leia o código da peça ou informe o número da venda')
    : trocaItens.map((i, idx) => `<tr>
        <td><strong>${escHtml(i.nome)}</strong><div class="item-cod">${fmtMoeda(i.preco_unitario)} cada${trocaVenda ? ' (preço pago)' : ' (preço atual)'}</div></td>
        <td><div class="qty-control">
          <button class="btn-xs" data-troca-qtd="${idx}" data-delta="-1">${icon('minus')}</button>
          <span class="qty-num">${i.quantidade}</span>
          <button class="btn-xs" data-troca-qtd="${idx}" data-delta="1">${icon('plus')}</button>
        </div></td>
        <td class="num"><strong>${fmtMoeda(i.preco_unitario * i.quantidade)}</strong></td>
        <td><button class="btn-xs danger" data-troca-remover="${idx}">${icon('x')}</button></td>
      </tr>`).join('')
  $('troca-total').textContent = `Total devolvido: ${fmtMoeda(totalTroca())}`
}

function totalTroca() { return round2(trocaItens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0)) }

$('troca-venda-info').addEventListener('click', e => {
  if (e.target.closest('#btn-troca-sem-venda')) { trocaVenda = null; trocaItens = []; $('troca-venda').value = ''; renderTroca(); return }
  const b = e.target.closest('[data-peca-venda]'); if (!b) return
  const it = trocaVenda.itens[Number(b.dataset.pecaVenda)]
  adicionarPecaTroca({ produto_id: it.produto_id, nome: it.nome, preco_unitario: it.preco_unitario, preco_custo: it.preco_custo, max: it.disponivel })
})

$('tbody-troca-itens').addEventListener('click', e => {
  const q = e.target.closest('[data-troca-qtd]'), r = e.target.closest('[data-troca-remover]')
  if (q) {
    const item = trocaItens[Number(q.dataset.trocaQtd)]
    const nova = item.quantidade + Number(q.dataset.delta)
    if (item.max != null && nova > item.max) { toast(`Só ${item.max} unidade(s) desta venda.`, 'warn'); return }
    if (nova <= 0) trocaItens.splice(Number(q.dataset.trocaQtd), 1); else item.quantidade = nova
    renderTroca()
  }
  if (r) { trocaItens.splice(Number(r.dataset.trocaRemover), 1); renderTroca() }
})

document.querySelectorAll('#troca-acerto .acerto-btn').forEach(b => b.addEventListener('click', () => {
  trocaAcerto = b.dataset.acerto
  document.querySelectorAll('#troca-acerto .acerto-btn').forEach(x => x.classList.toggle('selecionado', x === b))
}))
$('troca-motivos').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (chip) $('troca-obs').value = chip.textContent
})

function limparTroca() {
  trocaVenda = null; trocaItens = []
  $('troca-venda').value = ''; $('troca-obs').value = ''; $('troca-cliente').value = ''
  renderTroca()
}
$('btn-troca-limpar').addEventListener('click', limparTroca)

$('btn-troca-confirmar').addEventListener('click', () => {
  if (!trocaItens.length) { toast('Adicione as peças devolvidas.', 'warn'); return }
  if (!caixaAberto()) { toast('Abra o caixa antes de registrar a troca.', 'warn'); return }
  const total = totalTroca()
  const acao = trocaAcerto === 'vale' ? `Gerar vale-troca de ${fmtMoeda(total)}`
    : trocaAcerto === 'dinheiro' ? `Devolver ${fmtMoeda(total)} em dinheiro (sai da gaveta)`
    : `Devolver ${fmtMoeda(total)} por PIX (faça o PIX pelo banco)`
  const pecas = trocaItens.map(i => `• ${i.nome} × ${i.quantidade}`).join('\n')
  confirmar(`${acao}?\n\nAs peças voltam para o estoque:\n${pecas}`, async () => {
    try {
      const r = await api.registrarTroca({
        venda_id: trocaVenda ? trocaVenda.venda.id : null,
        cliente_id: $('troca-cliente').value ? Number($('troca-cliente').value) : null,
        itens: trocaItens.map(i => ({ produto_id: i.produto_id, nome: i.nome, quantidade: i.quantidade, preco_unitario: i.preco_unitario, preco_custo: i.preco_custo })),
        acerto: trocaAcerto,
        obs: $('troca-obs').value
      })
      const pecasTexto = trocaItens.map(i => ({ ...i }))
      limparTroca()
      await carregarProdutos()
      carregarListasTroca()
      if (r.vale) mostrarValeGerado(r.vale)
      else {
        toast(`Troca registrada. Devolva ${fmtMoeda(r.troca.valor_total)} ao cliente.`, 'success')
        imprimirDevolucao(r.troca, pecasTexto)
      }
      if (r.troca.acerto === 'dinheiro') atualizarCaixa()
    } catch (err) { toast(msgErro(err), 'error') }
  }, { titulo: 'Confirmar troca', botao: 'Confirmar' })
})

/* ---------- Vale-troca ---------- */
function mostrarValeGerado(vale) {
  ultimoVale = vale
  $('vale-gerado-cliente').textContent = vale.cliente_nome ? `Para ${vale.cliente_nome}` : ''
  $('vale-gerado-valor').textContent = fmtMoeda(vale.valor)
  renderBarcode('#vale-gerado-barcode', vale.codigo, { height: 54, fontSize: 14 })
  openModal('modal-vale', 'btn-vale-imprimir')
}
$('btn-vale-imprimir').addEventListener('click', () => imprimirVale(ultimoVale))
$('btn-vale-usar').addEventListener('click', () => { closeModal('modal-vale'); usarValeNoCaixa(ultimoVale.codigo) })

function usarValeNoCaixa(codigo) {
  valePendente = codigo
  renderValeBanner()
  navigateTo('caixa')
  toast('Lance as peças novas. No pagamento o vale já vem escolhido.', 'success')
}

function imprimirVale(vale) {
  if (!vale) return
  const img = barcodePNG(vale.codigo)
  cupomTermico(c => {
    c.cabecalho('VALE-TROCA')
    c.espaco(2); c.solida()
    c.centro(`Valor: ${fmtMoeda(vale.saldo)}`, { tam: 14, estilo: 'bold', passo: 7 })
    if (vale.saldo < vale.valor) c.centro(`(valor original ${fmtMoeda(vale.valor)})`, { tam: 7 })
    c.imagem(img, 60, 22)
    if (vale.cliente_nome) c.linha('Cliente:', vale.cliente_nome)
    c.linha('Emitido em:', fmtDH(vale.criado_em))
    c.tracejada()
    c.texto('Apresente este vale no caixa para usar o valor em uma nova compra. Pode ser usado em mais de uma vez até acabar o saldo.')
    c.espaco(2)
    c.centro('Cantinho do Bebe agradece!', { estilo: 'italic' })
  })
}

function imprimirDevolucao(troca, pecas) {
  cupomTermico(c => {
    c.cabecalho('Comprovante de Devolução')
    c.espaco(2); c.solida()
    c.linha('Data/Hora:', fmtDH(troca.criado_em))
    if (troca.venda_id) c.linha('Venda de origem:', `No ${fmtNumVenda(troca.venda_id)}`)
    c.tracejada()
    pecas.forEach(p => c.item(p.nome, p.quantidade, fmtMoeda(p.preco_unitario * p.quantidade)))
    c.tracejada()
    c.linha(`DEVOLVIDO (${troca.acerto === 'pix' ? 'PIX' : 'DINHEIRO'}):`, fmtMoeda(troca.valor_total), { tam: 10, negrito: true, passo: 6 })
    c.assinatura('Assinatura do cliente')
  })
}
