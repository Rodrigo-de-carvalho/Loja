'use strict'

/* ============================================================
   CLIENTES E FIADO
   ============================================================ */
let todosClientes   = []
let filtroClientes  = 'todos'
let clienteEditId   = null
let aoSalvarCliente = null
let fichaCliente    = null   // extrato aberto na ficha
let formaReceber    = 'dinheiro'

async function carregarClientes() {
  todosClientes = await api.listarClientes()
  renderClientes()
}

function renderClientes() {
  const devendo = todosClientes.filter(c => c.saldo > 0)
  const aReceber = devendo.reduce((s, c) => s + c.saldo, 0)
  $('stats-clientes').innerHTML = `
    <div class="stat-card c-purple"><span class="stat-label">Clientes</span><span class="stat-value">${todosClientes.length}</span></div>
    <div class="stat-card c-orange"><span class="stat-label">Com fiado em aberto</span><span class="stat-value">${devendo.length}</span></div>
    <div class="stat-card c-red"><span class="stat-label">Total a receber</span><span class="stat-value red">${fmtMoeda(aReceber)}</span></div>`

  const q = $('input-busca-cliente').value.trim().toLowerCase()
  const lista = todosClientes.filter(c => {
    if (filtroClientes === 'devendo' && !(c.saldo > 0)) return false
    return !q || c.nome.toLowerCase().includes(q) || (c.telefone || '').includes(q) || (c.cpf || '').includes(q)
  })

  $('tbody-clientes').innerHTML = !lista.length
    ? linhaVazia(5, 'users', todosClientes.length ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado',
        todosClientes.length ? '' : 'Cadastre os clientes que compram fiado')
    : lista.map(c => `<tr>
        <td class="cliente-nome"><strong>${escHtml(c.nome)}</strong>${c.obs ? `<small>${escHtml(c.obs)}</small>` : ''}</td>
        <td>${escHtml(c.telefone || '—')}</td>
        <td>${c.ultima_compra ? fmtDH(c.ultima_compra) : '—'}</td>
        <td class="num">${c.saldo > 0 ? `<span class="saldo-devedor">${fmtMoeda(c.saldo)}</span>` : '<span class="saldo-zero">—</span>'}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-outline" data-ficha="${c.id}">${icon('file')} Ficha</button>
            ${c.saldo > 0 ? `<button class="btn btn-sm btn-success" data-receber="${c.id}">${icon('cash')} Receber</button>` : ''}
            <button class="btn btn-sm btn-secondary btn-icon" data-editar-cliente="${c.id}" title="Editar">${icon('edit')}</button>
            <button class="btn btn-sm btn-danger-outline btn-icon" data-excluir-cliente="${c.id}" title="Excluir">${icon('trash')}</button>
          </div>
        </td>
      </tr>`).join('')
}

$('input-busca-cliente').addEventListener('input', renderClientes)
document.querySelectorAll('#filtro-clientes .chip').forEach(chip =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('#filtro-clientes .chip').forEach(c => c.classList.remove('active'))
    chip.classList.add('active')
    filtroClientes = chip.dataset.filtro
    renderClientes()
  })
)

$('tbody-clientes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  if (b.dataset.ficha)          abrirFicha(Number(b.dataset.ficha))
  if (b.dataset.receber)        abrirReceber(Number(b.dataset.receber))
  if (b.dataset.editarCliente)  abrirCadastroCliente(todosClientes.find(c => c.id === Number(b.dataset.editarCliente)))
  if (b.dataset.excluirCliente) excluirCliente(Number(b.dataset.excluirCliente))
})

/* ---------- Cadastro ---------- */
function abrirCadastroCliente(cliente = null, callback = null) {
  clienteEditId = cliente ? cliente.id : null
  aoSalvarCliente = callback
  $('cliente-titulo').textContent = cliente ? 'Editar cliente' : 'Novo cliente'
  $('cliente-nome').value     = cliente ? cliente.nome : ''
  $('cliente-telefone').value = cliente ? cliente.telefone || '' : ''
  $('cliente-cpf').value      = cliente ? cliente.cpf || '' : ''
  $('cliente-endereco').value = cliente ? cliente.endereco || '' : ''
  $('cliente-obs').value      = cliente ? cliente.obs || '' : ''
  const jaConcordou = !!(cliente && cliente.consentimento_em)
  $('cliente-consentimento').checked  = jaConcordou
  $('cliente-consentimento').disabled = jaConcordou
  $('cliente-consentimento-texto').textContent = jaConcordou
    ? `Cliente concordou com o cadastro em ${fmtDH(cliente.consentimento_em)}.`
    : 'O cliente foi informado de que estes dados ficam guardados só para controle do fiado e das trocas, e concordou.'
  openModal('modal-cliente', 'cliente-nome')
}
$('btn-novo-cliente').addEventListener('click', () => abrirCadastroCliente())

