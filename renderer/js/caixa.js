'use strict'

/* ============================================================
   CAIXA — abertura, sangria, suprimento e fechamento do dia
   ============================================================ */
let caixaInfo = { caixa: null, resumo: null, ultimoFechado: null }

function caixaAberto() { return !!caixaInfo.caixa }

async function atualizarCaixa() {
  caixaInfo = await api.caixaAtual()
  renderCaixaSessao()
}

function renderCaixaSessao() {
  const aberto = caixaAberto()
  $('caixa-fechado').style.display  = aberto ? 'none' : 'grid'
  $('pdv-body').style.display       = aberto ? '' : 'none'
  $('pdv-shortcuts').style.display  = aberto ? '' : 'none'
  $('caixa-acoes').style.display    = aberto ? '' : 'none'

  const sessao = $('caixa-sessao')
  if (!aberto) {
    sessao.className = 'caixa-sessao'
    sessao.innerHTML = `${icon('lock')} Caixa fechado`
    const ult = caixaInfo.ultimoFechado
    $('abertura-sugestao').innerHTML = ult && ult.valor_contado != null
      ? `No último fechamento (${fmtDH(ult.fechado_em)}) ficaram <strong>${fmtMoeda(ult.valor_contado)}</strong> na gaveta.
         <button class="link-btn" id="btn-usar-ultimo">usar esse valor</button>`
      : ''
  } else {
    const c = caixaInfo.caixa
    const dia = c.aberto_em.slice(0, 10)
    const atrasado = dia !== hojeISO()
    sessao.className = `caixa-sessao${atrasado ? ' atrasado' : ''}`
    sessao.innerHTML = atrasado
      ? `${icon('alert')} Caixa aberto desde ${fmtDH(c.aberto_em)} — feche o caixa do dia anterior`
      : `${icon('unlock')} Caixa aberto às ${fmtHora(c.aberto_em)}`
  }
  renderCarrinho()
}

$('abertura-sugestao').addEventListener('click', e => {
  if (!e.target.closest('#btn-usar-ultimo')) return
  $('abertura-valor').value = caixaInfo.ultimoFechado.valor_contado.toFixed(2)
  $('abertura-valor').focus()
})

async function abrirCaixa() {
  const txt = $('abertura-valor').value
  const valor = txt === '' ? 0 : parseFloat(txt)
  if (isNaN(valor) || valor < 0) { toast('Valor inválido.', 'error'); return }
  try {
    await api.abrirCaixa(valor)
    $('abertura-valor').value = ''
    await atualizarCaixa()
    toast(`Caixa aberto com ${fmtMoeda(valor)}. Boas vendas!`, 'success')
    focarScanner()
  } catch (err) { toast(msgErro(err), 'error') }
}
$('btn-abrir-caixa').addEventListener('click', abrirCaixa)
$('abertura-valor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); abrirCaixa() } })

/* ---------- Sangria e suprimento ---------- */
const MOTIVOS = {
  sangria:    ['Depósito no banco', 'Pagamento de fornecedor', 'Despesa da loja', 'Retirada da dona'],
  suprimento: ['Troco', 'Reforço de caixa']
}
let movimentoTipo = 'sangria'

async function abrirMovimento(tipo) {
  movimentoTipo = tipo
  const resumo = await api.resumoCaixa(caixaInfo.caixa.id)
  $('movimento-titulo').textContent = tipo === 'sangria' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar dinheiro)'
  $('movimento-dica').innerHTML = tipo === 'sangria'
    ? `Dinheiro que deve estar na gaveta agora: <strong>${fmtMoeda(resumo.esperado)}</strong>`
    : 'Use quando colocar dinheiro na gaveta, por exemplo para ter troco.'
  $('movimento-valor').value = ''
  $('movimento-motivo').value = ''
  $('movimento-imprimir').checked = tipo === 'sangria'
  $('movimento-motivos').innerHTML = MOTIVOS[tipo].map(m => `<button class="chip" type="button">${m}</button>`).join('')
  openModal('modal-movimento', 'movimento-valor')
}
$('btn-sangria').addEventListener('click', () => abrirMovimento('sangria'))
$('btn-suprimento').addEventListener('click', () => abrirMovimento('suprimento'))

$('movimento-motivos').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if (!chip) return
  $('movimento-motivo').value = chip.textContent
  $('movimento-valor').focus()
})

