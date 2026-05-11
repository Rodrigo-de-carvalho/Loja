'use strict'

const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path     = require('path')
const Database = require('./database')

let mainWindow
let db

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
  ipcMain.handle('produtos:criar',           (_, d)       => db.criarProduto(d))
  ipcMain.handle('produtos:atualizar',       (_, id, d)   => db.atualizarProduto(id, d))
  ipcMain.handle('produtos:deletar',         (_, id)      => db.deletarProduto(id))
  ipcMain.handle('produtos:buscarPorCodigo', (_, c)       => db.buscarPorCodigo(c))

  /* Admin — protegido no nível do banco */
  ipcMain.handle('admin:verificar',          (_, eH, sH)  => db.verificarAdmin(eH, sH))
  ipcMain.handle('admin:atualizarCusto',     (_, id, v)   => db.atualizarCusto(id, v))
  ipcMain.handle('admin:atualizarEstoque',   (_, id, v)   => db.atualizarEstoque(id, v))

  /* Vendas */
  ipcMain.handle('vendas:finalizar',  (_, d)       => db.finalizarVenda(d))
  ipcMain.handle('vendas:cancelar',   (_, id)      => db.cancelarVenda(id))
  ipcMain.handle('vendas:hoje',       ()           => db.vendasHoje())
  ipcMain.handle('vendas:mensais',    (_, m, a)    => db.vendasMensais(m, a))
  ipcMain.handle('vendas:lucro',      (_, m, a)    => db.lucroMensal(m, a))
  ipcMain.handle('vendas:detalhes',   (_, id)      => db.detalhesVenda(id))
}

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

app.on('before-quit', () => { if (db) db.fechar() })