async function salvarCliente() {
  if (!$('cliente-consentimento').checked) {
    toast('Confirme que o cliente foi informado e concorda com o cadastro.', 'warn'); return
  }
  try {
    const cliente = await api.salvarCliente({
      id: clienteEditId,
      nome: $('cliente-nome').value, telefone: $('cliente-telefone').value, cpf: $('cliente-cpf').value,
      endereco: $('cliente-endereco').value, obs: $('cliente-obs').value,
      consentimento: $('cliente-consentimento').checked
    })
    closeModal('modal-cliente')
    toast('Cliente salvo!', 'success')
    if (secaoAtiva() === 'clientes') await carregarClientes()
    if (aoSalvarCliente) { const cb = aoSalvarCliente; aoSalvarCliente = null; cb(cliente) }
  } catch (err) { toast(msgErro(err), 'error') }
}
$('btn-salvar-cliente').addEventListener('click', salvarCliente)
document.querySelectorAll('#modal-cliente input').forEach(inp =>
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvarCliente() } })
)

function excluirCliente(id) {
  const c = todosClientes.find(x => x.id === id); if (!c) return
  confirmar(`Excluir o cliente "${c.nome}"?`, async () => {
    try {
      await api.excluirCliente(id)
      toast('Cliente excluído.', 'success')
      await carregarClientes()
    } catch (err) { toast(msgErro(err), 'error') }
  }, { titulo: 'Excluir cliente', botao: 'Excluir' })
}

/* ---------- Ficha (extrato do fiado) ---------- */
async function abrirFicha(id) {
  try { fichaCliente = await api.extratoCliente(id) } catch (err) { toast(msgErro(err), 'error'); return }
  const { cliente, movimentos, saldo, vales } = fichaCliente
  $('ficha-titulo').textContent = cliente.nome
  $('ficha-dados').innerHTML = [
    cliente.telefone && `<span class="info-pill">Telefone: <strong>${escHtml(cliente.telefone)}</strong></span>`,
    cliente.cpf      && `<span class="info-pill">CPF: <strong>${escHtml(cpfMascarado(cliente.cpf))}</strong></span>`,
    cliente.endereco && `<span class="info-pill">${escHtml(cliente.endereco)}</span>`,
    cliente.obs      && `<span class="info-pill">${escHtml(cliente.obs)}</span>`,
    `<span class="info-pill">Cliente desde <strong>${fmtDH(cliente.criado_em).slice(0, 10)}</strong></span>`
  ].filter(Boolean).join('')
  $('ficha-saldo').textContent = fmtMoeda(saldo)
  document.querySelector('.ficha-saldo').classList.toggle('zerado', !(saldo > 0))
  $('ficha-vales').innerHTML = vales.length
    ? `<div class="vale-banner">${icon('ticket')} Vale-troca em aberto: ${vales.map(v => `<strong>${escHtml(v.codigo)}</strong> (${fmtMoeda(v.saldo)})`).join(', ')}</div>` : ''
  $('tbody-ficha').innerHTML = !movimentos.length
    ? linhaVazia(4, 'file', 'Nenhuma compra fiado ainda')
    : movimentos.map(m => `<tr>
        <td>${fmtDH(m.data)}</td>
        <td>${m.tipo === 'compra'
          ? `Compra fiado — venda <button class="link-btn" data-ver-venda="${m.venda_id}">nº ${fmtNumVenda(m.venda_id)}</button>`
          : `Pagamento em ${PAGAMENTO_LABEL[m.forma] || m.forma}${m.obs ? ` — ${escHtml(m.obs)}` : ''}`}</td>
        <td class="num"><span class="${m.tipo === 'compra' ? 'mov-compra' : 'mov-pagamento'}">${m.tipo === 'compra' ? '+' : '−'} ${fmtMoeda(m.valor)}</span></td>
        <td class="num">${fmtMoeda(m.saldo)}</td>
      </tr>`).join('')
  $('btn-ficha-receber').disabled = !(saldo > 0)
  openModal('modal-ficha')
}

$('tbody-ficha').addEventListener('click', e => {
  const b = e.target.closest('[data-ver-venda]'); if (b) verDetalhesVenda(Number(b.dataset.verVenda))
})
$('btn-ficha-receber').addEventListener('click', () => { closeModal('modal-ficha'); abrirReceber(fichaCliente.cliente.id) })
$('btn-ficha-imprimir').addEventListener('click', () => imprimirExtrato(fichaCliente))

