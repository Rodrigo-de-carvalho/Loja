'use strict'

const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron')
const fs       = require('fs')
const path     = require('path')
const Database = require('./database')

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

  /* Vendas */
  ipcMain.handle('vendas:finalizar',     (_, d)    => db.finalizarVenda(d))
  ipcMain.handle('vendas:proximoNumero', ()        => db.proximoNumeroVenda())
  ipcMain.handle('vendas:hoje',          ()        => db.vendasHoje())
  ipcMain.handle('vendas:mensais',       (_, m, a) => db.vendasMensais(m, a))
  ipcMain.handle('vendas:maisVendidos',  (_, m, a) => db.maisVendidos(m, a))
  ipcMain.handle('vendas:detalhes',      (_, id)   => db.detalhesVenda(id))
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'loja-bebe.db')
  db = new Database(dbPath)
  registrarHandlers()
  createWindow()
  backupAutomatico()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (db) db.fechar()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { if (db) db.fechar() })
