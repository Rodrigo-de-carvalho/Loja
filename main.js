'use strict'

const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path     = require('path')
const fs       = require('fs')
const Database = require('./database')

let mainWindow
let db

/* Sessão de administrador vive no processo main: os handlers sensíveis
   só executam após login válido, independente do que o renderer diga. */
let adminLogado     = false
let tentativasLogin = 0
let bloqueadoAte    = 0

const LIMITE_TENTATIVAS = 5
const TEMPO_BLOQUEIO_MS = 30_000

function exigirAdmin(fn) {
  return (event, ...args) => {
    if (!adminLogado) throw new Error('Acesso negado: faça login como administrador.')
    return fn(event, ...args)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        1024,
    minHeight:       640,
    title:           'Cantinho do Bebê — PDV',
    backgroundColor: '#f1f5f9',
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
    mainWindow.show()
    if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function registrarHandlers() {
  /* Produtos */
  ipcMain.handle('produtos:listar',          ()           => db.listarProdutos())
  // Estoque inicial só é aceito com sessão de admin; sem ela o produto entra com 0
  ipcMain.handle('produtos:criar',           (_, d)       => db.criarProduto({ ...d, estoque: adminLogado ? d.estoque : 0 }))
  ipcMain.handle('produtos:atualizar',       (_, id, d)   => db.atualizarProduto(id, d))
  ipcMain.handle('produtos:deletar',         (_, id)      => db.deletarProduto(id))
  ipcMain.handle('produtos:buscarPorCodigo', (_, c)       => db.buscarPorCodigo(c))

  /* Admin — sessão controlada aqui no main */
  ipcMain.handle('admin:login', (_, emailHash, senhaHash) => {
    const agora = Date.now()
    if (agora < bloqueadoAte) {
      const seg = Math.ceil((bloqueadoAte - agora) / 1000)
      return { ok: false, error: `Muitas tentativas. Aguarde ${seg} segundos.` }
    }
    if (db.verificarAdmin(emailHash, senhaHash)) {
      adminLogado     = true
      tentativasLogin = 0
      return { ok: true }
    }
    tentativasLogin++
    if (tentativasLogin >= LIMITE_TENTATIVAS) {
      bloqueadoAte    = agora + TEMPO_BLOQUEIO_MS
      tentativasLogin = 0
      return { ok: false, error: `Muitas tentativas. Aguarde ${TEMPO_BLOQUEIO_MS / 1000} segundos.` }
    }
    return { ok: false, error: 'E-mail ou senha incorretos.' }
  })
  ipcMain.handle('admin:logout', () => { adminLogado = false; return { ok: true } })

  ipcMain.handle('admin:atualizarCusto',   exigirAdmin((_, id, v) => db.atualizarCusto(id, v)))
  ipcMain.handle('admin:atualizarEstoque', exigirAdmin((_, id, v) => db.atualizarEstoque(id, v)))
  ipcMain.handle('admin:getTaxas',         exigirAdmin(()        => db.getTaxas()))
  ipcMain.handle('admin:salvarTaxas',      exigirAdmin((_, t)    => db.salvarTaxas(t)))

  /* Vendas */
  ipcMain.handle('vendas:finalizar',  (_, d)    => db.finalizarVenda(d))
  ipcMain.handle('vendas:trocaInfo',  (_, id)   => db.trocaInfo(id))
  ipcMain.handle('vendas:hoje',       ()        => db.vendasHoje())
  ipcMain.handle('vendas:detalhes',   (_, id)   => db.detalhesVenda(id))

  /* Vendas — somente admin (histórico de dias anteriores incluso) */
  ipcMain.handle('vendas:periodo',    exigirAdmin((_, i, f) => db.vendasPeriodo(i, f)))
  ipcMain.handle('vendas:mensais',    exigirAdmin((_, m, a) => db.vendasMensais(m, a)))
  ipcMain.handle('vendas:cancelar',   exigirAdmin((_, id)   => db.cancelarVenda(id)))
  ipcMain.handle('vendas:lucro',      exigirAdmin((_, m, a) => db.lucroMensal(m, a)))
  ipcMain.handle('vendas:estornadas', exigirAdmin((_, m, a) => db.estornadasMensais(m, a)))
}

/* Backup diário automático em userData/backups (mantém os 14 mais recentes) */
async function backupDiario() {
  try {
    const dir = path.join(app.getPath('userData'), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const hoje    = new Date().toISOString().slice(0, 10)
    const destino = path.join(dir, `loja-bebe-${hoje}.db`)
    if (!fs.existsSync(destino)) {
      await db.backup(destino)
      const arquivos = fs.readdirSync(dir)
        .filter(f => f.startsWith('loja-bebe-') && f.endsWith('.db'))
        .sort()
      while (arquivos.length > 14) {
        fs.unlinkSync(path.join(dir, arquivos.shift()))
      }
    }
  } catch (err) {
    console.error('Falha no backup automático:', err)
  }
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'loja-bebe.db')
  db = new Database(dbPath)
  registrarHandlers()
  backupDiario()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (db) db.fechar()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => { if (db) db.fechar() })