async function salvarMovimento() {
  const valor = parseFloat($('movimento-valor').value)
  const motivo = $('movimento-motivo').value.trim()
  if (!(valor > 0)) { toast('Informe o valor.', 'error'); return }
  try {
    const mov = await api.movimentarCaixa(movimentoTipo, valor, motivo)
    closeModal('modal-movimento')
    toast(movimentoTipo === 'sangria' ? `Sangria de ${fmtMoeda(valor)} registrada.` : `Suprimento de ${fmtMoeda(valor)} registrado.`, 'success')
    if ($('movimento-imprimir').checked) imprimirMovimento(mov)
    await atualizarCaixa()
  } catch (err) { toast(msgErro(err), 'error') }
}
$('btn-salvar-movimento').addEventListener('click', salvarMovimento)
;['movimento-valor', 'movimento-motivo'].forEach(id =>
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvarMovimento() } })
)

function imprimirMovimento(mov) {
  cupomTermico(c => {
    c.cabecalho(mov.tipo === 'sangria' ? 'Comprovante de Sangria' : 'Comprovante de Suprimento')
    c.espaco(2); c.solida()
    c.linha('Data/Hora:', fmtDH(mov.criado_em))
    c.linha('Valor:', fmtMoeda(mov.valor), { tam:11, negrito:true, passo:6 })
    if (mov.motivo) c.texto(`Motivo: ${mov.motivo}`, { tam:8 })
    c.assinatura('Responsável')
  })
}

/* ---------- Resumo (usado no fechamento e no histórico) ---------- */
function linhasResumoCaixa(res) {
  const d = res.dinheiro
  const linha = (rotulo, valor, cls='') => `<div class="conta-linha ${cls}"><span>${rotulo}</span><strong>${fmtMoeda(valor)}</strong></div>`
  const dinheiro = [
    linha('Troco inicial (abertura)', d.abertura),
    linha('+ Vendas em dinheiro', d.vendas),
    d.recebimentos ? linha('+ Fiado recebido em dinheiro', d.recebimentos) : '',
    d.suprimentos  ? linha('+ Suprimentos', d.suprimentos) : '',
    d.sangrias     ? linha('− Sangrias', d.sangrias, 'menos') : '',
    d.devolucoes   ? linha('− Trocas devolvidas em dinheiro', d.devolucoes, 'menos') : '',
    d.estornos     ? linha('− Estornos em dinheiro', d.estornos, 'menos') : '',
    linha('= Deve ter na gaveta', res.esperado, 'total')
  ].join('')

  const venda = f => (res.porForma.find(p => p.forma === f) || {}).total || 0
  const receb = f => (res.recebimentos.find(p => p.forma === f) || {}).total || 0
  const outros = [
    ...['pix', 'debito', 'credito'].map(f => {
      const r = receb(f)
      return `<div class="conta-linha"><span>${PAGAMENTO_LABEL[f]}${r ? ` <small>(inclui ${fmtMoeda(r)} de fiado recebido)</small>` : ''}</span><strong>${fmtMoeda(venda(f) + r)}</strong></div>`
    }),
    venda('fiado') ? linha('Vendido no fiado (a receber)', venda('fiado')) : '',
    venda('vale')  ? linha('Pago com vale-troca', venda('vale')) : '',
    linha(`Total vendido (${res.vendas.num_vendas} venda${res.vendas.num_vendas !== 1 ? 's' : ''})`, res.vendas.total_vendas, 'total')
  ].join('')
  return { dinheiro, outros }
}

/* ---------- Fechamento ---------- */
let resumoFechamento = null

async function abrirFechamento() {
  if (carrinho.length) { toast('Finalize ou cancele a venda em andamento antes de fechar o caixa.', 'warn'); return }
  resumoFechamento = await api.resumoCaixa(caixaInfo.caixa.id)
  const { dinheiro, outros } = linhasResumoCaixa(resumoFechamento)
  $('fechamento-dinheiro').innerHTML = dinheiro
  $('fechamento-outros').innerHTML = outros
  $('fechamento-contado').value = ''
  $('fechamento-obs').value = ''
  atualizarDiferenca()
  openModal('modal-fechar-caixa', 'fechamento-contado')
}
$('btn-fechar-caixa').addEventListener('click', abrirFechamento)

function textoDiferenca(dif) {
  if (Math.abs(dif) < 0.005) return { rotulo: 'Caixa certo', cls: '' }
  return dif > 0 ? { rotulo: 'Sobrando', cls: '' } : { rotulo: 'Faltando', cls: 'falta' }
}