function imprimirExtrato({ cliente, movimentos, saldo }) {
  cupomTermico(c => {
    c.cabecalho('Extrato do Fiado')
    c.espaco(2); c.solida()
    c.linha('Cliente:', cliente.nome, { negrito: true })
    if (cliente.telefone) c.linha('Telefone:', cliente.telefone)
    c.linha('Emitido em:', agoraTexto())
    c.solida()
    // Mostra os últimos lançamentos em ordem cronológica
    movimentos.slice(0, 40).reverse().forEach(m => {
      const desc = m.tipo === 'compra' ? `Compra ${fmtNumVenda(m.venda_id)}` : `Pago (${PAGAMENTO_PDF[m.forma] || m.forma})`
      c.linha(`${fmtDH(m.data).slice(0, 10)} ${desc}`, `${m.tipo === 'compra' ? '+' : '-'} ${fmtMoeda(m.valor)}`, { tam: 7.5, passo: 4.4 })
    })
    c.tracejada()
    c.linha('SALDO DEVEDOR:', fmtMoeda(saldo), { tam: 11, negrito: true, passo: 6 })
  })
}

/* ---------- Receber pagamento ---------- */
let receberClienteId = null

async function abrirReceber(id) {
  if (!caixaAberto()) { toast('Abra o caixa antes de receber pagamentos.', 'warn'); return }
  const lista = await api.listarClientes()
  const c = lista.find(x => x.id === id); if (!c) return
  receberClienteId = id
  $('receber-cliente').textContent = `${c.nome} — deve ${fmtMoeda(c.saldo)}`
  $('receber-valor').value = c.saldo.toFixed(2)
  setFormaReceber('dinheiro')
  $('receber-obs').value = ''
  openModal('modal-receber', 'receber-valor')
}

function setFormaReceber(forma) {
  formaReceber = forma
  document.querySelectorAll('#receber-forma .seg').forEach(s => s.classList.toggle('active', s.dataset.forma === forma))
}
document.querySelectorAll('#receber-forma .seg').forEach(s => s.addEventListener('click', () => setFormaReceber(s.dataset.forma)))

async function confirmarReceber() {
  const valor = parseFloat($('receber-valor').value)
  if (!(valor > 0)) { toast('Informe o valor recebido.', 'error'); return }
  try {
    const r = await api.receberCliente({ cliente_id: receberClienteId, valor, forma: formaReceber, obs: $('receber-obs').value })
    closeModal('modal-receber')
    toast(`Recebido ${fmtMoeda(valor)} de ${r.cliente.nome}. Saldo: ${fmtMoeda(r.saldo)}.`, 'success')
    if ($('receber-imprimir').checked) imprimirRecebimento(r)
    if (secaoAtiva() === 'clientes') await carregarClientes()
    await atualizarCaixa()
  } catch (err) { toast(msgErro(err), 'error') }
}
$('btn-confirmar-receber').addEventListener('click', confirmarReceber)
;['receber-valor', 'receber-obs'].forEach(id =>
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmarReceber() } })
)

function imprimirRecebimento({ pagamento, cliente, saldo }) {
  cupomTermico(c => {
    c.cabecalho('Comprovante de Pagamento - Fiado')
    c.centro('NAO E DOCUMENTO FISCAL', { tam: 6.5, passo: 5 })
    c.solida()
    c.linha('Cliente:', cliente.nome, { negrito: true })
    c.linha('Data/Hora:', fmtDH(pagamento.criado_em))
    c.linha('Forma:', PAGAMENTO_PDF[pagamento.forma] || pagamento.forma)
    c.tracejada()
    c.linha('VALOR PAGO:', fmtMoeda(pagamento.valor), { tam: 11, negrito: true, passo: 6 })
    c.linha('Saldo restante:', fmtMoeda(saldo), { negrito: true })
    if (pagamento.obs) c.texto(`Obs.: ${pagamento.obs}`)
    c.assinatura('Cantinho do Bebê')
  })
}

