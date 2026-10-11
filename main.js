'use strict'

const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron')
const fs       = require('fs')
const path     = require('path')
const Database = require('./database')
const { autoUpdater } = require('electron-updater')

const BACKUPS_MANTIDOS = 30

let mainWindow
let db
let adminAutenticado = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1366,
    height:          820,
    minWidth:        1100,
    minHeight:       680,
    title:           'Cantinho do Bebê — PDV',
    backgroundColor: '#f4f2fb',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      devTools:         !app.isPackaged
    },
    autoHideMenuBar: true,
    show: false
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
    if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  // F11 alterna tela cheia (modo quiosque do caixa)
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

/* -------------------------------------------------------
   BACKUP
   ------------------------------------------------------- */
function pastaBackups() {
  const dir = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function listarBackups() {
  const dir = pastaBackups()
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ nome: f, data: fs.statSync(path.join(dir, f)).mtime.toISOString() }))
    .sort((a, b) => b.data.localeCompare(a.data))
}

/** Uma cópia por dia ao abrir o sistema; mantém os últimos BACKUPS_MANTIDOS. */
async function backupAutomatico() {
  try {
    const dir     = pastaBackups()
    const hoje    = new Date().toLocaleDateString('sv-SE') // AAAA-MM-DD
    const destino = path.join(dir, `loja-bebe-${hoje}.db`)
    if (!fs.existsSync(destino)) await db.backup(destino)

    listarBackups().slice(BACKUPS_MANTIDOS)
      .forEach(b => fs.rmSync(path.join(dir, b.nome), { force: true }))
  } catch (err) {
    console.error('Falha no backup automático:', err)
  }
}

/* -------------------------------------------------------
   IPC
   ------------------------------------------------------- */
function somenteAdmin(fn) {
  return (...args) => {
    if (!adminAutenticado) throw new Error('Acesso restrito ao administrador.')
    return fn(...args)
  }
}