function atualizarDiferenca() {
  const row = $('fechamento-diferenca')
  const txt = $('fechamento-contado').value
  if (txt === '') {
    row.className = 'troco-row neutro'
    row.innerHTML = `<span>Diferença</span><strong>—</strong>`
    return
  }
  const dif = round2(parseFloat(txt) - resumoFechamento.esperado)
  const t = textoDiferenca(dif)
  row.className = `troco-row ${t.cls}`
  row.innerHTML = `<span>${t.rotulo}</span><strong>${fmtMoeda(Math.abs(dif))}</strong>`
}
$('fechamento-contado').addEventListener('input', atualizarDiferenca)

$('btn-confirmar-fechamento').addEventListener('click', async () => {
  const txt = $('fechamento-contado').value
  if (txt === '' || isNaN(parseFloat(txt))) { toast('Conte o dinheiro da gaveta e informe o valor.', 'error'); return }
  try {
    const res = await api.fecharCaixa(parseFloat(txt), $('fechamento-obs').value)
    closeModal('modal-fechar-caixa')
    imprimirFechamento(res)
    await atualizarCaixa()
    const t = textoDiferenca(res.caixa.diferenca)
    toast(`Caixa fechado. ${t.rotulo}${Math.abs(res.caixa.diferenca) >= 0.005 ? `: ${fmtMoeda(Math.abs(res.caixa.diferenca))}` : ''}.`, 'success')
  } catch (err) { toast(msgErro(err), 'error') }
})

function imprimirFechamento(res) {
  const d = res.dinheiro, cx = res.caixa
  const venda = f => (res.porForma.find(p => p.forma === f) || {}).total || 0
  const receb = f => (res.recebimentos.find(p => p.forma === f) || {}).total || 0
  cupomTermico(c => {
    c.cabecalho('Fechamento de Caixa')
    c.espaco(2); c.solida()
    c.linha('Abertura:', fmtDH(cx.aberto_em))
    c.linha('Fechamento:', cx.fechado_em ? fmtDH(cx.fechado_em) : 'em aberto')
    c.solida()
    c.centro('DINHEIRO', { estilo:'bold', passo:5 })
    c.linha('Troco inicial:', fmtMoeda(d.abertura))
    c.linha('+ Vendas em dinheiro:', fmtMoeda(d.vendas))
    if (d.recebimentos) c.linha('+ Fiado recebido:', fmtMoeda(d.recebimentos))
    if (d.suprimentos)  c.linha('+ Suprimentos:', fmtMoeda(d.suprimentos))
    if (d.sangrias)     c.linha('- Sangrias:', fmtMoeda(d.sangrias))
    if (d.devolucoes)   c.linha('- Trocas em dinheiro:', fmtMoeda(d.devolucoes))
    if (d.estornos)     c.linha('- Estornos:', fmtMoeda(d.estornos))
    c.tracejada()
    c.linha('Esperado na gaveta:', fmtMoeda(res.esperado), { negrito:true })
    if (cx.valor_contado != null) {
      c.linha('Contado:', fmtMoeda(cx.valor_contado), { negrito:true })
      const t = textoDiferenca(cx.diferenca)
      c.linha(`${t.rotulo}:`, fmtMoeda(Math.abs(cx.diferenca)), { negrito:true })
    }
    c.solida()
    c.centro('CONFERIR COM A MAQUININHA', { estilo:'bold', passo:5 })
    ;['pix', 'debito', 'credito'].forEach(f => c.linha(`${PAGAMENTO_PDF[f]}:`, fmtMoeda(venda(f) + receb(f))))
    if (venda('fiado')) c.linha('Vendido no fiado:', fmtMoeda(venda('fiado')))
    if (venda('vale'))  c.linha('Pago com vale-troca:', fmtMoeda(venda('vale')))
    c.tracejada()
    c.linha(`Vendas (${res.vendas.num_vendas}):`, fmtMoeda(res.vendas.total_vendas), { negrito:true })
    if (res.vendas.total_descontos) c.linha('Descontos dados:', fmtMoeda(res.vendas.total_descontos))
    const sangrias = res.movimentos.filter(m => m.tipo === 'sangria')
    if (sangrias.length) {
      c.solida(); c.centro('SANGRIAS', { estilo:'bold', passo:5 })
      sangrias.forEach(m => c.linha(`${fmtHora(m.criado_em)} ${m.motivo || ''}`.slice(0, 30), fmtMoeda(m.valor)))
    }
    if (cx.obs_fechamento) { c.tracejada(); c.texto(`Obs.: ${cx.obs_fechamento}`, { tam:8 }) }
    c.assinatura('Responsável pelo caixa')
  })
}