/* ---------- LGPD ---------- */
// Mostra só os 5 últimos dígitos do CPF na tela
function cpfMascarado(cpf) {
  const d = String(cpf || '').replace(/\D/g, '')
  return d.length === 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9)}` : '***'
}

$('btn-ficha-lgpd').addEventListener('click', () => {
  const { cliente, saldo, vales } = fichaCliente
  const campo = (rotulo, valor) => `<dt>${rotulo}</dt><dd>${valor ? escHtml(valor) : '<span class="text-muted">não informado</span>'}</dd>`
  abrirInfo(`Dados pessoais — ${cliente.nome}`, `
    <p class="text-muted">Estes são todos os dados pessoais que a loja guarda deste cliente. Ele pode pedir uma cópia ou que sejam apagados.</p>
    <dl class="lgpd-lista">
      ${campo('Nome', cliente.nome)}
      ${campo('Telefone', cliente.telefone)}
      ${campo('CPF', cliente.cpf)}
      ${campo('Endereço', cliente.endereco)}
      ${campo('Observação', cliente.obs)}
      ${campo('Cadastrado em', fmtDH(cliente.criado_em))}
      ${campo('Concordou em', cliente.consentimento_em ? fmtDH(cliente.consentimento_em) : 'antes do registro de consentimento')}
      ${campo('Para que é usado', 'Controle de compras fiado, pagamentos e vales-troca')}
    </dl>
    ${saldo > 0 || vales.length ? `<div class="vale-banner" style="margin-top:6px;">${icon('alert')}
      ${saldo > 0 ? `O cliente ainda deve ${fmtMoeda(saldo)}.` : ''} ${vales.length ? 'Tem vale-troca com saldo.' : ''}
      Os dados só podem ser apagados depois de quitar.</div>` : ''}`,
    `<button class="btn btn-secondary" data-lgpd="imprimir">${icon('printer')} Imprimir para o cliente</button>
     <button class="btn btn-danger-outline" data-lgpd="apagar" ${saldo > 0 || vales.length ? 'disabled' : ''}>${icon('trash')} Apagar dados pessoais</button>`)
})

$('info-rodape').addEventListener('click', e => {
  const b = e.target.closest('[data-lgpd]'); if (!b || !fichaCliente) return
  const { cliente } = fichaCliente
  if (b.dataset.lgpd === 'imprimir') {
    cupomTermico(c => {
      c.cabecalho('Seus dados pessoais')
      c.espaco(2); c.solida()
      c.linha('Nome:', cliente.nome)
      c.linha('Telefone:', cliente.telefone || '-')
      c.linha('CPF:', cliente.cpf || '-')
      if (cliente.endereco) c.texto(`Endereco: ${cliente.endereco}`, { tam: 8 })
      c.linha('Cadastro:', fmtDH(cliente.criado_em))
      c.tracejada()
      c.texto('Usamos estes dados somente para controlar compras fiado, pagamentos e vales-troca. Nao compartilhamos com terceiros. Voce pode pedir a correcao ou a exclusao a qualquer momento.')
    })
  }
  if (b.dataset.lgpd === 'apagar') {
    confirmar(`Apagar os dados pessoais de "${cliente.nome}"?\n\nNome, telefone, CPF, endereço e observação serão apagados para sempre. As vendas continuam nos relatórios, sem identificar o cliente.`, async () => {
      try {
        await api.anonimizarCliente(cliente.id)
        closeModal('modal-info'); closeModal('modal-ficha')
        toast('Dados pessoais apagados.', 'success')
        await carregarClientes()
      } catch (err) { toast(msgErro(err), 'error') }
    }, { titulo: 'Apagar dados pessoais', botao: 'Apagar' })
  }
})

/* Aviso de privacidade para deixar no balcão (A4) */
$('btn-aviso-privacidade').addEventListener('click', () => {
  const contato = $('privacidade-contato').value.trim()
  const doc = _novoPDF()
  let y = _pdfHeader(doc, 'Aviso de Privacidade', 'Lei Geral de Proteção de Dados (Lei 13.709/2018)')
  const W = 182, m = 14
  const secao = (titulo, texto) => {
    doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5)
    doc.text(titulo, m, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(51, 65, 85)
    const linhas = doc.splitTextToSize(texto, W)
    doc.text(linhas, m, y); y += linhas.length * 5.2 + 5
  }
  secao('Quem cuida dos seus dados', 'A loja Cantinho do Bebê é responsável pelos dados pessoais informados no cadastro de clientes.')
  secao('Quais dados guardamos', 'Nome, telefone, CPF e endereço (quando informados), além do histórico de compras feitas no fiado, pagamentos e vales-troca.')
  secao('Para que usamos', 'Somente para controlar as compras fiado, registrar os pagamentos, emitir comprovantes e controlar vales-troca. Não usamos os dados para propaganda e não vendemos nem compartilhamos com terceiros.')
  secao('Por quanto tempo', 'Enquanto você for nosso cliente ou houver valores em aberto. Os registros de vendas são mantidos pelo prazo exigido pela legislação fiscal, sem identificação pessoal depois que você pedir a exclusão.')
  secao('Como protegemos', 'Os dados ficam no computador da loja, com cópias de segurança guardadas em local protegido, e só a proprietária tem acesso às áreas restritas do sistema.')
  secao('Seus direitos', 'Você pode, a qualquer momento e sem custo, pedir para ver seus dados, corrigir informações erradas ou apagar seus dados pessoais (depois de quitar valores em aberto). Basta falar com a gente no balcão.')
  secao('Contato', contato || 'Fale com a proprietária no balcão da loja.')
  _pdfFooter(doc)
  doc.save('aviso-de-privacidade.pdf')
  toast('Aviso de privacidade gerado. Imprima e deixe no balcão.', 'success')
})
