'use strict'

const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path    = require('path')
const Database = require('./database')

let mainWindow
let db

/* ============================================================
   JANELA PRINCIPAL
   ============================================================ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        1024,
    minHeight:       640,
    title:           'Baby Store — PDV',
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

  // Sem barra de menu nativa
  Menu.setApplicationMenu(null)

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

/* ============================================================
   HANDLERS IPC
   ============================================================ */
function registrarHandlers() {
  /* ---- Produtos ---- */
  ipcMain.handle('produtos:listar', () =>
    db.listarProdutos()
  )

  ipcMain.handle('produtos:criar', (_, dados) =>
    db.criarProduto(dados)
  )

  ipcMain.handle('produtos:atualizar', (_, id, dados) =>
    db.atualizarProduto(id, dados)
  )

  ipcMain.handle('produtos:deletar', (_, id) =>
    db.deletarProduto(id)
  )

  ipcMain.handle('produtos:buscarPorCodigo', (_, codigo) =>
    db.buscarPorCodigo(codigo)
  )

  /* ---- Vendas ---- */
  ipcMain.handle('vendas:finalizar', (_, dados) =>
    db.finalizarVenda(dados)
  )

  ipcMain.handle('vendas:hoje', () =>
    db.vendasHoje()
  )

  ipcMain.handle('vendas:mensais', (_, mes, ano) =>
    db.vendasMensais(mes, ano)
  )

  ipcMain.handle('vendas:lucro', (_, mes, ano) =>
    db.lucroMensal(mes, ano)
  )

  ipcMain.handle('vendas:detalhes', (_, id) =>
    db.detalhesVenda(id)
  )
}

/* ============================================================
   CICLO DE VIDA DO APP
   ============================================================ */
app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'loja-bebe.db')
  db = new Database(dbPath)

  registrarHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (db) db.fechar()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (db) db.fechar()
})