function registrarHandlers() {
  /* Produtos */
  ipcMain.handle('produtos:listar',          ()           => db.listarProdutos())
  ipcMain.handle('produtos:criar',           (_, d)       => db.criarProduto(d))
  ipcMain.handle('produtos:atualizar',       (_, id, d)   => db.atualizarProduto(id, d))
  ipcMain.handle('produtos:deletar',         (_, id)      => db.deletarProduto(id))
  ipcMain.handle('produtos:buscarPorCodigo', (_, c)       => db.buscarPorCodigo(c))
  ipcMain.handle('produtos:promocao',        (_, id, p)   => db.definirPromocao(id, p))

  /* Admin — a sessão fica no processo principal, não na tela */
  ipcMain.handle('admin:login', (_, email, senha) => {
    adminAutenticado = db.verificarAdmin(email, senha)
    return adminAutenticado
  })
  ipcMain.handle('admin:logout', () => { adminAutenticado = false })
  ipcMain.handle('admin:alterarSenha',     somenteAdmin((_, atual, nova) => db.alterarSenha(atual, nova)))
  ipcMain.handle('admin:atualizarCusto',   somenteAdmin((_, id, v)       => db.atualizarCusto(id, v)))
  ipcMain.handle('admin:atualizarEstoque', somenteAdmin((_, id, v)       => db.atualizarEstoque(id, v)))
  ipcMain.handle('admin:lucro',            somenteAdmin((_, m, a)        => db.lucroMensal(m, a)))
  ipcMain.handle('admin:estornar',         somenteAdmin((_, id)          => db.cancelarVenda(id)))
  ipcMain.handle('admin:listarBackups',    somenteAdmin(()               => listarBackups()))
  ipcMain.handle('admin:abrirPastaBackups',somenteAdmin(()               => shell.openPath(pastaBackups())))
  ipcMain.handle('admin:backup', somenteAdmin(async () => {
    const hoje = new Date().toLocaleDateString('sv-SE')
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title:       'Salvar backup do banco de dados',
      defaultPath: path.join(app.getPath('documents'), `backup-cantinho-do-bebe-${hoje}.db`),
      filters:     [{ name: 'Banco de dados', extensions: ['db'] }]
    })
    if (canceled || !filePath) return null
    await db.backup(filePath)
    return filePath
  }))

  /* Versão e atualização */
  ipcMain.handle('app:versao',             () => app.getVersion())
  ipcMain.handle('atualizacao:status',     () => statusAtualizacao)
  ipcMain.handle('atualizacao:instalar',   () => {
    if (statusAtualizacao.estado !== 'pronta') return false
    setImmediate(() => autoUpdater.quitAndInstall())
    return true
  })

  /* Vendas */
  ipcMain.handle('vendas:finalizar',     (_, d)    => db.finalizarVenda(d))
  ipcMain.handle('vendas:proximoNumero', ()        => db.proximoNumeroVenda())
  ipcMain.handle('vendas:hoje',          ()        => db.vendasHoje())
  ipcMain.handle('vendas:mensais',       (_, m, a) => db.vendasMensais(m, a))
  ipcMain.handle('vendas:maisVendidos',  (_, m, a) => db.maisVendidos(m, a))
  ipcMain.handle('vendas:detalhes',      (_, id)   => db.detalhesVenda(id))

  /* Caixa */
  ipcMain.handle('caixa:atual',      ()                => db.caixaAtual())
  ipcMain.handle('caixa:abrir',      (_, v)            => db.abrirCaixa(v))
  ipcMain.handle('caixa:movimentar', (_, tipo, v, mot) => db.movimentarCaixa(tipo, v, mot))
  ipcMain.handle('caixa:fechar',     (_, v, obs)       => db.fecharCaixa(v, obs))
  ipcMain.handle('caixa:resumo',     (_, id)           => db.resumoCaixa(id))
  ipcMain.handle('caixa:listar',     (_, m, a)         => db.listarCaixas(m, a))

  /* Clientes e fiado */
  ipcMain.handle('clientes:listar',   ()     => db.listarClientes())
  ipcMain.handle('clientes:salvar',   (_, d) => db.salvarCliente(d))
  ipcMain.handle('clientes:excluir',  (_, id)=> db.excluirCliente(id))
  ipcMain.handle('clientes:extrato',  (_, id)=> db.extratoCliente(id))
  ipcMain.handle('clientes:receber',  (_, d) => db.receberPagamentoCliente(d))
  ipcMain.handle('clientes:anonimizar', (_, id)=> db.anonimizarCliente(id))

  /* Trocas e vales */
  ipcMain.handle('trocas:itensVenda', (_, id)   => db.itensParaTroca(id))
  ipcMain.handle('trocas:registrar',  (_, d)    => db.registrarTroca(d))
  ipcMain.handle('trocas:listar',     (_, m, a) => db.listarTrocas(m, a))
  ipcMain.handle('trocas:detalhes',   (_, id)   => db.detalhesTroca(id))
  ipcMain.handle('vales:buscar',      (_, c)    => db.buscarVale(c))
  ipcMain.handle('vales:listar',      ()        => db.listarVales())

  /* Fornecedores e entrada de mercadoria — definem custo, por isso só o administrador */
  ipcMain.handle('fornecedores:listar',  somenteAdmin(()       => db.listarFornecedores()))
  ipcMain.handle('fornecedores:salvar',  somenteAdmin((_, d)   => db.salvarFornecedor(d)))
  ipcMain.handle('fornecedores:excluir', somenteAdmin((_, id)  => db.excluirFornecedor(id)))
  ipcMain.handle('entradas:registrar',   somenteAdmin((_, d)   => db.registrarEntrada(d)))
  ipcMain.handle('entradas:listar',      somenteAdmin((_, m, a)=> db.listarEntradas(m, a)))
  ipcMain.handle('entradas:detalhes',    somenteAdmin((_, id)  => db.detalhesEntrada(id)))
}

/* -------------------------------------------------------
   ATUALIZAÇÃO AUTOMÁTICA (GitHub Releases)
   Baixa a nova versão em segundo plano e instala ao fechar o
   sistema, para nunca interromper uma venda.
   ------------------------------------------------------- */
let statusAtualizacao = { estado: 'desativado' }

function avisarAtualizacao(estado, extra = {}) {
  statusAtualizacao = { estado, ...extra }
  if (mainWindow) mainWindow.webContents.send('atualizacao:status', statusAtualizacao)
}

function iniciarAtualizacaoAutomatica() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update',  () => avisarAtualizacao('verificando'))
  autoUpdater.on('update-not-available', () => avisarAtualizacao('atualizado'))
  autoUpdater.on('update-available',     i  => avisarAtualizacao('baixando', { versao: i.version }))
  autoUpdater.on('download-progress',    p  => avisarAtualizacao('baixando', { versao: statusAtualizacao.versao, progresso: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded',    i  => avisarAtualizacao('pronta', { versao: i.version }))
  autoUpdater.on('error', err => {
    // Sem internet não é problema: tenta de novo na próxima verificação
    console.error('Atualização:', err && err.message)
    avisarAtualizacao('erro')
  })
  const verificar = () => autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(verificar, 15 * 1000)
  setInterval(verificar, 4 * 60 * 60 * 1000)
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'loja-bebe.db')
  db = new Database(dbPath)
  registrarHandlers()
  createWindow()
  backupAutomatico()
  iniciarAtualizacaoAutomatica()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (db) db.fechar()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { if (db) db.fechar() })