/* ---------- Histórico (Relatórios → Fechamentos de caixa) ---------- */
async function carregarCaixas() {
  const lista = await api.listarCaixas(parseInt($('sel-mes-caixas').value), parseInt($('sel-ano-caixas').value))
  $('tbody-caixas').innerHTML = !lista.length
    ? linhaVazia(8, 'cash', 'Nenhum caixa neste período')
    : lista.map(c => {
        const dif = c.diferenca
        return `<tr>
          <td>${fmtDH(c.aberto_em)}</td>
          <td>${c.fechado_em ? fmtDH(c.fechado_em) : '<span class="badge-estoque-ok">aberto</span>'}</td>
          <td class="num">${fmtMoeda(c.total_vendas)} <small class="text-muted">(${c.num_vendas})</small></td>
          <td class="num">${fmtMoeda(c.total_sangrias)}</td>
          <td class="num">${c.valor_esperado != null ? fmtMoeda(c.valor_esperado) : '—'}</td>
          <td class="num">${c.valor_contado != null ? fmtMoeda(c.valor_contado) : '—'}</td>
          <td class="num">${dif == null ? '—' : Math.abs(dif) < 0.005 ? '<span class="positive">certo</span>'
            : `<span class="${dif > 0 ? 'diferenca-pos' : 'diferenca-neg'}">${dif > 0 ? '+' : '−'} ${fmtMoeda(Math.abs(dif))}</span>`}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn btn-sm btn-outline" data-ver-caixa="${c.id}">${icon('eye')} Ver</button>
            <button class="btn btn-sm btn-secondary btn-icon" data-imprimir-caixa="${c.id}" title="Imprimir">${icon('printer')}</button>
          </td>
        </tr>`
      }).join('')
}
$('btn-buscar-caixas').addEventListener('click', carregarCaixas)

$('tbody-caixas').addEventListener('click', async e => {
  const ver = e.target.closest('[data-ver-caixa]')
  const imp = e.target.closest('[data-imprimir-caixa]')
  if (imp) imprimirFechamento(await api.resumoCaixa(Number(imp.dataset.imprimirCaixa)))
  if (!ver) return
  const res = await api.resumoCaixa(Number(ver.dataset.verCaixa))
  const { dinheiro, outros } = linhasResumoCaixa(res)
  const cx = res.caixa
  const movs = res.movimentos.length ? `<h3 class="bloco-titulo" style="margin-top:6px;">Sangrias e suprimentos</h3>
    <div class="conta-lista">${res.movimentos.map(m => `<div class="conta-linha ${m.tipo !== 'suprimento' ? 'menos' : ''}">
      <span>${fmtHora(m.criado_em)} · ${m.tipo === 'sangria' ? 'Sangria' : m.tipo === 'suprimento' ? 'Suprimento' : 'Estorno'}${m.motivo ? ` — ${escHtml(m.motivo)}` : ''}</span>
      <strong>${fmtMoeda(m.valor)}</strong></div>`).join('')}</div>` : ''
  abrirInfo(`Caixa de ${fmtDH(cx.aberto_em)}`, `
    <div class="detalhes-info">
      <span class="info-pill">Abertura: <strong>${fmtDH(cx.aberto_em)}</strong></span>
      <span class="info-pill">Fechamento: <strong>${cx.fechado_em ? fmtDH(cx.fechado_em) : 'em aberto'}</strong></span>
      ${cx.valor_contado != null ? `<span class="info-pill">Contado: <strong>${fmtMoeda(cx.valor_contado)}</strong></span>` : ''}
    </div>
    <div class="fechamento-grid">
      <div><h3 class="bloco-titulo">Dinheiro na gaveta</h3><div class="conta-lista">${dinheiro}</div></div>
      <div><h3 class="bloco-titulo">Outras formas</h3><div class="conta-lista">${outros}</div></div>
    </div>
    ${movs}
    ${cx.obs_fechamento ? `<p class="text-muted">Obs.: ${escHtml(cx.obs_fechamento)}</p>` : ''}`)
})

/* Modal genérico de detalhes */
function abrirInfo(titulo, html, botoesExtras = '') {
  $('info-titulo').textContent = titulo
  $('info-corpo').innerHTML = html
  $('info-rodape').innerHTML = `${botoesExtras}<button class="btn btn-secondary" data-fechar-info>Fechar</button>`
  openModal('modal-info')
}
$('info-rodape').addEventListener('click', e => { if (e.target.closest('[data-fechar-info]')) closeModal('modal-info') })
